import { VersionApiError } from './versions';
const explanations = {
  SESSION_REQUIRED: '会话已失效，请明确重新开始。', NOT_FOUND: '项目或请求不存在，或不属于当前会话。', MODEL_CONFIGURATION: '模型服务尚未配置。',
  PROJECT_BUSY: '项目正在执行其他任务。', SESSION_BUSY: '当前会话正在执行其他任务。', GENERATION_CAPACITY: '生成服务已满，请稍后重试。',
  GENERATION_QUOTA: '当前会话已达到生成配额。', RATE_LIMITED: '请求频率过高，请稍后再查询。', RUN_STATE_UNCONFIRMED: '服务端无法确认原任务状态。',
  BASE_VERSION_CHANGED: '当前版本已改变，请刷新后明确提交新需求。', REQUEST_CONFLICT: '请求标识与原需求不一致。', STORAGE_UNAVAILABLE: '存储暂不可用，结果需确认。',
  INVALID_INPUT: '请求内容无效。', ORIGIN_NOT_ALLOWED: '请求来源不被允许。', TEMPLATE_CONFLICT: '模板已变化，请重新读取目录。', PROJECT_LIMIT_REACHED: '当前会话项目数已达上限。',
} as const;
export function workspaceError(error: VersionApiError) {
  if (error.kind !== 'http') return error;
  const code = error.code && Object.hasOwn(explanations, error.code) ? error.code : null;
  const message = code ? Reflect.get(explanations, code) : `服务请求失败（HTTP ${error.status ?? 500}）。`;
  return new VersionApiError('http', typeof message === 'string' ? message : '服务请求失败。', error.status, code, error.retryAfter);
}
