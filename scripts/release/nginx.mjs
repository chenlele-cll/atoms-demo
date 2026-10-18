import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
export function nginxPath(value) {
  if(typeof value!=='string'||!path.isAbsolute(value)||[...value].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)||/["'\\$;{}]/.test(value))throw Error('NGINX_PATH');
  return '"'+value+'"';
}
export async function renderNginx(template,prefix,staticRoot) {
  const content=await readFile(template,'utf8');
  // Quote the whole final path, including suffixes (Nginx does not join quoted tokens).
  const values={PREFIX:prefix,STATIC:staticRoot};
  return content.replace(/\{\{(PREFIX|STATIC)\}\}([^;\s]*)/g,(_,name,suffix)=>nginxPath(values[name]+suffix));
}
export async function findNginx(env=process.env) {
  const candidates=env.NGINX_BIN?[env.NGINX_BIN]:(env.PATH??'').split(path.delimiter).map(base=>path.join(base,'nginx'));
  for(const candidate of candidates){if(!path.isAbsolute(candidate))continue;try{await access(candidate,constants.X_OK);return candidate;}catch{/* next */}}
  throw Error('MISSING_NGINX');
}
