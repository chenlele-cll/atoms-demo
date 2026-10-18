export const MAX_TEMPLATE_FILES = 64;
export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;

const encoder = new TextEncoder();
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };

export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('模板内容无法编码为 JSON。');
  return encoded;
}

export async function contentDigest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalJSON(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateVirtualPath(path) {
  if (typeof path !== 'string' || path.length > 240 ||
      !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(path) ||
      path.slice(1).split('/').some((part) => part === '.' || part === '..' || part.startsWith('.'))) {
    fail('模板文件路径无效。');
  }
}

export function parseTemplateBundle(input, expected) {
  if (!isRecord(expected) || !isRecord(expected.source) || !/^[a-f0-9]{40}$/.test(expected.source.commit) ||
      expected.source.license !== 'MIT' || !isRecord(expected.dependencies)) fail('模板来源清单不完整。');
  if (!isRecord(input) || Object.keys(input).sort().join(',') !== 'category,dependencies,digest,entry,files,id,name,source,version') {
    fail('模板资源结构无效。');
  }
  for (const field of ['id', 'version', 'name', 'category', 'entry']) {
    if (input[field] !== expected[field]) fail('模板标识、版本或入口不匹配。');
  }
  if (!isRecord(input.source) || Object.keys(input.source).sort().join(',') !== 'commit,license,repository' ||
      ['repository', 'commit', 'license'].some((key) => input.source[key] !== expected.source[key])) {
    fail('模板来源不匹配。');
  }
  if (!isRecord(input.dependencies) || canonicalJSON(input.dependencies) !== canonicalJSON(expected.dependencies) ||
      !Object.values(input.dependencies).every((version) => typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version))) {
    fail('模板依赖必须使用清单中固定的版本。');
  }
  if (!isRecord(input.files)) fail('模板缺少文件集合。');
  const entries = Object.entries(input.files);
  if (entries.length === 0 || entries.length > MAX_TEMPLATE_FILES) fail('模板文件数量超限。');
  let bytes = 0;
  for (const [path, code] of entries) {
    validateVirtualPath(path);
    if (!path.startsWith('/src/') && !['/LICENSE', '/package.json', '/public/index.html'].includes(path)) {
      fail('模板文件必须位于虚拟源码或固定运行配置中。');
    }
    if (typeof code !== 'string') fail('模板文件正文无效。');
    bytes += encoder.encode(code).byteLength;
    if (bytes > MAX_TEMPLATE_BYTES) fail('模板文件内容超过 2 MiB。');
  }
  for (const path of [input.entry, '/src/styles.css', '/public/index.html', '/package.json', '/LICENSE']) {
    if (typeof input.files[path] !== 'string' || !input.files[path].trim()) fail('模板缺少入口、样式、HTML 或许可证。');
  }
  if (!input.files['/LICENSE'].includes('MIT License') || !input.files['/LICENSE'].includes('Copyright')) {
    fail('模板许可证不完整。');
  }
  let pkg;
  try { pkg = JSON.parse(input.files['/package.json']); } catch { fail('模板 package.json 无效。'); }
  if (!isRecord(pkg) || pkg.main !== input.entry || canonicalJSON(pkg.dependencies) !== canonicalJSON(input.dependencies) ||
      'scripts' in pkg || 'devDependencies' in pkg) fail('模板运行配置与清单不匹配。');
  if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.digest)) fail('模板内容标识无效。');
  return input;
}

export async function verifyTemplateBundle(input, expected) {
  const bundle = parseTemplateBundle(input, expected);
  const { digest, ...content } = bundle;
  if (await contentDigest(content) !== digest) fail('模板内容标识校验失败。');
  return bundle;
}
