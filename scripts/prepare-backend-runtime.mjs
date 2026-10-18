import { cp, mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';

// Same-platform test deployment: copy all application/workspace output; link only installed external dependencies.
export async function prepareBackendRuntime(root, destination) {
  await mkdir(destination, { recursive: true });
  await cp(path.join(root, 'backend/dist'), path.join(destination, 'dist'), { recursive: true });
  await cp(path.join(root, 'backend/package.json'), path.join(destination, 'package.json'));
  const contracts = path.join(destination, 'contracts'); await mkdir(contracts);
  await cp(path.join(root, 'packages/contracts/package.json'), path.join(contracts, 'package.json'));
  await cp(path.join(root, 'packages/contracts/dist'), path.join(contracts, 'dist'), { recursive: true });
  for (const [source, target] of [[path.join(root, 'backend'), destination], [path.join(root, 'packages/contracts'), contracts]]) {
    const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    for (const name of Object.keys(pkg.dependencies)) {
      const link = path.join(target, 'node_modules', name); await mkdir(path.dirname(link), { recursive: true });
      await symlink(name === '@atoms/contracts' ? contracts : await realpath(path.join(source, 'node_modules', name)), link, 'dir');
    }
  }
}
