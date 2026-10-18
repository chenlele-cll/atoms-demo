import { backwardMessageListSchema, generationBodySchema, generationStatusSchema, idSchema, listQuerySchema, messageListSchema, projectListSchema,
  projectRequestSchema, sessionResponseSchema, templateListSchema } from '@atoms/contracts';
import { getProject, versionRequest, VersionApiError } from './versions';
import type { ApiOptions } from './versions';
import { workspaceError } from './workspace-error';

export function createWorkspaceApi(options: { transport?: typeof fetch; onNewSession?: () => void; onUnauthorized?: () => void } = {}) {
  let initialization: Promise<{ expiresAt: string; created: boolean }> | undefined;
  const request = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) {
      if (error instanceof VersionApiError && error.status === 401) { initialization = undefined; options.onUnauthorized?.(); }
      throw error instanceof VersionApiError ? workspaceError(error) : error;
    }
  };
  const config = (signal?: AbortSignal): ApiOptions => ({ ...(signal ? { signal } : {}), ...(options.transport ? { transport: options.transport } : {}) });
  const path = (projectId: string) => `/api/projects/${idSchema.parse(projectId)}`;
  const api = {
    session: () => initialization ??= request(async () => {
      let created = false;
      const session = await versionRequest('/api/session', sessionResponseSchema, { ...config(), onResponse: response => { created = response.status === 201; } }, {});
      if (created) options.onNewSession?.(); return { ...session, created };
    }).catch(error => { initialization = undefined; throw error; }),
    resetSession: () => { initialization = undefined; },
    templates: (signal?: AbortSignal) => request(() => versionRequest('/api/templates', templateListSchema, config(signal))),
    projects: (cursor?: string, signal?: AbortSignal) => request(() => {
      const query = listQuerySchema.parse({ limit: '20', ...(cursor ? { cursor } : {}) });
      return versionRequest(`/api/projects?limit=${query.limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, projectListSchema, config(signal));
    }),
    create: (body: unknown, signal?: AbortSignal) => request(() => versionRequest('/api/projects',
      // The shared project response validates full snapshot/digest before a new ID is used.
      projectResponse, config(signal), projectRequestSchema.parse(body))),
    project: (projectId: string, signal?: AbortSignal) => request(() => getProject(projectId, config(signal))),
    messages: async (projectId: string, before?: number, signal?: AbortSignal) => {
      const page = await request(() => versionRequest(`${path(projectId)}/messages?direction=backward&limit=50${before === undefined ? '' : `&beforeSequence=${before}`}`,
        backwardMessageListSchema, config(signal)));
      if (page.items.some((message, index) => message.projectId !== projectId || (index > 0 && message.sequence <= (page.items[index - 1]?.sequence ?? 0)))) throw new VersionApiError('invalid', '对话关联或顺序无效。');
      return page;
    },
    incremental: (projectId: string, after: number, signal?: AbortSignal) => request(() => versionRequest(`${path(projectId)}/messages?afterSequence=${after}&limit=50`, messageListSchema, config(signal))),
    status: async (projectId: string, requestId: string, signal?: AbortSignal) => {
      const value = await request(() => versionRequest(`${path(projectId)}/generations/by-request/${idSchema.parse(requestId)}`, generationStatusSchema, config(signal)));
      if (value.projectId !== projectId || value.requestId !== requestId) throw new VersionApiError('invalid', '任务关联无效。'); return value;
    },
    cancel: async (projectId: string, requestId: string, signal?: AbortSignal) => {
      const value = await request(() => versionRequest(`${path(projectId)}/generations/by-request/${idSchema.parse(requestId)}/cancel`, generationStatusSchema, config(signal), {}));
      if (value.projectId !== projectId || value.requestId !== requestId) throw new VersionApiError('invalid', '任务关联无效。'); return value;
    },
    validateGeneration: generationBodySchema.parse,
  };
  return api;
}
import { projectDetailSchema as projectResponse } from '@atoms/contracts';
export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>;
