import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export const VALID_TASK_STATUSES = ['Completed', 'Ongoing', 'Not Started', 'NA'];

function shouldUseSsl(databaseUrl) {
  if (process.env.PGSSLMODE === 'disable') return false;
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
  } catch {
    return false;
  }
  return { rejectUnauthorized: false };
}

export async function createStore(options = {}) {
  const mongoUri = options.mongoUri ?? process.env.MONGODB_URI ?? '';
  if (mongoUri) {
    const { createMongoStore } = await import('./mongo-store.js');
    return createMongoStore(mongoUri, options.mongoDbName ?? process.env.MONGODB_DB ?? 'ctw_tracker');
  }

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? '';

  if (databaseUrl) {
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl(databaseUrl),
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS people (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS work_logs (
        id SERIAL PRIMARY KEY,
        person_name TEXT NOT NULL,
        feature TEXT NOT NULL,
        work_done TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('Completed', 'Ongoing', 'Not Started', 'NA')),
        task_name TEXT NOT NULL,
        assigned_to TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        task_description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_logs (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        event_type TEXT NOT NULL,
        task_name TEXT NOT NULL,
        assigned_to TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        task_description TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        logged_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_work_logs_created_at ON work_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_work_logs_person_name ON work_logs(person_name);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_logs_logged_at ON task_logs(logged_at DESC);
    `);

    return {
      dialect: 'postgres',

      async healthCheck() {
        await pool.query('SELECT 1');
        return { ok: true, dialect: 'postgres' };
      },

      async listPeople() {
        const { rows } = await pool.query(
          'SELECT id, name, role, created_at FROM people ORDER BY LOWER(name) ASC, id ASC'
        );
        return rows;
      },

      async addPerson({ name, role, createdAt }) {
        const existing = await pool.query(
          'SELECT id, name FROM people WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [name]
        );
        if (existing.rows.length > 0) {
          const err = new Error(`Person "${existing.rows[0].name}" already exists.`);
          err.code = 'DUPLICATE_PERSON';
          throw err;
        }
        const { rows } = await pool.query(
          'INSERT INTO people (name, role, created_at) VALUES ($1, $2, $3) RETURNING id, name, role, created_at',
          [name, role, createdAt]
        );
        return rows[0];
      },

      async listWorkLogs() {
        const { rows } = await pool.query(
          'SELECT id, person_name, feature, work_done, created_at FROM work_logs ORDER BY created_at DESC, id DESC'
        );
        return rows;
      },

      async createWorkLog({ personName, feature, workDone, createdAt }) {
        const { rows } = await pool.query(
          'INSERT INTO work_logs (person_name, feature, work_done, created_at) VALUES ($1, $2, $3, $4) RETURNING id, person_name, feature, work_done, created_at',
          [personName, feature, workDone, createdAt]
        );
        return rows[0];
      },

      async listTasks() {
        const { rows } = await pool.query(
          'SELECT id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at FROM tasks ORDER BY updated_at DESC, id DESC'
        );
        return rows;
      },

      async createTask({ status, taskName, assignedTo, assignedAt, taskDescription, createdAt }) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const taskRes = await client.query(
            `INSERT INTO tasks (status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at`,
            [status, taskName, assignedTo, assignedAt, taskDescription, createdAt, createdAt]
          );
          const task = taskRes.rows[0];

          const logRes = await client.query(
            `INSERT INTO task_logs (task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at)
             VALUES ($1, 'CREATED', $2, $3, $4, $5, NULL, $6, $7)
             RETURNING id, task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at`,
            [task.id, task.task_name, task.assigned_to, task.assigned_at, task.task_description, task.status, createdAt]
          );
          await client.query('COMMIT');
          return { task, log: logRes.rows[0] };
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },

      async updateTaskStatus({ taskId, newStatus, loggedAt }) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const existingRes = await client.query(
            'SELECT id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at FROM tasks WHERE id = $1 FOR UPDATE',
            [taskId]
          );
          if (existingRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
          }
          const current = existingRes.rows[0];
          if (current.status === newStatus) {
            await client.query('ROLLBACK');
            return { task: current, log: null, unchanged: true };
          }

          const updatedRes = await client.query(
            `UPDATE tasks SET status = $1, updated_at = $2 WHERE id = $3
             RETURNING id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at`,
            [newStatus, loggedAt, taskId]
          );
          const updated = updatedRes.rows[0];

          const logRes = await client.query(
            `INSERT INTO task_logs (task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at)
             VALUES ($1, 'STATUS_MODIFIED', $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at`,
            [
              updated.id,
              updated.task_name,
              updated.assigned_to,
              updated.assigned_at,
              updated.task_description,
              current.status,
              newStatus,
              loggedAt,
            ]
          );
          await client.query('COMMIT');
          return { task: updated, log: logRes.rows[0], unchanged: false };
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },

      async listTaskLogs() {
        const { rows } = await pool.query(
          'SELECT id, task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at FROM task_logs ORDER BY logged_at DESC, id DESC'
        );
        return rows;
      },

      async close() {
        await pool.end();
      },
    };
  }

  // Fallback to Node built-in SQLite for local dev or persistent-disk Render deployments
  const { DatabaseSync } = await import('node:sqlite');
  const sqlitePath =
    options.sqlitePath ??
    process.env.SQLITE_PATH ??
    path.join(process.cwd(), 'data', 'tracker.db');

  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const db = new DatabaseSync(sqlitePath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT NOT NULL,
      feature TEXT NOT NULL,
      work_done TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL CHECK (status IN ('Completed', 'Ongoing', 'Not Started', 'NA')),
      task_name TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      task_description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      event_type TEXT NOT NULL,
      task_name TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      task_description TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      logged_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_logs_created_at ON work_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_logs_person_name ON work_logs(person_name);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_logs_logged_at ON task_logs(logged_at DESC);
  `);

  return {
    dialect: 'sqlite',

    async healthCheck() {
      db.prepare('SELECT 1').get();
      return { ok: true, dialect: 'sqlite' };
    },

    async listPeople() {
      return db
        .prepare('SELECT id, name, role, created_at FROM people ORDER BY LOWER(name) ASC, id ASC')
        .all();
    },

    async addPerson({ name, role, createdAt }) {
      const existing = db
        .prepare('SELECT id, name FROM people WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(name);
      if (existing) {
        const err = new Error(`Person "${existing.name}" already exists.`);
        err.code = 'DUPLICATE_PERSON';
        throw err;
      }
      const res = db
        .prepare('INSERT INTO people (name, role, created_at) VALUES (?, ?, ?)')
        .run(name, role, createdAt);
      return db
        .prepare('SELECT id, name, role, created_at FROM people WHERE id = ?')
        .get(Number(res.lastInsertRowid));
    },

    async listWorkLogs() {
      return db
        .prepare('SELECT id, person_name, feature, work_done, created_at FROM work_logs ORDER BY created_at DESC, id DESC')
        .all();
    },

    async createWorkLog({ personName, feature, workDone, createdAt }) {
      const res = db
        .prepare('INSERT INTO work_logs (person_name, feature, work_done, created_at) VALUES (?, ?, ?, ?)')
        .run(personName, feature, workDone, createdAt);
      return db
        .prepare('SELECT id, person_name, feature, work_done, created_at FROM work_logs WHERE id = ?')
        .get(Number(res.lastInsertRowid));
    },

    async listTasks() {
      return db
        .prepare(
          'SELECT id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at FROM tasks ORDER BY updated_at DESC, id DESC'
        )
        .all();
    },

    async createTask({ status, taskName, assignedTo, assignedAt, taskDescription, createdAt }) {
      db.exec('BEGIN');
      try {
        const taskRes = db
          .prepare(
            `INSERT INTO tasks (status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(status, taskName, assignedTo, assignedAt, taskDescription, createdAt, createdAt);
        const taskId = Number(taskRes.lastInsertRowid);

        const logRes = db
          .prepare(
            `INSERT INTO task_logs (task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at)
             VALUES (?, 'CREATED', ?, ?, ?, ?, NULL, ?, ?)`
          )
          .run(taskId, taskName, assignedTo, assignedAt, taskDescription, status, createdAt);

        db.exec('COMMIT');

        const task = db
          .prepare(
            'SELECT id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at FROM tasks WHERE id = ?'
          )
          .get(taskId);
        const log = db
          .prepare(
            'SELECT id, task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at FROM task_logs WHERE id = ?'
          )
          .get(Number(logRes.lastInsertRowid));
        return { task, log };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async updateTaskStatus({ taskId, newStatus, loggedAt }) {
      db.exec('BEGIN');
      try {
        const current = db
          .prepare(
            'SELECT id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at FROM tasks WHERE id = ?'
          )
          .get(taskId);
        if (!current) {
          db.exec('ROLLBACK');
          return null;
        }
        if (current.status === newStatus) {
          db.exec('ROLLBACK');
          return { task: current, log: null, unchanged: true };
        }

        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, loggedAt, taskId);
        const logRes = db
          .prepare(
            `INSERT INTO task_logs (task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at)
             VALUES (?, 'STATUS_MODIFIED', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            current.id,
            current.task_name,
            current.assigned_to,
            current.assigned_at,
            current.task_description,
            current.status,
            newStatus,
            loggedAt
          );
        db.exec('COMMIT');

        const updated = db
          .prepare(
            'SELECT id, status, task_name, assigned_to, assigned_at, task_description, created_at, updated_at FROM tasks WHERE id = ?'
          )
          .get(taskId);
        const log = db
          .prepare(
            'SELECT id, task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at FROM task_logs WHERE id = ?'
          )
          .get(Number(logRes.lastInsertRowid));
        return { task: updated, log, unchanged: false };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async listTaskLogs() {
      return db
        .prepare(
          'SELECT id, task_id, event_type, task_name, assigned_to, assigned_at, task_description, previous_status, new_status, logged_at FROM task_logs ORDER BY logged_at DESC, id DESC'
        )
        .all();
    },

    async close() {
      db.close();
    },
  };
}
