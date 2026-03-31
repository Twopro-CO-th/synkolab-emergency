import type Database from 'better-sqlite3';

export function createTables(db: Database.Database): void {
  db.exec(`
    -- Enable WAL mode for concurrent read/write
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS calls (
      id            TEXT PRIMARY KEY,
      caller_id     TEXT NOT NULL,
      caller_type   TEXT NOT NULL CHECK(caller_type IN ('user','device')),
      callee_id     TEXT,
      callee_type   TEXT CHECK(callee_type IN ('user','device')),
      room_name     TEXT NOT NULL,
      type          TEXT NOT NULL CHECK(type IN ('normal','emergency','broadcast','intercom')),
      status        TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','active','completed','missed','rejected')),
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      answered_at   TEXT,
      ended_at      TEXT,
      duration      INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_calls_caller   ON calls(caller_id);
    CREATE INDEX IF NOT EXISTS idx_calls_callee   ON calls(callee_id);
    CREATE INDEX IF NOT EXISTS idx_calls_status   ON calls(status);
    CREATE INDEX IF NOT EXISTS idx_calls_type     ON calls(type);
    CREATE INDEX IF NOT EXISTS idx_calls_created  ON calls(created_at DESC);

    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      identity      TEXT NOT NULL UNIQUE,
      token_hash    TEXT NOT NULL,
      location      TEXT,
      status        TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline','error')),
      last_seen     TEXT,
      config        TEXT,
      registered_by TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_devices_identity ON devices(identity);
    CREATE INDEX IF NOT EXISTS idx_devices_status   ON devices(status);

    CREATE TABLE IF NOT EXISTS call_participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id    TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL,
      user_type  TEXT NOT NULL CHECK(user_type IN ('user','device')),
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      left_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_participants_call ON call_participants(call_id);

    -- Projects (intercom multi-tenant)
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      owner_id      TEXT NOT NULL,
      settings      TEXT DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

    -- Project members
    CREATE TABLE IF NOT EXISTS project_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pm_project ON project_members(project_id);
    CREATE INDEX IF NOT EXISTS idx_pm_user    ON project_members(user_id);

    -- Project devices (link device to project)
    CREATE TABLE IF NOT EXISTS project_devices (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pd_project ON project_devices(project_id);
    CREATE INDEX IF NOT EXISTS idx_pd_device  ON project_devices(device_id);
  `);
}
