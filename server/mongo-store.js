import { MongoClient } from 'mongodb';

// MongoDB-backed store. Exposes the same interface and row shapes as the
// Postgres/SQLite stores in db.js (numeric `id`, snake_case fields), so the
// API and frontend work unchanged.

const PERSON_FIELDS = { _id: 0, id: 1, name: 1, role: 1, created_at: 1 };
const WORK_LOG_FIELDS = { _id: 0, id: 1, person_name: 1, feature: 1, work_done: 1, created_at: 1 };
const TASK_FIELDS = {
  _id: 0,
  id: 1,
  status: 1,
  task_name: 1,
  assigned_to: 1,
  assigned_at: 1,
  task_description: 1,
  created_at: 1,
  updated_at: 1,
};
const TASK_LOG_FIELDS = {
  _id: 0,
  id: 1,
  task_id: 1,
  event_type: 1,
  task_name: 1,
  assigned_to: 1,
  assigned_at: 1,
  task_description: 1,
  previous_status: 1,
  new_status: 1,
  logged_at: 1,
};

function pick(doc, fields) {
  const out = {};
  for (const key of Object.keys(fields)) {
    if (key !== '_id') out[key] = doc[key] ?? null;
  }
  return out;
}

export async function createMongoStore(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName || undefined);

  const counters = db.collection('counters');
  const people = db.collection('people');
  const workLogs = db.collection('work_logs');
  const tasks = db.collection('tasks');
  const taskLogs = db.collection('task_logs');

  await Promise.all([
    people.createIndex({ id: 1 }, { unique: true }),
    people.createIndex({ name_lower: 1 }, { unique: true }),
    workLogs.createIndex({ id: 1 }, { unique: true }),
    workLogs.createIndex({ created_at: -1, id: -1 }),
    workLogs.createIndex({ person_name: 1 }),
    tasks.createIndex({ id: 1 }, { unique: true }),
    tasks.createIndex({ updated_at: -1, id: -1 }),
    tasks.createIndex({ status: 1 }),
    taskLogs.createIndex({ id: 1 }, { unique: true }),
    taskLogs.createIndex({ task_id: 1 }),
    taskLogs.createIndex({ logged_at: -1, id: -1 }),
  ]);

  // Auto-increment numeric ids (the frontend and API routes use integer ids).
  async function nextId(name) {
    const res = await counters.findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    return res.seq;
  }

  return {
    dialect: 'mongodb',

    async healthCheck() {
      await db.command({ ping: 1 });
      return { ok: true, dialect: 'mongodb' };
    },

    async listPeople() {
      return people.find({}, { projection: PERSON_FIELDS }).sort({ name_lower: 1, id: 1 }).toArray();
    },

    async addPerson({ name, role, createdAt }) {
      const nameLower = name.toLowerCase();
      const existing = await people.findOne({ name_lower: nameLower });
      if (existing) {
        const err = new Error(`Person "${existing.name}" already exists.`);
        err.code = 'DUPLICATE_PERSON';
        throw err;
      }
      const doc = { id: await nextId('people'), name, name_lower: nameLower, role, created_at: createdAt };
      try {
        await people.insertOne(doc);
      } catch (e) {
        if (e.code === 11000) {
          const err = new Error(`Person "${name}" already exists.`);
          err.code = 'DUPLICATE_PERSON';
          throw err;
        }
        throw e;
      }
      return pick(doc, PERSON_FIELDS);
    },

    async listWorkLogs() {
      return workLogs.find({}, { projection: WORK_LOG_FIELDS }).sort({ created_at: -1, id: -1 }).toArray();
    },

    async createWorkLog({ personName, feature, workDone, createdAt }) {
      const doc = {
        id: await nextId('work_logs'),
        person_name: personName,
        feature,
        work_done: workDone,
        created_at: createdAt,
      };
      await workLogs.insertOne(doc);
      return pick(doc, WORK_LOG_FIELDS);
    },

    async listTasks() {
      return tasks.find({}, { projection: TASK_FIELDS }).sort({ updated_at: -1, id: -1 }).toArray();
    },

    async createTask({ status, taskName, assignedTo, assignedAt, taskDescription, createdAt }) {
      const task = {
        id: await nextId('tasks'),
        status,
        task_name: taskName,
        assigned_to: assignedTo,
        assigned_at: assignedAt,
        task_description: taskDescription,
        created_at: createdAt,
        updated_at: createdAt,
      };
      await tasks.insertOne(task);

      const log = {
        id: await nextId('task_logs'),
        task_id: task.id,
        event_type: 'CREATED',
        task_name: taskName,
        assigned_to: assignedTo,
        assigned_at: assignedAt,
        task_description: taskDescription,
        previous_status: null,
        new_status: status,
        logged_at: createdAt,
      };
      await taskLogs.insertOne(log);
      return { task: pick(task, TASK_FIELDS), log: pick(log, TASK_LOG_FIELDS) };
    },

    async updateTaskStatus({ taskId, newStatus, loggedAt }) {
      const current = await tasks.findOne({ id: taskId }, { projection: TASK_FIELDS });
      if (!current) return null;
      if (current.status === newStatus) {
        return { task: current, log: null, unchanged: true };
      }

      // Conditional update: only applies if nobody changed the status in between,
      // so the audit log's previous_status is always accurate.
      const updated = await tasks.findOneAndUpdate(
        { id: taskId, status: current.status },
        { $set: { status: newStatus, updated_at: loggedAt } },
        { returnDocument: 'after', projection: TASK_FIELDS }
      );
      if (!updated) {
        // Status changed concurrently; retry against the fresh state.
        return this.updateTaskStatus({ taskId, newStatus, loggedAt });
      }

      const log = {
        id: await nextId('task_logs'),
        task_id: updated.id,
        event_type: 'STATUS_MODIFIED',
        task_name: updated.task_name,
        assigned_to: updated.assigned_to,
        assigned_at: updated.assigned_at,
        task_description: updated.task_description,
        previous_status: current.status,
        new_status: newStatus,
        logged_at: loggedAt,
      };
      await taskLogs.insertOne(log);
      return { task: updated, log: pick(log, TASK_LOG_FIELDS), unchanged: false };
    },

    async listTaskLogs() {
      return taskLogs.find({}, { projection: TASK_LOG_FIELDS }).sort({ logged_at: -1, id: -1 }).toArray();
    },

    async close() {
      await client.close();
    },
  };
}
