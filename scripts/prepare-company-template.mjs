import { readFile, readdir, realpath, mkdir, rename, rm, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { canonicalJSON, contentDigest, verifyTemplateBundle, validateVirtualPath } from '../templates/bundle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
export const templateSource = path.join(root, 'templates/company-landing');
export const templateOutput = path.join(root, 'frontend/public/template-assets/company-landing.bundle.json');
export const backendTemplateDirectory = (target) => {
  if (!['backend-src', 'backend-dist'].includes(target)) throw new Error('模板准备目标无效。');
  return path.join(root, 'backend', target === 'backend-src' ? 'src' : 'dist', 'template-assets');
};

async function collectFiles(directory, base = directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('模板源文件不能使用符号链接。');
    if (entry.isDirectory()) result.push(...await collectFiles(filename, base));
    else if (entry.isFile()) result.push(path.relative(base, filename).split(path.sep).join('/'));
    else throw new Error('模板包含不支持的文件。');
  }
  return result;
}

function validateImports(files, dependencies) {
  for (const [filename, code] of Object.entries(files)) {
    if (!/\.[jt]sx?$/.test(filename)) continue;
    const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g)];
    for (const [, specifier] of imports) {
      if (specifier.startsWith('.')) {
        const target = path.posix.join(path.posix.dirname(filename), specifier);
        if (![target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].some((key) => Object.hasOwn(files, key))) {
          throw new Error(`模板导入无法解析：${filename} → ${specifier}`);
        }
      } else {
        const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!Object.hasOwn(dependencies, packageName)) throw new Error(`模板依赖未声明：${packageName}`);
      }
    }
  }
}

export async function prepareCompanyTemplate({ sourceDirectory = templateSource, outputFile = templateOutput } = {}) {
  const source = await realpath(sourceDirectory);
  const readSource = async (relative) => {
    validateVirtualPath(`/${relative}`);
    const filename = path.join(source, relative);
    if (await realpath(filename) !== filename) throw new Error('模板源文件不能使用符号链接。');
    if ((await stat(filename)).size > 2 * 1024 * 1024) throw new Error('模板源文件大小超限。');
    return readFile(filename);
  };
  const manifest = JSON.parse((await readSource('manifest.json')).toString('utf8'));
  if (!manifest.source?.upstreamFiles?.length || !/^[a-f0-9]{40}$/.test(manifest.source.commit)) {
    throw new Error('模板缺少固定来源或上游文件记录。');
  }
  for (const item of manifest.source.upstreamFiles) {
    validateVirtualPath(`/${item.localPath}`);
    if (!/^[a-f0-9]{40}$/.test(item.gitBlobSha1) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('上游校验记录无效。');
    await readSource(item.localPath);
  }
  if (await realpath(path.join(source, 'src')) !== path.join(source, 'src')) throw new Error('模板源目录不能使用符号链接。');
  const names = await collectFiles(path.join(source, 'src'));
  if (names.length > 64) throw new Error('模板源文件数量超限。');
  const files = {};
  const styleInputs = [];
  for (const name of names) {
    const filename = `/src/${name}`;
    validateVirtualPath(filename);
    const bytes = await readSource(`src/${name}`);
    if (/\.(png|svg)$/.test(name)) {
      const mime = name.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      files[filename.replace(/\.(png|svg)$/, '.asset.ts')] = `export default ${JSON.stringify(`data:${mime};base64,${bytes.toString('base64')}`)};\n`;
    } else if (name.endsWith('.css')) {
      styleInputs.push({ name, code: bytes.toString('utf8') });
    } else if (/\.tsx?$/.test(name)) {
      files[filename] = bytes.toString('utf8').replace(/(["'][^"']+)\.(png|svg)(["'])/g, '$1.asset$3');
    } else throw new Error(`模板源文件类型不支持：${name}`);
  }
  // The config is repository-owned build input, never model output or a runtime download.
  const configPath = path.join(source, 'tailwind.config.cjs');
  await readSource('tailwind.config.cjs');
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  const css = await postcss([
    tailwindcss({ ...config, content: Object.values(files).map((raw) => ({ raw, extension: 'tsx' })) }),
    autoprefixer,
  ]).process(styleInputs.sort((a, b) => a.name.localeCompare(b.name, 'en')).map(({ code }) => code).join('\n'), { from: undefined });
  files['/src/styles.css'] = css.css;
  files['/LICENSE'] = (await readSource('LICENSE')).toString('utf8');
  files['/public/index.html'] = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Company landing · template demonstration</title></head><body><div id="root"></div></body></html>\n';
  files['/package.json'] = JSON.stringify({ name: manifest.id, version: '1.0.0', private: true, main: manifest.entry, dependencies: manifest.dependencies }, null, 2) + '\n';
  validateImports(files, manifest.dependencies);
  const content = {
    id: manifest.id, version: manifest.version, name: manifest.name, category: manifest.category,
    source: { repository: manifest.source.repository, commit: manifest.source.commit, license: manifest.source.license },
    entry: manifest.entry, dependencies: manifest.dependencies,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en'))),
  };
  const bundle = { ...content, digest: await contentDigest(content) };
  await verifyTemplateBundle(bundle, manifest);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const temporary = `${outputFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, canonicalJSON(bundle) + '\n', { flag: 'wx' });
    await rename(temporary, outputFile);
  } finally {
    await rm(temporary, { force: true });
  }
  return bundle;
}

export async function prepareBackendTemplate({ outputDirectory = backendTemplateDirectory('backend-src'), sourceDirectory = templateSource } = {}) {
  const stage = `${outputDirectory}.${randomUUID()}.tmp`;
  const previous = `${outputDirectory}.${randomUUID()}.previous`;
  let moved = false;
  try {
    const bundle = await prepareCompanyTemplate({ sourceDirectory, outputFile: path.join(stage, 'company-landing.bundle.json') });
    const identity = Object.fromEntries(Object.entries(bundle).filter(([key]) => !['files', 'digest'].includes(key)));
    const runtime = await readFile(path.join(root, 'templates/bundle.mjs'), 'utf8');
    const types = await readFile(path.join(root, 'templates/bundle.d.mts'), 'utf8');
    await writeFile(path.join(stage, 'bundle.mjs'), `${runtime}\nexport const companyTemplateIdentity = ${canonicalJSON(identity)};\n`);
    await writeFile(path.join(stage, 'bundle.d.mts'), `${types}\nexport const companyTemplateIdentity: TemplateIdentity;\n`);
    try { await rename(outputDirectory, previous); moved = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(stage, outputDirectory); }
    catch (error) { if (moved) await rename(previous, outputDirectory); throw error; }
    await rm(previous, { recursive: true, force: true });
    return bundle;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const target = args.length === 0 ? 'frontend' : args.length === 2 && args[0] === '--target' ? args[1] : null;
  const prepare = target === 'frontend' ? () => prepareCompanyTemplate() : ['backend-src', 'backend-dist'].includes(target)
    ? () => prepareBackendTemplate({ outputDirectory: backendTemplateDirectory(target) })
    : () => Promise.reject(new Error('Usage: prepare-company-template.mjs [--target frontend|backend-src|backend-dist]'));
  prepare().then((bundle) => {
    console.log(`Prepared ${bundle.id} v${bundle.version}: ${Object.keys(bundle.files).length} files, SHA-256 ${bundle.digest}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : '模板准备失败。');
    process.exitCode = 1;
  });
}
