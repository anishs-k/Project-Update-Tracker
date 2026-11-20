import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createStore } from '../server/db.js';
import { createApp } from '../server/index.js';

// Always runs against SQLite. Set MONGODB_TEST_URI to also run the same suite
// against MongoDB (uses a throwaway database that is dropped afterwards).
const backends = [{ dialect: 'sqlite' }];
if (process.env.MONGODB_TEST_URI) backends.push({ dialect: 'mongodb' });

for (const backend of backends)
describe(`CTW Updates API (${backend.dialect})`, () => {
  let tmpDir;
  let store;
  let server;
  let baseUrl;
  const mongoDbName = `ctw_test_${Date.now()}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctw-updates-test-'));
    const sqlitePath = path.join(tmpDir, 'test.db');
    store =
      backend.dialect === 'mongodb'
        ? await createStore({ mongoUri: process.env.MONGODB_TEST_URI, mongoDbName })
        : await createStore({ mongoUri: '', databaseUrl: '', sqlitePath });
    const app = createApp(store);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (backend.dialect === 'mongodb') {
      const { MongoClient } = await import('mongodb');
      const c = new MongoClient(process.env.MONGODB_TEST_URI);
      await c.db(mongoDbName).dropDatabase();
      await c.close();
    }
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function req(urlPath, options = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options,
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  it(`reports healthy ${backend.dialect} store`, async () => {
    const { status, body } = await req('/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.dialect, backend.dialect);
  });

  it('adds people and prevents case-insensitive duplicates', async () => {
    const res1 = await req('/api/people', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ayush Kumar', role: 'Lead Developer' }),
    });
    assert.equal(res1.status, 201);
    assert.equal(res1.body.person.name, 'Ayush Kumar');

    const resDup = await req('/api/people', {
      method: 'POST',
      body: JSON.stringify({ name: 'ayush kumar', role: 'Engineer' }),
    });
    assert.equal(resDup.status, 409);

    const resEmpty = await req('/api/people', {
      method: 'POST',
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(resEmpty.status, 400);
  });

  it('creates multiple daily work log entries per person with timestamps', async () => {
    const r1 = await req('/api/work-logs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ayush Kumar',
        feature: 'Auth API',
        workDone: 'Implemented JWT refresh flow',
      }),
    });
    assert.equal(r1.status, 201);
    assert.ok(Date.parse(r1.body.workLog.created_at) > 0);

    const r2 = await req('/api/work-logs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ayush Kumar',
        feature: 'Render Config',
        workDone: 'Added render.yaml and Postgres fallback',
      }),
    });
    assert.equal(r2.status, 201);

    const list = await req('/api/work-logs');
    assert.equal(list.status, 200);
    assert.equal(list.body.workLogs.length, 2);
  });

  it('creates tasks and logs immutable creation and status modification entries', async () => {
    const assignedAt = '2026-11-18T10:30:00.000Z';
    const created = await req('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        status: 'Not Started',
        taskName: 'Client Staging Deploy',
        assignedTo: 'Ayush Kumar',
        assignedAt,
        taskDescription: 'Deploy initial build to Render and share URL.',
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.task.status, 'Not Started');
    assert.equal(created.body.log.event_type, 'CREATED');
    assert.equal(created.body.log.new_status, 'Not Started');

    const taskId = created.body.task.id;

    // Invalid status rejected
    const invalid = await req(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Blocked' }),
    });
    assert.equal(invalid.status, 400);

    // Status change -> Ongoing
    const mod1 = await req(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Ongoing' }),
    });
    assert.equal(mod1.status, 200);
    assert.equal(mod1.body.task.status, 'Ongoing');
    assert.equal(mod1.body.log.event_type, 'STATUS_MODIFIED');
    assert.equal(mod1.body.log.previous_status, 'Not Started');
    assert.equal(mod1.body.log.new_status, 'Ongoing');

    // No-op status change does not append duplicate log
    const noop = await req(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Ongoing' }),
    });
    assert.equal(noop.status, 200);
    assert.equal(noop.body.unchanged, true);
    assert.equal(noop.body.log, null);

    // Status change -> Completed
    const mod2 = await req(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Completed' }),
    });
    assert.equal(mod2.status, 200);
    assert.equal(mod2.body.log.previous_status, 'Ongoing');
    assert.equal(mod2.body.log.new_status, 'Completed');

    const logs = await req('/api/task-logs');
    assert.equal(logs.status, 200);
    assert.equal(logs.body.taskLogs.length, 3);
  });

  it('rejects DELETE requests on all API resources to preserve immutable logs', async () => {
    for (const target of ['/api/work-logs/1', '/api/tasks/1', '/api/task-logs/1', '/api/people/1']) {
      const res = await req(target, { method: 'DELETE' });
      assert.equal(res.status, 405);
    }
    const boot = await req('/api/bootstrap');
    assert.equal(boot.status, 200);
    assert.equal(boot.body.workLogs.length, 2);
    assert.equal(boot.body.taskLogs.length, 3);
  });
});
