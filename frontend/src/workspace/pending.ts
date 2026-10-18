import { generationBodySchema, idSchema } from '@atoms/contracts';
import type { GenerationBody } from '../api/generation-stream';

export type PendingRequest = GenerationBody & { projectId: string; createdAt: number };
export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'atoms.pending-generations.v1';
export class PendingRequests {
  private memory = new Map<string, PendingRequest>();
  available = true;
  constructor(private readonly storage?: PendingStorage, private readonly now = Date.now) { this.available = storage !== undefined; }
  private read() {
    if (!this.available) return;
    try {
      const raw = this.storage?.getItem(KEY); if (!raw) return;
      if (raw.length > 400_000) throw new Error();
      const data: unknown = JSON.parse(raw); if (!Array.isArray(data) || data.length > 20) throw new Error();
      this.memory.clear();
      for (const item of data) {
        if (typeof item !== 'object' || item === null || !('createdAt' in item) || typeof item.createdAt !== 'number' || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0) continue;
        const { createdAt, ...fields } = item;
        const parsed = generationBodySchema.extend({ projectId: idSchema }).safeParse(fields);
        if (parsed.success && createdAt <= this.now() && this.now() - createdAt < 86_400_000) this.memory.set(parsed.data.projectId, { ...parsed.data, createdAt });
      }
    } catch { this.available = false; }
  }
  private write() {
    try { this.storage?.setItem(KEY, JSON.stringify([...this.memory.values()])); } catch { this.available = false; }
  }
  get(projectId: string) { this.read(); const value = this.memory.get(projectId); if (value && (this.now() - value.createdAt >= 86_400_000 || value.createdAt > this.now())) { this.memory.delete(projectId); this.write(); return undefined; } return value; }
  save(value: PendingRequest) {
    this.read(); this.memory.delete(value.projectId); this.memory.set(value.projectId, value);
    while (this.memory.size > 20) { const first = this.memory.keys().next().value; if (first) this.memory.delete(first); else break; }
    this.write();
  }
  remove(projectId: string) { this.read(); this.memory.delete(projectId); this.write(); }
  clear() { this.memory.clear(); try { this.storage?.removeItem(KEY); } catch { this.available = false; } }
}
