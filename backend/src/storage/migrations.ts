import type Database from 'better-sqlite3';
import { ProjectError } from '../projects/errors.js';

export const migrations = [{ version: 1, sql: `
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>created_at)
);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL REFERENCES sessions(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), template_id TEXT NOT NULL,
 template_version INTEGER NOT NULL CHECK(template_version>0), template_digest TEXT NOT NULL CHECK(length(template_digest)=64),
 current_version_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(id,current_version_id) REFERENCES versions(project_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE versions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 sequence INTEGER NOT NULL CHECK(sequence>=0), parent_version_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('template','generated')), snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id,id), UNIQUE(project_id,sequence),
 FOREIGN KEY(project_id,parent_version_id) REFERENCES versions(project_id,id),
 CHECK((sequence=0 AND kind='template' AND parent_version_id IS NULL) OR (sequence>0 AND kind='generated' AND parent_version_id IS NOT NULL))
);
CREATE TRIGGER versions_immutable BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT,'immutable version'); END;
CREATE TABLE generation_runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), request_id TEXT NOT NULL,
 base_version_id TEXT NOT NULL, result_version_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled','interrupted')),
 error_code TEXT, started_at TEXT NOT NULL, finished_at TEXT,
 UNIQUE(project_id,id), UNIQUE(project_id,request_id),
 FOREIGN KEY(project_id,base_version_id) REFERENCES versions(project_id,id),
 FOREIGN KEY(project_id,result_version_id) REFERENCES versions(project_id,id),
 CHECK((status='running' AND finished_at IS NULL AND error_code IS NULL AND result_version_id IS NULL)
 OR (status='succeeded' AND finished_at>=started_at AND finished_at IS NOT NULL AND error_code IS NULL AND result_version_id IS NOT NULL)
 OR (status IN ('failed','cancelled','interrupted') AND finished_at>=started_at AND finished_at IS NOT NULL AND error_code IS NOT NULL AND result_version_id IS NULL))
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), sequence INTEGER NOT NULL CHECK(sequence>0),
 role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(project_id,sequence), FOREIGN KEY(project_id,run_id) REFERENCES generation_runs(project_id,id)
);
CREATE INDEX project_owner_order ON projects(owner_session_id,updated_at DESC,id DESC);
CREATE INDEX run_project_order ON generation_runs(project_id,started_at DESC,id DESC);
` }] as const;

export function migrate(db: Database.Database, definitions: readonly { version: number; sql: string }[] = migrations) {
  db.transaction(() => {
    const current: unknown = db.pragma('user_version', { simple: true });
    const supported = definitions.at(-1)?.version ?? 0;
    if (typeof current !== 'number' || current > supported) throw new ProjectError('INVALID_CONFIGURATION');
    let version = current;
    for (const migration of definitions) {
      if (migration.version <= version) continue;
      if (migration.version !== version + 1) throw new ProjectError('INVALID_CONFIGURATION');
      db.exec(migration.sql);
      // Only repository-owned integer migration versions enter this pragma.
      db.pragma(`user_version = ${migration.version}`);
      version = migration.version;
    }
  }).immediate();
}
