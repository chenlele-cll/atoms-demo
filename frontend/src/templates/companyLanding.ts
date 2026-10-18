import manifest from '../../../templates/company-landing/manifest.json';
import { verifyTemplateBundle } from '../../../templates/bundle.mjs';
import type { TemplateBundle } from '../../../templates/bundle.mjs';

export const companyTemplate = manifest;
export const companyTemplateURL = '/template-assets/company-landing.bundle.json';

export async function loadCompanyTemplate(signal: AbortSignal): Promise<TemplateBundle> {
  const response = await fetch(companyTemplateURL, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`模板资源加载失败（HTTP ${response.status}）。`);
  const maxResponseBytes = 8 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maxResponseBytes || !response.body) {
    await response.body?.cancel();
    throw new Error('模板资源大小或响应内容无效。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('模板资源响应超过大小限制。');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('模板资源不是有效的 JSON。'); }
  return verifyTemplateBundle(body, manifest);
}
