import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { decodeCursor, encodeCursor, idSchema, messageInputSchema, messageListSchema, projectDetailSchema,
  projectListSchema, projectSchema, runErrorSchema, runSchema, snapshotSchema, titleSchema, versionSchema } from '../contracts/projects.js';
import type { MessageInput, Run, Snapshot } from '../contracts/projects.js';
import { ProjectError, storageOperation } from '../projects/errors.js';
import { migrate } from './migrations.js';
import { canonicalJSON, companyTemplateIdentity, parseTemplateBundle } from '../template-assets/bundle.mjs';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export function tokenDigest(token: string) { return createHash('sha256').update(token).digest('hex'); }
const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
  const result = schema.safeParse(data);
  if (!result.success) throw new ProjectError('DATA_CORRUPT');
  return result.data;
};
const projectColumns = `id,title,template_id AS templateId,template_version AS templateVersion,
 template_digest AS templateDigest,current_version_id AS currentVersionId,created_at AS createdAt,updated_at AS updatedAt`;
const versionColumns = `id,project_id AS projectId,sequence,parent_version_id AS parentVersionId,kind,snapshot_json AS snapshotJson,created_at AS createdAt`;
const runColumns = `id,project_id AS projectId,request_id AS requestId,base_version_id AS baseVersionId,
 result_version_id AS resultVersionId,status,error_code AS errorCode,started_at AS startedAt,finished_at AS finishedAt`;
const messageColumns = `id,project_id AS projectId,sequence,role,content,run_id AS runId,created_at AS createdAt`;
const sessionSchema = z.object({ id: idSchema, expiresAt: z.number().int().positive() });

export function openStore(filename: string) {
  if (!filename.trim() || filename.includes('\0') || filename.trim() === ':memory:' || filename.startsWith('file:')) {
    throw new ProjectError('INVALID_CONFIGURATION');
  }
  let db: Database.Database | undefined;
  try {
    const absolute = resolve(filename);
    mkdirSync(dirname(absolute), { recursive: true });
    db = new Database(absolute, { timeout: 5000 });
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrate(db);
    db.pragma('journal_mode = WAL');
    return new ProjectStore(db);
  } catch (error) {
    db?.close();
    if (error instanceof ProjectError) throw error;
    throw new ProjectError('STORAGE_UNAVAILABLE');
  }
}

export class ProjectStore {
  // One connection belongs to one application; no module-level database.
  constructor(private readonly db: Database.Database) {}
  close() { if (this.db.open) this.db.close(); }

  createSession(now = Date.now()) {
    return storageOperation(() => {
      const token = randomBytes(32).toString('base64url');
      const session = { id: randomUUID(), expiresAt: now + SESSION_LIFETIME_MS };
      this.db.prepare('INSERT INTO sessions(id,token_hash,created_at,expires_at) VALUES(?,?,?,?)')
        .run(session.id, tokenDigest(token), now, session.expiresAt);
      return { ...session, token };
    });
  }
  findSession(token: string | undefined, now = Date.now()) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return storageOperation(() => {
      const value: unknown = this.db.prepare('SELECT id,expires_at AS expiresAt FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenDigest(token), now);
      return value === undefined ? null : parse(sessionSchema, value);
    });
  }
  private project(projectId: string) {
    const value: unknown = this.db.prepare(`SELECT ${projectColumns} FROM projects WHERE id=?`).get(projectId);
    if (value === undefined) throw new ProjectError('NOT_FOUND');
    return parse(projectSchema, value);
  }
  private owned(ownerId: string, projectId: string) {
    const found: unknown = this.db.prepare('SELECT id FROM projects WHERE id=? AND owner_session_id=?').get(projectId, ownerId);
    if (found === undefined) throw new ProjectError('NOT_FOUND');
  }
  private version(projectId: string, versionId: string) {
    const value: unknown = this.db.prepare(`SELECT ${versionColumns} FROM versions WHERE project_id=? AND id=?`).get(projectId, versionId);
    const row = parse(z.object({ snapshotJson: z.string() }).passthrough(), value);
    let snapshot: unknown;
    try { snapshot = JSON.parse(row.snapshotJson); } catch { throw new ProjectError('DATA_CORRUPT'); }
    return parse(versionSchema, { ...row, snapshot });
  }
  private run(projectId: string, runId: string): Run {
    const value: unknown = this.db.prepare(`SELECT ${runColumns} FROM generation_runs WHERE project_id=? AND id=?`).get(projectId, runId);
    if (value === undefined) throw new ProjectError('NOT_FOUND');
    return parse(runSchema, value);
  }
  private detail(projectId: string) {
    const project = this.project(projectId);
    const run: unknown = this.db.prepare(`SELECT ${runColumns} FROM generation_runs WHERE project_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1`).get(projectId);
    return parse(projectDetailSchema, { project, currentVersion: this.version(projectId, project.currentVersionId),
      latestRun: run === undefined ? null : run });
  }

  createProject(ownerId: string, title: string, input: Snapshot, quota = 20) {
    const snapshot = snapshotSchema.parse(input);
    parseTemplateBundle(snapshot, companyTemplateIdentity);
    const safeTitle = titleSchema.parse(title);
    return storageOperation(() => this.db.transaction(() => {
      const count = parse(z.object({ count: z.number() }), this.db.prepare('SELECT count(*) AS count FROM projects WHERE owner_session_id=?').get(ownerId)).count;
      if (count >= quota) throw new ProjectError('PROJECT_LIMIT_REACHED');
      const projectId = randomUUID(); const versionId = randomUUID(); const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO projects(id,owner_session_id,title,template_id,template_version,template_digest,current_version_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,NULL,?,?)`).run(projectId, ownerId, safeTitle, snapshot.id, snapshot.version, snapshot.digest, now, now);
      this.db.prepare('INSERT INTO versions(id,project_id,sequence,parent_version_id,kind,snapshot_json,created_at) VALUES(?,?,0,NULL,?,?,?)')
        .run(versionId, projectId, 'template', JSON.stringify(snapshot), now);
      this.db.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(versionId, projectId);
      return this.detail(projectId);
    }).immediate());
  }
  getProject(ownerId: string, projectId: string) {
    return storageOperation(() => { this.owned(ownerId, projectId); return this.detail(projectId); });
  }
  listProjects(ownerId: string, limit: number, cursor?: string) {
    return storageOperation(() => {
      const tuple = cursor ? decodeCursor(cursor) : null;
      const rows: unknown[] = tuple
        ? this.db.prepare(`SELECT ${projectColumns} FROM projects WHERE owner_session_id=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT ?`).all(ownerId, tuple[0], tuple[0], tuple[1], limit + 1)
        : this.db.prepare(`SELECT ${projectColumns} FROM projects WHERE owner_session_id=? ORDER BY updated_at DESC,id DESC LIMIT ?`).all(ownerId, limit + 1);
      const items = rows.slice(0, limit).map(value => parse(projectSchema, value));
      const last = items.at(-1);
      return parse(projectListSchema, { items, nextCursor: rows.length > limit && last ? encodeCursor([last.updatedAt, last.id]) : null });
    });
  }
  listMessages(ownerId: string, projectId: string, afterSequence: number, limit: number) {
    return storageOperation(() => {
      this.owned(ownerId, projectId);
      const rows: unknown[] = this.db.prepare(`SELECT ${messageColumns} FROM messages WHERE project_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?`).all(projectId, afterSequence, limit + 1);
      const page = parse(messageListSchema, { items: rows.slice(0, limit), nextAfterSequence: null });
      page.nextAfterSequence = rows.length > limit ? page.items.at(-1)?.sequence ?? null : null;
      return page;
    });
  }
  private append(projectId: string, inputs: MessageInput[], now: string) {
    const messages = z.array(messageInputSchema).max(50).parse(inputs);
    let sequence = parse(z.object({ sequence: z.number().int() }), this.db.prepare('SELECT coalesce(max(sequence),0) AS sequence FROM messages WHERE project_id=?').get(projectId)).sequence;
    for (const message of messages) this.db.prepare('INSERT INTO messages(id,project_id,sequence,role,content,run_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(), projectId, ++sequence, message.role, message.content, message.runId, now);
  }
  appendMessages(projectId: string, inputs: MessageInput[]) {
    return storageOperation(() => this.db.transaction(() => {
      this.project(projectId);
      const now = new Date().toISOString(); this.append(projectId, inputs, now);
      this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now, projectId);
    }).immediate());
  }
  createRun(input: { projectId: string; requestId: string; baseVersionId: string; messages?: Omit<MessageInput, 'runId'>[] }) {
    idSchema.parse(input.requestId); idSchema.parse(input.baseVersionId);
    return storageOperation(() => this.db.transaction(() => {
      this.project(input.projectId);
      if (this.db.prepare('SELECT id FROM generation_runs WHERE project_id=? AND request_id=?').get(input.projectId, input.requestId)) throw new ProjectError('CONFLICT');
      const id = randomUUID(); const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO generation_runs(id,project_id,request_id,base_version_id,status,started_at) VALUES(?,?,?,?,'running',?)`)
        .run(id, input.projectId, input.requestId, input.baseVersionId, now);
      this.append(input.projectId, (input.messages ?? []).map(message => ({ ...message, runId: id })), now);
      this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now, input.projectId);
      return this.run(input.projectId, id);
    }).immediate());
  }
  finishRun(input: { projectId: string; runId: string; status: 'failed' | 'cancelled' | 'interrupted'; errorCode: z.infer<typeof runErrorSchema>; messages?: Omit<MessageInput, 'runId'>[] }) {
    const status = z.enum(['failed', 'cancelled', 'interrupted']).parse(input.status);
    const errorCode = runErrorSchema.parse(input.errorCode);
    return storageOperation(() => this.db.transaction(() => {
      const run = this.run(input.projectId, input.runId);
      if (run.status !== 'running') throw new ProjectError('CONFLICT');
      const now = new Date().toISOString();
      this.db.prepare('UPDATE generation_runs SET status=?,error_code=?,finished_at=? WHERE project_id=? AND id=?')
        .run(status, errorCode, now, input.projectId, input.runId);
      this.append(input.projectId, (input.messages ?? []).map(message => ({ ...message, runId: run.id })), now);
      this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now, input.projectId);
      return this.run(input.projectId, input.runId);
    }).immediate());
  }
  saveCandidate(input: { projectId: string; runId: string; snapshot: Snapshot; messages?: Omit<MessageInput, 'runId'>[] }) {
    const snapshot = snapshotSchema.parse(input.snapshot);
    return storageOperation(() => this.db.transaction(() => {
      const run = this.run(input.projectId, input.runId);
      if (run.status !== 'running') throw new ProjectError('CONFLICT');
      const now = new Date().toISOString(); const id = randomUUID();
      const base = this.version(input.projectId, run.baseVersionId).snapshot;
      const identity = (value: Snapshot) => Object.fromEntries(Object.entries(value).filter(([key]) => !['files', 'digest'].includes(key)));
      if (canonicalJSON(identity(base)) !== canonicalJSON(identity(snapshot))) throw new ProjectError('INVALID_INPUT');
      const next = parse(z.object({ sequence: z.number().int() }), this.db.prepare('SELECT max(sequence)+1 AS sequence FROM versions WHERE project_id=?').get(input.projectId)).sequence;
      this.db.prepare('INSERT INTO versions(id,project_id,sequence,parent_version_id,kind,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, input.projectId, next, run.baseVersionId, 'generated', JSON.stringify(snapshot), now);
      this.db.prepare("UPDATE generation_runs SET status='succeeded',result_version_id=?,finished_at=? WHERE project_id=? AND id=?")
        .run(id, now, input.projectId, input.runId);
      this.append(input.projectId, (input.messages ?? []).map(message => ({ ...message, runId: run.id })), now);
      this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now, input.projectId);
      return { version: this.version(input.projectId, id), run: this.run(input.projectId, input.runId) };
    }).immediate());
  }
}
