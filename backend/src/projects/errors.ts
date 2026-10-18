const definitions = {
  INVALID_INPUT: [400, 'Invalid request.'], SESSION_REQUIRED: [401, 'Initialize a valid session.'],
  ORIGIN_NOT_ALLOWED: [403, 'Request origin is not allowed.'], NOT_FOUND: [404, 'Resource not found.'],
  TEMPLATE_CONFLICT: [409, 'Template version or digest has changed.'], PROJECT_LIMIT_REACHED: [409, 'Project limit reached.'],
  CONFLICT: [409, 'Record conflicts with existing state.'], RATE_LIMITED: [429, 'Too many requests.'],
  REQUEST_CONFLICT: [409, 'Request identifier was already used for different input.'],
  BASE_VERSION_CHANGED: [409, 'Project base version has changed.'],
  GENERATION_QUOTA: [429, 'Generation daily quota reached.'],
  BODY_TOO_LARGE: [413, 'Request body is too large.'], JSON_REQUIRED: [415, 'JSON content type is required.'],
  STORAGE_UNAVAILABLE: [503, 'Storage is temporarily unavailable.'], DATA_CORRUPT: [500, 'Stored data is invalid.'],
  INTERNAL_ERROR: [500, 'Request could not be completed.'], INVALID_CONFIGURATION: [500, 'Invalid server configuration.'],
} as const;
export type ProjectErrorCode = keyof typeof definitions;
export class ProjectError extends Error {
  readonly status: number;
  constructor(readonly code: ProjectErrorCode, readonly retryAfter?: number) {
    super(definitions[code][1]); this.name = 'ProjectError'; this.status = definitions[code][0];
  }
}
export function storageOperation<T>(work: () => T): T {
  try { return work(); } catch (error) {
    if (error instanceof ProjectError) throw error;
    // No SQL, path, parameters or underlying exception survives this boundary.
    throw new ProjectError('STORAGE_UNAVAILABLE');
  }
}
