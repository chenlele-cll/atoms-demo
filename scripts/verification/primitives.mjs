// Dependency-free primitives shared by build tooling and transported validators.
import { createHash } from 'node:crypto';
import path from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const inside = (root, target) => target !== root && target.startsWith(root + path.sep);
