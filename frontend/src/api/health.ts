export async function checkBackend(): Promise<void> {
  const response = await fetch('/api/health', {
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`后端返回 HTTP ${response.status}`);
  }

  const body: unknown = await response.json();

  if (
    typeof body !== 'object' || body === null ||
    !('status' in body) || body.status !== 'ok' ||
    !('service' in body) || body.service !== 'atoms-backend'
  ) {
    throw new Error('后端健康检查响应格式不正确');
  }
}
