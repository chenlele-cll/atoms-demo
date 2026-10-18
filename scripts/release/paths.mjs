import {lstat,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
// Create only owned descendants; never follow an existing runtime/evidence symlink.
export async function privateDirectory(root,parts){
  let target=await realpath(root);
  for(const part of parts){
    if(typeof part!=='string'||!part||part==='.'||part==='..'||part.includes('/')||part.includes('\\'))throw Error('UNSAFE_PATH');
    target=path.join(target,part);
    try{await mkdir(target,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UNSAFE_PATH');
  }
  return target;
}
