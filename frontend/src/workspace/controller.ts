import { generationBodySchema } from '@atoms/contracts';
import type { GenerationEvent, GenerationStatus, Message, Project, ProjectDetail, Version, VersionReview, z, templateListSchema } from '@atoms/contracts';
import { createWorkspaceApi } from '../api/workspace';
import { generate } from '../api/generation-stream';
import type { GenerationBody } from '../api/generation-stream';
import { adoptVersion, getVersion, getVersionHistory, restoreVersion, VersionApiError } from '../api/versions';
import { previewKey } from '../preview/state';
import type { PreviewState } from '../preview/state';
import { initialHistory, initialOperation, mergeHistory, operationBlocks } from './history-state';
import type { HistoryState, VersionOperation } from './history-state';
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
  task: Task | null; draft: string; view: 'chat' | 'preview' | 'code' | 'history'; storageWarning: string;
  history: HistoryState; intent: 'current' | 'candidate' | 'history'; viewedVersionId: string | null; selectedReview: VersionReview | null; selectedReviewEpoch: number;
  detailLoading: boolean; detailError: string; preview: PreviewState | null; previewAttempt: number; operation: VersionOperation; factEpoch: number;
};
export const mergeMessages = (old: Message[], incoming: Message[]) => [...new Map([...old, ...incoming].map(item => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence);
const safeMessage = (error: unknown) => error instanceof VersionApiError ? `${workspaceError(error).message}${error.status ? `（HTTP ${error.status}）` : ''}` : '连接或任务结果未确认，请查询原请求。';
export class WorkspaceController {
  private state: WorkspaceState = { route: routeFor('/__initial'), activation: 0, loading: false, error: '', templates: [], projects: [], cursor: null,
    home: { title: '', prompt: '', templateId: '', status: 'idle', message: '', sessionReady: false }, project: null, review: null, selected: null,
    messages: [], before: null, task: null, draft: '', view: 'chat', storageWarning: '', history: initialHistory(), intent: 'current', viewedVersionId: null,
    selectedReview: null, selectedReviewEpoch: 0, detailLoading: false, detailError: '', preview: null, previewAttempt: 0, operation: initialOperation(), factEpoch: 0 };
  private readonly subscribers = new Set<() => void>();
  private readonly drafts = new Map<string, string>();
  private readonly conversations = new Map<string, { items: Message[]; before: number | null }>();
  readonly reading = new Map<string, number>();
  readonly api;
  readonly pending;
  private getController = new AbortController();
  private streamController: AbortController | undefined;
  private detailController: AbortController | undefined;
  private historyController: AbortController | undefined;
  private candidateController: AbortController | undefined;
  private detailRead = 0; private factsRead = 0; private writeId = 0; private writing = false;
  private restoreReadPending = false;
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
  private clearPrivate() { this.drafts.clear(); this.conversations.clear(); this.reading.clear(); this.pending.clear(); this.update({ projects: [], project: null, review: null, selected: null, selectedReview: null, viewedVersionId: null, messages: [], task: null, draft: '', history: initialHistory(), preview: null, operation: initialOperation() }); }
  private unauthorized() { this.sessionInvalidated = true; this.leave(); this.clearPrivate(); this.update({ activation: this.state.activation + 1, loading: false, error: '会话已失效。请返回首页明确重新开始；不会自动认领旧项目。', home: { ...this.state.home, sessionReady: false } }); }
  private matches(activation: number, projectId?: string) { return this.state.activation === activation && (!projectId || this.state.route.kind === 'project' && this.state.route.projectId === projectId); }
  leave() { this.getController.abort(); this.detailController?.abort(); this.historyController?.abort(); this.candidateController?.abort(); this.detailRead++; this.factsRead++; this.writeId++; this.writing = false; this.streamController?.abort(); this.streamController = undefined; clearTimeout(this.poll); this.poll = undefined; this.polling = false; this.checks = 0; this.checkStarted = 0; this.nextCheckAt = 0; }
  activate(route: Route, force = false) {
    if (!force && route.path === this.state.route.path) return;
    if (this.state.route.kind === 'project' && this.state.project) this.conversations.set(this.state.route.projectId, { items: this.state.messages, before: this.state.before });
    const cached = route.kind === 'project' ? this.conversations.get(route.projectId) : undefined;
    this.leave(); this.restoreReadPending = false; this.getController = new AbortController(); const activation = this.state.activation + 1;
    this.update({ route, activation, loading: route.kind === 'home' || route.kind === 'project', error: '', project: null, review: null, selected: null,
      messages: cached?.items ?? [], before: cached?.before ?? null, task: null, draft: route.kind === 'project' ? this.drafts.get(route.projectId) ?? '' : '', view: 'chat',
      history: initialHistory(this.state.history.epoch + 1), intent: 'current', viewedVersionId: null, selectedReview: null, detailLoading: false, detailError: '',
      preview: null, previewAttempt: this.state.previewAttempt + 1, operation: initialOperation(), factEpoch: this.state.factEpoch + 1 });
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
    const epoch = this.state.factEpoch;
    try {
      const detail = await this.api.project(projectId, signal); const page = await this.api.messages(projectId, undefined, signal);
      const local = this.pending.get(projectId);
      const task = this.state.task; // A create command may already own a live stream while GETs load.
      const run = detail.latestRun; const candidateId = task?.state?.candidateVersionId ?? (!local && run?.status === 'succeeded' ? run.resultVersionId : null);
      const review = await getVersion(projectId, candidateId ?? detail.project.currentVersionId, { signal, ...(this.options.transport ? { transport: this.options.transport } : {}) });
      if (!this.matches(activation, projectId) || signal.aborted) return;
      const initialize = !this.state.viewedVersionId;
      this.update({ loading: false, project: epoch === this.state.factEpoch ? detail : this.state.project, review: this.state.review ?? review,
        ...(initialize ? { selected: review.version, selectedReview: review, selectedReviewEpoch: epoch, viewedVersionId: review.version.id, intent: candidateId ? 'candidate' as const : 'current' as const } : {}), messages: mergeMessages(this.state.messages, page.items), before: this.conversations.get(projectId)?.before ?? (this.conversations.has(projectId) ? null : page.nextBeforeSequence),
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
    } catch (error) { if (this.matches(activation, projectId) && !signal.aborted && !this.privateFailure(error)) this.update({ loading: false, error: safeMessage(error) }); }
  }
  setDraft(value: string) { if (this.state.route.kind === 'project') this.drafts.set(this.state.route.projectId, value); this.update({ draft: value }); }
  setView(view: WorkspaceState['view']) { this.update({ view }); if (view === 'history' && !this.state.history.loaded && !this.state.history.loading) void this.loadHistory(); }
  expireSession() { this.unauthorized(); }
  facts(project: ProjectDetail, activation: number, target?: string) {
    if (!this.matches(activation, project.project.id) || (target && this.state.review?.version.id !== target)) return;
    const changed = project.project.currentVersionId !== this.state.project?.project.currentVersionId;
    const followCurrent = changed && this.state.intent === 'current' && !this.state.draft && this.state.operation.status === 'idle';
    if (changed && this.state.intent === 'current') { this.detailRead++; this.detailController?.abort(); }
    this.update({ project, factEpoch: this.state.factEpoch + 1, projects: this.state.projects.map(item => item.id === project.project.id ? project.project : item),
      history: { ...this.state.history, items: mergeHistory(this.state.history.items, [], project.project.currentVersionId) },
      ...(changed && this.state.intent === 'current' ? { detailLoading: false } : {}),
      ...(followCurrent ? { selected: project.currentVersion, selectedReview: null, viewedVersionId: project.currentVersion.id, detailError: '', preview: null, previewAttempt: this.state.previewAttempt + 1 } : {}) });
    this.validateConfirmation();
  }
  select(version: Version, activation: number, target?: string) { if (this.matches(activation, version.projectId) && (!target || this.state.review?.version.id === target) && this.state.selected?.id !== version.id) this.update({ selected: version }); }
  historyPosition(scrollTop: number) { this.update({ history: { ...this.state.history, scrollTop } }); }
  async loadHistory(more = false, refresh = false) {
    const project = this.state.project; if (!project || (this.state.history.loading && !refresh)) return;
    if (more && (!this.state.history.loaded || this.state.history.before === null)) return;
    this.historyController?.abort(); const controller = new AbortController(); this.historyController = controller;
    const activation = this.state.activation; const projectId = project.project.id; const factEpoch = this.state.factEpoch;
    const history = refresh ? initialHistory(this.state.history.epoch + 1) : this.state.history;
    const epoch = history.epoch; const before = more ? history.before : null;
    this.update({ history: { ...history, loading: true, error: '' } });
    const valid = () => this.matches(activation, projectId) && this.state.history.epoch === epoch && this.historyController === controller && !controller.signal.aborted;
    try {
      const page = await getVersionHistory(projectId, { ...this.requestOptions(controller.signal), limit: 20, ...(before === null ? {} : { beforeSequence: before }) });
      if (!valid()) return;
      this.update({ history: { ...this.state.history, loaded: true, loading: false, before: page.nextBeforeSequence,
        items: mergeHistory(more ? this.state.history.items : [], page.items, this.state.project?.project.currentVersionId ?? '') } });
      // List current fields are observations, never authority over acknowledged project facts.
      if (factEpoch === this.state.factEpoch && page.currentVersionId !== this.state.project?.project.currentVersionId && !this.writing && !operationBlocks(this.state.operation)) void this.refreshCurrent();
    } catch (error) {
      if (!valid()) return;
      if (this.privateFailure(error)) return;
      this.update({ history: { ...this.state.history, loading: false, error: safeMessage(error) } });
    }
  }
  private requestOptions(signal = this.getController.signal) { return { signal, ...(this.options.transport ? { transport: this.options.transport } : {}) }; }
  private privateFailure(error: unknown, target?: string) {
    if (!(error instanceof VersionApiError)) return false;
    if (error.status === 401) { this.unauthorized(); return true; }
    if (error.status === 404 && target) {
      this.update({ history: { ...this.state.history, items: this.state.history.items.filter(item => item.id !== target) },
        ...(this.state.review?.version.id === target ? { review: null } : {}),
        ...(this.state.viewedVersionId === target ? { selected: null, selectedReview: null, viewedVersionId: null, detailLoading: false, detailError: '该版本不可访问，请选择其他版本。', preview: null } : {}) });
      this.validateConfirmation();
    }
    if (error.status === 404 && !target) {
      const projectId = this.state.project?.project.id;
      this.leave(); if (projectId) { this.conversations.delete(projectId); this.reading.delete(projectId); this.pending.remove(projectId); }
      this.update({ activation: this.state.activation + 1, project: null, review: null, selected: null, selectedReview: null, viewedVersionId: null, messages: [], task: null,
        projects: this.state.projects.filter(project => project.id !== projectId), history: initialHistory(this.state.history.epoch + 1),
        operation: { ...this.state.operation, querying: false, refreshError: '项目不可访问，请返回项目导航选择。' },
        preview: null, detailLoading: false, loading: false, error: '项目不可访问，请返回项目导航选择。' });
      this.validateConfirmation(); return true;
    }
    return false;
  }
  async viewVersion(intent: WorkspaceState['intent'], versionId?: string) {
    const project = this.state.project; if (!project) return;
    const target = versionId ?? (intent === 'current' ? project.project.currentVersionId : this.state.review?.version.id);
    if (!target) return;
    this.detailController?.abort(); const controller = new AbortController(); this.detailController = controller;
    const activation = this.state.activation; const projectId = project.project.id; const read = ++this.detailRead; const epoch = this.state.factEpoch;
    this.update({ intent, viewedVersionId: target, selected: null, selectedReview: null, detailLoading: true, detailError: '', preview: null, previewAttempt: this.state.previewAttempt + 1 });
    this.validateConfirmation();
    const valid = () => this.matches(activation, projectId) && this.detailRead === read && this.state.viewedVersionId === target && !controller.signal.aborted;
    try {
      const review = await getVersion(projectId, target, this.requestOptions(controller.signal));
      if (!valid()) return;
      // The detail's current/adoption fields may predate a write. Only its immutable snapshot is selected.
      this.update({ selected: review.version, selectedReview: review, selectedReviewEpoch: epoch, detailLoading: false });
    } catch (error) {
      if (!valid() || this.privateFailure(error, target)) return;
      this.update({ detailLoading: false, detailError: safeMessage(error) });
    }
  }
  previewIdentity() {
    const version = this.state.selected; const project = this.state.project;
    return version && project ? previewKey(project.project.id, version.id, version.snapshot.digest, this.state.previewAttempt) : null;
  }
  previewState(preview: PreviewState, activation: number) {
    if (activation !== this.state.activation || preview.key !== this.previewIdentity()) return;
    const old = this.state.preview;
    if (old?.key === preview.key && !['compiling', 'compiled'].includes(old.status)) return;
    this.update({ preview }); this.validateConfirmation();
  }
  retryPreview() { this.update({ preview: null, previewAttempt: this.state.previewAttempt + 1 }); this.validateConfirmation(); }
  private runBlocks() {
    const task = this.state.task; const run = this.state.project?.latestRun;
    const knownTerminal = task?.phase === 'terminal' && task.state?.terminalStatePersisted && task.state.runId === run?.id;
    return Boolean(task && task.phase !== 'terminal') || Boolean(run?.status === 'running' && !knownTerminal);
  }
  versionWriteAvailable(kind: 'restore' | 'adopt') {
    const { selected, project, preview, operation, intent } = this.state;
    if (!selected || !project || this.writing || operationBlocks(operation) || operation.refreshError || this.runBlocks() || preview?.key !== this.previewIdentity() || preview?.status !== 'compiled' || selected.id === project.project.currentVersionId) return false;
    return kind === 'restore' ? intent === 'history' : intent === 'candidate' && selected.kind === 'generated' &&
      Boolean(this.state.selectedReview?.successfulRun) && selected.parentVersionId === project.project.currentVersionId &&
      (this.state.selectedReviewEpoch !== this.state.factEpoch || this.state.selectedReview?.adoptionAvailability === 'eligible');
  }
  openRestore() {
    if (!this.versionWriteAvailable('restore')) return;
    const { selected, project, activation, previewAttempt } = this.state; if (!selected || !project) return;
    this.update({ operation: { ...initialOperation(), status: 'confirming', target: selected.id, expected: project.project.currentVersionId,
      frozen: { projectId: project.project.id, activation, target: selected.id, sequence: selected.sequence, expected: project.project.currentVersionId, digest: selected.snapshot.digest, attempt: previewAttempt },
      message: '检查关键交互后，明确确认恢复。' } });
  }
  cancelRestore() { if (this.state.operation.status === 'confirming') this.update({ operation: { ...initialOperation(), message: '已取消恢复，当前代码未由此操作更改。' } }); }
  private validateConfirmation() {
    const { operation, selected, project, preview, previewAttempt } = this.state; const frozen = operation.frozen;
    if (operation.status !== 'confirming' || !frozen) return;
    if (frozen.activation !== this.state.activation || frozen.projectId !== project?.project.id || frozen.target !== selected?.id || frozen.expected !== project?.project.currentVersionId ||
      frozen.digest !== selected?.snapshot.digest || frozen.attempt !== previewAttempt || preview?.key !== this.previewIdentity() || preview?.status !== 'compiled' || this.runBlocks()) {
      this.update({ operation: { ...initialOperation(), message: '恢复确认已失效：版本、当前引用、任务或预览状态已变化，请重新检查。' } });
    }
  }
  async submitRestore() {
    this.validateConfirmation(); const operation = this.state.operation;
    if (operation.status !== 'confirming' || !operation.frozen || this.writing) return;
    await this.writeVersion('restore', operation.target, operation.expected);
  }
  async submitAdoption(manualRetry = false) {
    const operation = this.state.operation;
    if (manualRetry) {
      const { selected, project, preview } = this.state;
      if (operation.kind !== 'adopt' || operation.status !== 'unknown' || operation.querying || this.writing || this.runBlocks() || selected?.id !== operation.target ||
        project?.project.currentVersionId !== operation.expected || preview?.key !== this.previewIdentity() || preview?.status !== 'compiled') return;
      await this.writeVersion('adopt', operation.target, operation.expected); return;
    }
    if (!this.versionWriteAvailable('adopt') || !this.state.selected || !this.state.project) return;
    await this.writeVersion('adopt', this.state.selected.id, this.state.project.project.currentVersionId);
  }
  private async writeVersion(kind: 'restore' | 'adopt', target: string, expected: string) {
    const project = this.state.project; const selected = this.state.selected; if (!project || !selected || selected.id !== target || this.writing) return;
    this.writing = true; const id = ++this.writeId; const activation = this.state.activation; const projectId = project.project.id;
    // Invalidate every project read started before this write, including candidate calibration.
    this.factsRead++; this.update({ factEpoch: this.state.factEpoch + 1, operation: { ...initialOperation(), kind, target, expected, status: 'submitting', message: kind === 'restore' ? '正在请求恢复…' : '正在请求采用…' } });
    const valid = () => this.matches(activation, projectId) && this.writeId === id && !this.getController.signal.aborted;
    try {
      const saved = await (kind === 'restore' ? restoreVersion : adoptVersion)(projectId, target, expected, this.requestOptions());
      if (!valid()) return;
      if (kind === 'restore') this.restoreReadPending = true;
      this.facts({ ...project, project: { ...project.project, currentVersionId: target, updatedAt: saved.updatedAt }, currentVersion: selected }, activation);
      this.update({ operation: { ...this.state.operation, status: 'confirmed', message: kind === 'restore' ? '服务端已确认恢复此版本；其他历史继续保留。' : '服务端已确认使用这个版本。' } });
      await this.refreshCurrent(true, id);
    } catch (error) {
      if (!valid() || this.privateFailure(error, target)) return;
      const known = error instanceof VersionApiError && error.kind === 'http';
      const status: VersionOperation['status'] = !known ? 'unknown' : error.code === 'CURRENT_VERSION_CONFLICT' ? 'conflict' : error.code === 'PROJECT_BUSY' ? 'busy' : error.code === 'RUN_STATE_UNCONFIRMED' ? 'unconfirmed' : 'error';
      const message = !known ? '操作结果待确认，正在查询当前版本；不会自动重发。' : status === 'conflict'
        ? '当前版本已改变，请查询实际项目并重新检查预览后确认。' : kind === 'restore' ? error.message : safeMessage(error);
      this.update({ operation: { ...this.state.operation, status, message } });
      if (!known || status === 'conflict') await this.refreshCurrent(true, id);
    } finally { if (valid()) { this.writing = false; this.update({}); } }
  }
  async refreshCurrent(reconcile = false, writeId = this.writeId) {
    const project = this.state.project; if (!project || this.state.operation.querying || (this.writing && !reconcile)) return;
    const activation = this.state.activation; const projectId = project.project.id; const epoch = this.state.factEpoch; const read = ++this.factsRead;
    const operation = this.state.operation;
    this.update({ operation: { ...operation, querying: true, refreshError: '' } });
    const valid = () => this.matches(activation, projectId) && this.writeId === writeId && this.factsRead === read && this.state.factEpoch === epoch;
    try {
      const detail = await this.api.project(projectId, this.getController.signal); if (!valid()) return;
      // Keep the inspected baseline below; a different current still requires explicit selection.
      this.restoreReadPending = false;
      this.facts(detail, activation);
      const current = detail.project.currentVersionId;
      let next = { ...this.state.operation, querying: false };
      if (operation.status === 'unknown') next = { ...next, status: current === operation.target ? 'confirmed' : 'unknown', message: current === operation.target
        ? '已查询确认：当前已为该版本。' : `观察到当前版本 ${current}；原操作结果仍未确认，请手动查询，不能开始其他写入。` };
      else if (operation.status === 'confirmed' && current !== operation.target) next = { ...next, message: `服务端曾确认本次操作；当前已被其他操作改为 ${current}。` };
      else if (['busy', 'unconfirmed'].includes(operation.status) && detail.latestRun?.status !== 'running') next = { ...next, status: 'error', message: '项目事实已刷新，请重新预览并确认操作。' };
      this.update({ operation: next });
      if (operation.status === 'conflict' || ['busy', 'unconfirmed'].includes(operation.status) || (operation.status === 'unknown' && current === operation.target)) this.retryPreview();
    } catch (error) {
      if (!valid() || this.privateFailure(error)) return;
      this.update({ operation: { ...this.state.operation, querying: false, refreshError: operation.status === 'confirmed' ? '操作已确认；项目信息刷新失败，请再次查询核对。' : '项目查询失败，请手动查询；不会重发写入。' } });
    } finally {
      if (this.matches(activation, projectId) && this.factsRead === read && this.state.operation.querying) this.update({ operation: { ...this.state.operation, querying: false } });
    }
  }
  async earlier() {
    if (this.state.route.kind !== 'project' || !this.state.before) return; const { projectId } = this.state.route; const activation = this.state.activation;
    try { const page = await this.api.messages(projectId, this.state.before, this.getController.signal);
      if (this.matches(activation, projectId)) this.update({ messages: mergeMessages(page.items, this.state.messages), before: page.nextBeforeSequence });
    } catch (error) { if (this.matches(activation, projectId)) this.update({ error: safeMessage(error) }); }
  }
  private setTask(task: Task) { this.update({ task }); this.validateConfirmation(); }
  async start(prompt = this.state.draft, explicitProject?: ProjectDetail, original = false) {
    if (this.writing || operationBlocks(this.state.operation)) return;
    if (!original && (this.restoreReadPending || this.state.operation.refreshError)) { this.update({ error: '请先成功查询当前版本，再提交下一条需求。' }); return; }
    if (!original && this.runBlocks()) return;
    if (original && this.state.task?.phase !== 'unknown') return;
    const project = explicitProject ?? this.state.project; if (!project || this.state.route.kind !== 'project') return;
    if (!original && this.state.task && !['terminal'].includes(this.state.task.phase)) return;
    if (!original && this.state.selected?.id !== project.project.currentVersionId) { this.update({ error: '请先采用候选或查看当前版本，再提交下一条需求。' }); return; }
    let payload: GenerationBody;
    try { payload = original && this.state.task ? generationBodySchema.parse(this.state.task.payload)
      : generationBodySchema.parse({ requestId: crypto.randomUUID(), baseVersionId: project.project.currentVersionId, prompt }); }
    catch { this.update({ error: '需求须为 1–4000 字符且不超过 16 KiB。' }); return; }
    const projectId = project.project.id; const activation = this.state.activation;
    this.candidateController?.abort(); this.candidateController = undefined;
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
       if (state.candidateVersionId) void this.loadCandidate(state, this.state.activation);
    }
  }
  private async loadCandidate(origin: GenerationStatus, activation: number) {
    const { projectId, candidateVersionId: versionId, requestId, runId } = origin; if (!versionId) return;
    this.candidateController?.abort(); const controller = new AbortController(); this.candidateController = controller;
    const epoch = this.state.factEpoch;
    const valid = () => {
      const task = this.state.task;
      return this.matches(activation, projectId) && this.candidateController === controller && !controller.signal.aborted &&
        task?.payload.requestId === requestId && task.state?.runId === runId && task.state?.candidateVersionId === versionId;
    };
    try {
      const [detail, review] = await Promise.all([this.api.project(projectId, controller.signal), getVersion(projectId, versionId,
        this.requestOptions(controller.signal))]);
      if (valid()) {
        if (epoch === this.state.factEpoch) this.facts(detail, activation);
        if (!valid()) return;
        this.update({ review });
        if (valid() && this.state.intent !== 'history') void this.viewVersion('candidate', versionId);
      }
    } catch (error) { if (valid()) { if (error instanceof VersionApiError && error.status === 401) this.unauthorized(); else this.update({ error: `候选已保存，但读取失败：${safeMessage(error)}` }); } }
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
