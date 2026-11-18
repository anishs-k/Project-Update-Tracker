import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore, VALID_TASK_STATUSES } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function cleanString(value, maxLen = 4000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function parseIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Enforce immutability at HTTP layer
  app.delete('/api/*', (_req, res) => {
    res.status(405).json({
      error: 'Deletion is disabled. All logs and records are permanent and non-deletable.',
    });
  });

  app.get('/api/health', async (_req, res, next) => {
    try {
      const status = await store.healthCheck();
      res.json({
        ...status,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/bootstrap', async (_req, res, next) => {
    try {
      const [people, workLogs, tasks, taskLogs] = await Promise.all([
        store.listPeople(),
        store.listWorkLogs(),
        store.listTasks(),
        store.listTaskLogs(),
      ]);
      res.json({
        people,
        workLogs,
        tasks,
        taskLogs,
        validStatuses: VALID_TASK_STATUSES,
      });
    } catch (err) {
      next(err);
    }
  });

  // People directory
  app.get('/api/people', async (_req, res, next) => {
    try {
      const people = await store.listPeople();
      res.json({ people });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/people', async (req, res, next) => {
    try {
      const name = cleanString(req.body?.name, 120);
      const role = cleanString(req.body?.role ?? '', 120);
      if (!name) {
        return res.status(400).json({ error: 'Person name is required.' });
      }
      const person = await store.addPerson({
        name,
        role,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ person });
    } catch (err) {
      if (err.code === 'DUPLICATE_PERSON') {
        return res.status(409).json({ error: err.message });
      }
      next(err);
    }
  });

  // Part 1: Daily Work Logs (Name, Feature, Work Done + Date/Time)
  app.get('/api/work-logs', async (_req, res, next) => {
    try {
      const workLogs = await store.listWorkLogs();
      res.json({ workLogs });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/work-logs', async (req, res, next) => {
    try {
      const personName = cleanString(req.body?.name ?? req.body?.personName, 120);
      const feature = cleanString(req.body?.feature, 200);
      const workDone = cleanString(req.body?.workDone ?? req.body?.work_done, 4000);

      if (!personName) {
        return res.status(400).json({ error: 'Name is required.' });
      }
      if (!feature) {
        return res.status(400).json({ error: 'Feature is required.' });
      }
      if (!workDone) {
        return res.status(400).json({ error: 'Work Done is required.' });
      }

      const workLog = await store.createWorkLog({
        personName,
        feature,
        workDone,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ workLog });
    } catch (err) {
      next(err);
    }
  });

  // Part 2: Tasks & Immutable Status Logs
  app.get('/api/tasks', async (_req, res, next) => {
    try {
      const tasks = await store.listTasks();
      res.json({ tasks });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tasks', async (req, res, next) => {
    try {
      const status = cleanString(req.body?.status, 40);
      const taskName = cleanString(req.body?.taskName ?? req.body?.task_name, 200);
      const assignedTo = cleanString(req.body?.assignedTo ?? req.body?.assigned_to, 120);
      const assignedAtRaw = req.body?.assignedAt ?? req.body?.assigned_at;
      const taskDescription = cleanString(req.body?.taskDescription ?? req.body?.task_description, 4000);

      if (!VALID_TASK_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `Status must be one of: ${VALID_TASK_STATUSES.join(', ')}.`,
        });
      }
      if (!taskName) {
        return res.status(400).json({ error: 'Task Name is required.' });
      }
      if (!assignedTo) {
        return res.status(400).json({ error: 'Assigned To is required.' });
      }
      const assignedAt = parseIsoTimestamp(assignedAtRaw) ?? new Date().toISOString();
      if (assignedAtRaw && !parseIsoTimestamp(assignedAtRaw)) {
        return res.status(400).json({ error: 'Assigned At must be a valid date and time.' });
      }
      if (!taskDescription) {
        return res.status(400).json({ error: 'Task Description is required.' });
      }

      const result = await store.createTask({
        status,
        taskName,
        assignedTo,
        assignedAt,
        taskDescription,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/tasks/:id/status', async (req, res, next) => {
    try {
      const taskId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(taskId) || taskId <= 0) {
        return res.status(400).json({ error: 'Invalid task id.' });
      }
      const newStatus = cleanString(req.body?.status, 40);
      if (!VALID_TASK_STATUSES.includes(newStatus)) {
        return res.status(400).json({
          error: `Status must be one of: ${VALID_TASK_STATUSES.join(', ')}.`,
        });
      }

      const result = await store.updateTaskStatus({
        taskId,
        newStatus,
        loggedAt: new Date().toISOString(),
      });
      if (!result) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/task-logs', async (_req, res, next) => {
    try {
      const taskLogs = await store.listTaskLogs();
      res.json({ taskLogs });
    } catch (err) {
      next(err);
    }
  });

  // Serve static frontend
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error('[server error]', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const store = await createStore();
  const app = createApp(store);

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`CTW Updates running on http://localhost:${port} (db: ${store.dialect})`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
