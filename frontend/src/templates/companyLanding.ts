import manifest from '../../../templates/company-landing/manifest.json';
import brandStore from '../../../templates/brand-store/manifest.json';
import personalPortfolio from '../../../templates/personal-portfolio/manifest.json';
import { verifyTemplateBundle } from '../../../templates/bundle.mjs';
import type { TemplateBundle } from '../../../templates/bundle.mjs';

export const companyTemplate = manifest;
export const companyTemplateURL = '/template-assets/company-landing.bundle.json';
export const templateManifests = [manifest, brandStore, personalPortfolio];
export type TemplateIdentity = { id: string; version: number; digest: string };

export function templateManifest(id: string) {
  return templateManifests.find(template => template.id === id);
}

export async function loadCompanyTemplate(signal: AbortSignal): Promise<TemplateBundle> {
  return loadTemplate(companyTemplate.id, signal);
}

export async function loadTemplate(id: string, signal: AbortSignal, expected?: TemplateIdentity): Promise<TemplateBundle> {
  const trusted = templateManifest(id);
  if (!trusted) throw new Error('所选模板暂无可用的交互预览。');
  if (expected && (expected.id !== trusted.id || expected.version !== trusted.version || !/^[a-f0-9]{64}$/.test(expected.digest))) {
    throw new Error('模板版本已变化，请关闭预览并刷新模板列表后重试。');
  }
  const response = await fetch(`/template-assets/${trusted.id}.bundle.json`, {
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
  const bundle = await verifyTemplateBundle(body, trusted);
  if (expected && bundle.digest !== expected.digest) {
    throw new Error('模板版本已变化，请关闭预览并刷新模板列表后重试。');
  }
  return bundle;
}
