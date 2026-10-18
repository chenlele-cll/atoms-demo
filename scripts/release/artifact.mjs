import { lstat, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, inside } from '../verification/primitives.mjs';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export async function inventory(folder) {
  const root = await realpath(folder); const entries = [];
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const key = path.posix.join(relative, name); if (key === 'release.json') continue;
      if (key.includes('\\') || [...key].some(char=>char.charCodeAt(0)<32)) throw Error('UNSAFE_RELEASE');
      const filename = path.join(root, key); const stat = await lstat(filename);
      if (stat.isSymbolicLink()) {
        const target = await readlink(filename); const resolved = await realpath(filename);
        if (path.isAbsolute(target) || !inside(root, resolved)) throw Error('UNSAFE_RELEASE');
        entries.push({ path: key, type: 'link', target, mode: stat.mode & 0o777 });
      } else if (stat.isDirectory()) { entries.push({ path: key, type: 'directory', mode: stat.mode & 0o777 }); await visit(key); }
      else if (stat.isFile()) entries.push({ path: key, type: 'file', digest: sha256(await readFile(filename)), mode: stat.mode & 0o777 });
      else throw Error('UNSAFE_RELEASE');
    }
  }
  await visit(); return entries;
}
export async function assertLayout(folder, entries) {
  const roots = new Set(entries.map(item => item.path.split('/')[0]));
  if ([...roots].some(name => !['backend','frontend','deploy'].includes(name))) throw Error('RELEASE_LAYOUT');
  for (const item of entries) {
    if (item.path.split('/').some(name => /^\.env(?:\.|$)/.test(name)) || /\.(?:sqlite|db)(?:-.*)?$/.test(item.path)) throw Error('RELEASE_LAYOUT');
    if (/^backend\/(?:src|test)(?:\/|$)/.test(item.path) || /^backend\/(?!node_modules\/|dist\/|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$)[^/]+\//.test(item.path)) throw Error('RELEASE_LAYOUT');
    if (/^backend\/node_modules\/(?:tsx|typescript|vite|eslint)$/.test(item.path)) throw Error('RELEASE_DEV_DEPENDENCY');
  }
  for (const key of ['backend/dist/server.js','backend/dist/app.js','backend/dist/template-assets/company-landing.bundle.json','backend/package.json','frontend/index.html','frontend/template-assets/company-landing.bundle.json','deploy/nginx.conf.template']) {
    if (!entries.some(item => item.path === key && item.type === 'file')) throw Error('MISSING_ASSET');
  }
  const own = JSON.parse(await readFile(path.join(folder,'backend/package.json'),'utf8'));
  if (own.name !== '@atoms/backend' || own.type !== 'module') throw Error('RELEASE_LAYOUT');
  const bundle = JSON.parse(await readFile(path.join(folder,'backend/dist/template-assets/company-landing.bundle.json'),'utf8'));
  const frontend = JSON.parse(await readFile(path.join(folder,'frontend/template-assets/company-landing.bundle.json'),'utf8'));
  if (bundle.digest !== frontend.digest || !bundle.files?.['/LICENSE'] || !HASH.test(bundle.digest)) throw Error('MISSING_ASSET');
  const contractRoot = await realpath(path.join(folder,'backend/node_modules/@atoms/contracts'));
  const contracts = path.join(contractRoot,'dist');
  await readFile(path.join(contracts,'index.js'));
  if (!inside(await realpath(folder), await realpath(contractRoot))) throw Error('UNSAFE_RELEASE');
  for (const name of ['src','test','build.mjs']) { if (entries.some(item => item.path === path.relative(folder,path.join(contractRoot,name)))) throw Error('RELEASE_LAYOUT'); }
  return { id: bundle.id, version: bundle.version, digest: bundle.digest };
}
export async function sealRelease(folder, identity) {
  const entries = await inventory(folder); const template = await assertLayout(folder,entries);
  const body = { schemaVersion: 1, ...identity, platform: process.platform, arch: process.arch, modulesABI: process.versions.modules, node: process.version, template, entries };
  const releaseDigest = sha256(JSON.stringify(body));
  await writeFile(path.join(folder,'release.json'),JSON.stringify({...body,releaseDigest},null,2)+'\n',{flag:'wx',mode:0o644});
  return {...body,releaseDigest};
}
export async function validateRelease(folder, { platform = process.platform, arch = process.arch, modulesABI = process.versions.modules } = {}) {
  const stat = await lstat(path.join(folder,'release.json')); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16*1024*1024) throw Error('RELEASE_MANIFEST');
  const value = JSON.parse(await readFile(path.join(folder,'release.json'),'utf8')); const { releaseDigest, ...body } = value;
  if (body.schemaVersion !== 1 || !UUID.test(body.releaseId) || !HASH.test(body.sourceDigest) || !HASH.test(body.lockDigest) || !HASH.test(body.buildDigest) || !HASH.test(releaseDigest) || releaseDigest !== sha256(JSON.stringify(body))) throw Error('RELEASE_MANIFEST');
  if (body.platform !== platform || body.arch !== arch || body.modulesABI !== modulesABI || body.node !== process.version) throw Error('RELEASE_PLATFORM');
  const entries = await inventory(folder);
  if (JSON.stringify(entries) !== JSON.stringify(body.entries)) throw Error('RELEASE_CHANGED');
  const template = await assertLayout(folder,entries);
  if (JSON.stringify(body.template)!==JSON.stringify(template)) throw Error('RELEASE_MANIFEST');
  return value;
}
export const sqliteProbe = `import {createRequire} from 'node:module'; const require=createRequire(process.cwd()+'/package.json'); const Database=require('better-sqlite3');const db=new Database(process.argv[1]);try{db.exec('CREATE TABLE native_check(value INTEGER)');db.prepare('INSERT INTO native_check VALUES(?)').run(7);if(db.prepare('SELECT value FROM native_check').get().value!==7)throw Error('Native check failed');}finally{db.close();}`;
export const nativeProbe = `import {pathToFileURL} from 'node:url'; const contracts=await import(pathToFileURL(process.cwd()+'/node_modules/@atoms/contracts/dist/index.js').href);if(!contracts.snapshotSchema)throw Error('Missing contracts');${sqliteProbe}`;
