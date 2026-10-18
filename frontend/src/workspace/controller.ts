import { generationBodySchema } from '@atoms/contracts';
import type { GenerationEvent, GenerationStatus, Message, Project, ProjectDetail, Version, VersionReview, z, templateListSchema } from '@atoms/contracts';
import { createWorkspaceApi } from '../api/workspace';
import { generate } from '../api/generation-stream';
import type { GenerationBody } from '../api/generation-stream';
import { getVersion, VersionApiError } from '../api/versions';
import { workspaceError } from '../api/workspace-error';
import { PendingRequests } from './pending';
import type { PendingStorage } from './pending';
import { routeFor } from './routing';
import type { Route } from './routing';

type Task = { payload: GenerationBody; phase: 'submitting' | 'active' | 'cancelling' | 'checking' | 'terminal' | 'unknown';
  state: GenerationStatus | null; events: GenerationEvent[]; accepted: boolean; message: string; local: boolean };
export type WorkspaceState = {
  route: Route; activation: number; loading: boolean; error: string; templates: z.infer<typeof templateListSchema>['items']; projects: Project[]; cursor: string | null;
  home: { title: string; prompt: string; templateId: string; status: 'idle' | 'submitting' | 'unknown' | 'error'; message: string; sessionReady: boolean };
  project: ProjectDetail | null; review: VersionReview | null; selected: Version | null; messages: Message[]; before: number | null;
  task: Task | null; draft: string; view: 'chat' | 'preview' | 'code'; storageWarning: string;
};
export const mergeMessages = (old: Message[], incoming: Message[]) => [...new Map([...old, ...incoming].map(item => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence);
const safeMessage = (error: unknown) => error instanceof VersionApiError ? `${workspaceError(error).message}${error.status ? `（HTTP ${error.status}）` : ''}` : '连接或任务结果未确认，请查询原请求。';
export class WorkspaceController {
  private state: WorkspaceState = { route: routeFor('/__initial'), activation: 0, loading: false, error: '', templates: [], projects: [], cursor: null,
    home: { title: '', prompt: '', templateId: '', status: 'idle', message: '', sessionReady: false }, project: null, review: null, selected: null,
    messages: [], before: null, task: null, draft: '', view: 'chat', storageWarning: '' };
  private readonly subscribers = new Set<() => void>();
  private readonly drafts = new Map<string, string>();
  private readonly conversations = new Map<string, { items: Message[]; before: number | null }>();
  readonly reading = new Map<string, number>();
  readonly api;
  readonly pending;
  private getController = new AbortController();
  private streamController: AbortController | undefined;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private checks = 0; private checkStarted = 0; private nextCheckAt = 0; private hidden = false; private creating = false; private polling = false; private sessionInvalidated = false;
  constructor(private readonly options: { storage?: PendingStorage; transport?: typeof fetch; now?: () => number; pollMs?: number; navigate?: (path: string) => void } = {}) {
    this.pending = new PendingRequests(options.storage, options.now);
    this.api = createWorkspaceApi({ ...(options.transport ? { transport: options.transport } : {}), onNewSession: () => {
      this.clearPrivate();
      if (this.state.route.kind !== 'home') { this.leave(); this.update({ activation: this.state.activation + 1, loading: false, error: '会话已更新，请返回首页选择当前会话的项目。' }); }
    }, onUnauthorized: () => this.unauthorized() });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.subscribers.add(listener); return () => { this.subscribers.delete(listener); }; };
  private update(value: Partial<WorkspaceState>) { this.state = { ...this.state, ...value }; for (const listener of this.subscribers) listener(); }
  private clearPrivate() { this.drafts.clear(); this.conversations.clear(); this.reading.clear(); this.pending.clear(); this.update({ projects: [], project: null, review: null, selected: null, messages: [], task: null, draft: '' }); }
  private unauthorized() { this.sessionInvalidated = true; this.leave(); this.clearPrivate(); this.update({ activation: this.state.activation + 1, loading: false, error: '会话已失效。请返回首页明确重新开始；不会自动认领旧项目。', home: { ...this.state.home, sessionReady: false } }); }
  private matches(activation: number, projectId?: string) { return this.state.activation === activation && (!projectId || this.state.route.kind === 'project' && this.state.route.projectId === projectId); }
  leave() { this.getController.abort(); this.streamController?.abort(); this.streamController = undefined; clearTimeout(this.poll); this.poll = undefined; this.polling = false; this.checks = 0; this.checkStarted = 0; this.nextCheckAt = 0; }
  activate(route: Route, force = false) {
    if (!force && route.path === this.state.route.path) return;
    if (this.state.route.kind === 'project' && this.state.project) this.conversations.set(this.state.route.projectId, { items: this.state.messages, before: this.state.before });
    const cached = route.kind === 'project' ? this.conversations.get(route.projectId) : undefined;
    this.leave(); this.getController = new AbortController(); const activation = this.state.activation + 1;
    this.update({ route, activation, loading: route.kind === 'home' || route.kind === 'project', error: '', project: null, review: null, selected: null,
      messages: cached?.items ?? [], before: cached?.before ?? null, task: null, draft: route.kind === 'project' ? this.drafts.get(route.projectId) ?? '' : '', view: 'chat' });
    if (route.kind === 'home') void this.loadHome(activation);
    if (route.kind === 'project') void this.loadProject(route.projectId, activation);
  }
  private async loadHome(activation: number) {
    const signal = this.getController.signal;
    try {
      if (this.sessionInvalidated) {
        const templates = await this.api.templates(signal);
        if (this.matches(activation)) this.update({ loading: false, templates: templates.items, error: '会话失效后请明确重新开始。', home: { ...this.state.home, sessionReady: false } });
        return;
      }
      const [templates] = await Promise.all([this.api.templates(signal), this.api.session()]);
      const projects = await this.api.projects(undefined, signal); if (!this.matches(activation) || signal.aborted) return;
      this.update({ loading: false, templates: templates.items, projects: projects.items, cursor: projects.nextCursor,
        home: { ...this.state.home, sessionReady: true, templateId: templates.items.some(t => t.id === this.state.home.templateId) ? this.state.home.templateId : templates.items[0]?.id ?? '' } });
    } catch (error) { if (this.matches(activation) && !signal.aborted) this.update({ loading: false, error: safeMessage(error) }); }
  }
  editHome(value: Partial<WorkspaceState['home']>) { this.update({ home: { ...this.state.home, ...value } }); }
  restartSession() { this.sessionInvalidated = false; this.api.resetSession(); this.clearPrivate(); this.activate(routeFor('/'), true); }
  async refreshProjects(more = false) {
    const activation = this.state.activation; try {
      const page = await this.api.projects(more ? this.state.cursor ?? undefined : undefined, this.getController.signal);
      if (this.matches(activation)) this.update({ projects: more ? [...new Map([...this.state.projects, ...page.items].map(item => [item.id, item])).values()] : page.items, cursor: page.nextCursor });
    } catch (error) { if (this.matches(activation)) this.update({ error: safeMessage(error) }); }
  }
  async create() {
    if (this.creating || this.state.home.status === 'submitting' || !this.state.home.sessionReady) return;
    const { title, prompt, templateId } = this.state.home; const template = this.state.templates.find(item => item.id === templateId);
    if (!template || !generationBodySchema.shape.prompt.safeParse(prompt).success || title.trim().length > 120) {
      this.editHome({ status: 'error', message: '请选择可用模板并填写 1–4000 字符的需求；名称最多 120 字符。' }); return;
    }
    const activation = this.state.activation; this.creating = true; this.editHome({ status: 'submitting', message: '正在创建项目…' });
    try {
      // Creation is deliberately not retried and not tied to transient React subscriptions.
      const detail = await this.api.create({ title: title.trim() || '新项目', templateId, templateVersion: template.version, templateDigest: template.digest });
      if (!this.matches(activation) || this.state.route.kind !== 'home') return;
      this.editHome({ status: 'idle', message: '' }); this.drafts.set(detail.project.id, prompt.trim());
      this.options.navigate?.(`/projects/${detail.project.id}`); this.activate(routeFor(`/projects/${detail.project.id}`));
      this.update({ project: detail, selected: detail.currentVersion, draft: prompt.trim() });
      // This call remains in the explicit user command, never an effect/mount action.
      void this.start(prompt.trim(), detail);
    } catch (error) {
      if (!this.matches(activation)) return;
      const known = error instanceof VersionApiError && error.kind === 'http';
      this.editHome({ status: known ? 'error' : 'unknown', message: known ? safeMessage(error) : '创建结果待确认。请刷新真实项目列表选择，不会自动重发或按名称猜测。' });
    } finally { this.creating = false; if (this.snapshot().home.status === 'submitting') this.editHome({ status: 'idle', message: '创建请求已结束，请刷新实际项目列表确认。' }); }
  }
  private async loadProject(projectId: string, activation: number) {
    const signal = this.getController.signal;
    try {
      const detail = await this.api.project(projectId, signal); const page = await this.api.messages(projectId, undefined, signal);
      const local = this.pending.get(projectId);
      const task = this.state.task; // A create command may already own a live stream while GETs load.
      const run = detail.latestRun; const candidateId = task?.state?.candidateVersionId ?? (!local && run?.status === 'succeeded' ? run.resultVersionId : null);
      const review = await getVersion(projectId, candidateId ?? detail.project.currentVersionId, { signal, ...(this.options.transport ? { transport: this.options.transport } : {}) });
      if (!this.matches(activation, projectId) || signal.aborted) return;
      this.update({ loading: false, project: this.state.project && this.state.project.project.updatedAt >= detail.project.updatedAt ? this.state.project : detail, review: this.state.review ?? review, selected: this.state.review ? this.state.selected : review.version, messages: mergeMessages(this.state.messages, page.items), before: this.conversations.get(projectId)?.before ?? (this.conversations.has(projectId) ? null : page.nextBeforeSequence),
        storageWarning: this.pending.available ? '' : '本地恢复存储不可用，刷新后需通过服务端最新任务确认。' });
      void this.refreshProjects();
      if (!this.state.task && local) {
        if (!this.state.draft) this.setDraft(local.prompt);
        this.setTask({ payload: generationBodySchema.parse({ requestId: local.requestId, baseVersionId: local.baseVersionId, prompt: local.prompt }), phase: 'checking', state: null, events: [], accepted: false, message: '正在查询刷新前的原请求…', local: true });
        void this.query(true);
      } else if (!this.state.task && run) {
        const prompt = page.items.find(item => item.runId === run.id && item.role === 'user')?.content ?? '';
        this.setTask({ payload: { requestId: run.requestId, baseVersionId: run.baseVersionId, prompt }, phase: run.status === 'running' ? 'checking' : 'terminal', state: null,
          events: [], accepted: true, message: `最新已存任务：${run.status}；不重放历史活动。`, local: false });
        void this.query(run.status === 'running');
      }
    } catch (error) { if (error instanceof VersionApiError && error.status === 401) this.unauthorized(); else if (this.matches(activation, projectId) && !signal.aborted) this.update({ loading: false, error: safeMessage(error) }); }
  }
  setDraft(value: string) { if (this.state.route.kind === 'project') this.drafts.set(this.state.route.projectId, value); this.update({ draft: value }); }
  setView(view: WorkspaceState['view']) { this.update({ view }); }
  expireSession() { this.unauthorized(); }
  facts(project: ProjectDetail, activation: number, target?: string) { if (this.matches(activation, project.project.id) && (!target || this.state.review?.version.id === target) && (!this.state.project || project.project.updatedAt >= this.state.project.project.updatedAt)) this.update({ project, projects: this.state.projects.map(item => item.id === project.project.id ? project.project : item) }); }
  select(version: Version, activation: number, target?: string) { if (this.matches(activation, version.projectId) && (!target || this.state.review?.version.id === target) && this.state.selected?.id !== version.id) this.update({ selected: version }); }
  async earlier() {
    if (this.state.route.kind !== 'project' || !this.state.before) return; const { projectId } = this.state.route; const activation = this.state.activation;
    try { const page = await this.api.messages(projectId, this.state.before, this.getController.signal);
      if (this.matches(activation, projectId)) this.update({ messages: mergeMessages(page.items, this.state.messages), before: page.nextBeforeSequence });
    } catch (error) { if (this.matches(activation, projectId)) this.update({ error: safeMessage(error) }); }
  }
  private setTask(task: Task) { this.update({ task }); }
  async start(prompt = this.state.draft, explicitProject?: ProjectDetail, original = false) {
    const project = explicitProject ?? this.state.project; if (!project || this.state.route.kind !== 'project') return;
    if (!original && this.state.task && !['terminal'].includes(this.state.task.phase)) return;
    if (!original && this.state.selected && this.state.selected.id !== project.project.currentVersionId) { this.update({ error: '请先采用候选或查看当前版本，再提交下一条需求。' }); return; }
    let payload: GenerationBody;
    try { payload = original && this.state.task ? generationBodySchema.parse(this.state.task.payload)
      : generationBodySchema.parse({ requestId: crypto.randomUUID(), baseVersionId: project.project.currentVersionId, prompt }); }
    catch { this.update({ error: '需求须为 1–4000 字符且不超过 16 KiB。' }); return; }
    const projectId = project.project.id; const activation = this.state.activation;
    this.streamController?.abort(); const controller = new AbortController(); this.streamController = controller; clearTimeout(this.poll); this.checks = 0; this.checkStarted = 0; this.polling = false;
    this.pending.save({ ...payload, projectId, createdAt: (this.options.now ?? Date.now)() });
    this.setTask({ payload, phase: 'submitting', state: null, events: [], accepted: false, message: '正在请求生成，需求尚待受理确认…', local: true });
    if (!this.pending.available) this.update({ storageWarning: '本地恢复存储不可用；本页仍可查询，刷新恢复有限。' });
    const valid = () => this.matches(activation, projectId) && this.state.task?.payload.requestId === payload.requestId && !controller.signal.aborted;
    try {
      const result = await generate(projectId, payload, { signal: controller.signal, ...(this.options.transport ? { transport: this.options.transport } : {}),
        onEvent: event => {
          if (!valid() || this.state.task?.phase === 'terminal') return;
          const task = this.state.task; if (!task) return;
          if (event.event === 'terminal') { this.acceptState(event.state); return; }
          this.setTask({ ...task, phase: task.phase === 'cancelling' ? 'cancelling' : 'active', accepted: true, events: [...task.events, event], message: '任务已受理，正在执行实际工作。' });
          if (event.event === 'accepted') { if (this.state.draft.trim() === payload.prompt) this.setDraft(''); void this.calibrate(projectId, activation); }
        } });
      if (valid() && this.state.task?.phase !== 'terminal') { this.acceptState(result); if (result.status === 'running' || !result.terminalStatePersisted) void this.query(true); }
    } catch (error) {
      if (!valid() || this.state.task?.phase === 'terminal') return;
      const task = this.state.task; if (!task) return;
      if (error instanceof VersionApiError && error.kind === 'http' && [400,401,403,406,409,413,415,429,503].includes(error.status ?? 0) && error.code !== 'RUN_STATE_UNCONFIRMED') {
        this.pending.remove(projectId); this.setTask({ ...task, phase: 'terminal', message: `${explicitProject ? '项目已创建，' : ''}生成未受理：${safeMessage(error)}` });
        this.setDraft(payload.prompt); if (error.status === 401) this.unauthorized();
      } else { this.setTask({ ...task, phase: 'unknown', message: safeMessage(error) }); void this.query(true); }
    } finally { if (this.streamController === controller) this.streamController = undefined; }
  }
  private async calibrate(projectId: string, activation: number) {
    try { const page = await this.api.messages(projectId, undefined, this.getController.signal);
      if (this.matches(activation, projectId)) this.update({ messages: mergeMessages(this.state.messages, page.items), before: this.state.before ?? page.nextBeforeSequence });
    } catch { /* The task remains queryable; do not replace persistence with invented messages. */ }
  }
  private acceptState(state: GenerationStatus) {
    const task = this.state.task; if (!task || task.phase === 'terminal' || this.state.route.kind !== 'project' || state.projectId !== this.state.route.projectId || state.requestId !== task.payload.requestId || state.baseVersionId !== task.payload.baseVersionId) return;
    const terminal = state.terminalStatePersisted && !['running','unknown'].includes(state.status);
    this.setTask({ ...task, state, accepted: true, phase: terminal ? 'terminal' : state.cancellationRequested ? 'cancelling' : state.status === 'running' ? 'active' : 'unknown',
      message: terminal ? state.status === 'succeeded' ? '候选已保存，尚未采用。' : `任务已结束：${state.status} · ${state.errorCode ?? ''}` : '结果尚待服务端确认。' });
    if (terminal) {
      clearTimeout(this.poll); this.polling = false; this.pending.remove(state.projectId);
      if (state.status !== 'succeeded' && !this.state.draft) this.setDraft(task.payload.prompt);
      void this.calibrate(state.projectId, this.state.activation);
      if (state.candidateVersionId) void this.loadCandidate(state.projectId, state.candidateVersionId, this.state.activation);
    }
  }
  private async loadCandidate(projectId: string, versionId: string, activation: number) {
    try {
      const [detail, review] = await Promise.all([this.api.project(projectId, this.getController.signal), getVersion(projectId, versionId,
        { signal: this.getController.signal, ...(this.options.transport ? { transport: this.options.transport } : {}) })]);
      if (this.matches(activation, projectId)) this.update({ project: detail, review, selected: review.version });
    } catch (error) { if (this.matches(activation, projectId)) { if (error instanceof VersionApiError && error.status === 401) this.unauthorized(); else this.update({ error: `候选已保存，但读取失败：${safeMessage(error)}` }); } }
  }
  async cancel() {
    if (this.state.route.kind !== 'project' || !this.state.task || this.state.task.phase === 'terminal') return;
    const activation = this.state.activation; const { projectId } = this.state.route; const requestId = this.state.task.payload.requestId;
    try {
      const state = await this.api.cancel(projectId, requestId, this.getController.signal);
      if (this.matches(activation, projectId) && this.state.task?.payload.requestId === requestId && this.snapshot().task?.phase !== 'terminal') {
        this.acceptState(state); if (state.status === 'running') this.setTask({ ...this.state.task, phase: 'cancelling', message: '已请求取消，正在等待实际终态…' });
      }
    } catch (error) { if (this.matches(activation, projectId) && this.snapshot().task?.phase !== 'terminal') this.update({ error: `取消请求未确认：${safeMessage(error)}` }); }
  }
  async query(automatic = false) {
    if (this.state.route.kind !== 'project' || !this.state.task || this.state.task.phase === 'terminal') return;
    clearTimeout(this.poll); const { projectId } = this.state.route; const activation = this.state.activation; const requestId = this.state.task.payload.requestId;
    if (!automatic) { this.checks = 0; this.checkStarted = (this.options.now ?? Date.now)(); }
    this.checkStarted ||= (this.options.now ?? Date.now)(); const task = this.state.task;
    if (this.checks >= 75 || (this.options.now ?? Date.now)() - this.checkStarted >= 150_000) { this.polling = false; this.setTask({ ...task, phase: 'unknown', message: '自动查询已暂停或达到限额，请手动查询结果。' }); return; }
    this.checks++;
    this.setTask({ ...task, phase: 'checking', message: '正在查询原请求结果，不会重发生成…' });
    try {
      const state = await this.api.status(projectId, requestId, this.getController.signal);
      if (!this.matches(activation, projectId) || this.state.task?.payload.requestId !== requestId) return;
      this.acceptState(state);
      if ((automatic || !this.streamController) && state.status === 'running') this.schedule();
    } catch (error) {
      if (!this.matches(activation, projectId) || this.state.task?.payload.requestId !== requestId || this.snapshot().task?.phase === 'terminal') return;
      this.setTask({ ...this.state.task, phase: 'unknown', message: `结果待确认：${safeMessage(error)}。可查询或手动重试原请求。` });
      if (automatic && error instanceof VersionApiError && error.status === 429) this.schedule((error.retryAfter ?? 2) * 1000);
    }
  }
  private schedule(delay = this.options.pollMs ?? 2000) {
    this.polling = true;
    this.nextCheckAt = (this.options.now ?? Date.now)() + delay;
    if (this.hidden) return;
    if (this.checks >= 75 || (this.options.now ?? Date.now)() - this.checkStarted + delay >= 150_000) {
      this.polling = false;
      if (this.state.task?.phase !== 'terminal' && this.state.task) this.setTask({ ...this.state.task, phase: 'unknown', message: '自动查询已暂停或达到限额，请手动查询结果。' }); return;
    }
    this.poll = setTimeout(() => { void this.query(true); }, delay);
  }
  visibility(hidden: boolean) { this.hidden = hidden; if (hidden) clearTimeout(this.poll); else if (this.polling && this.state.task && ['checking','active','cancelling','unknown'].includes(this.state.task.phase) && !this.streamController) this.schedule(Math.max(0, this.nextCheckAt - (this.options.now ?? Date.now)())); }
}
