# CTW Updates — Daily Work Log & Pending Task Tracker

A sleek, corporate-styled web portal designed for sharing daily team updates and task progress with clients, backed by an immutable audit trail.

## Features

1. **Daily Work Logs**
   - Fields: **Name** (from Team Directory dropdown), **Feature**, **Work Done**
   - Automatically stamped with exact **Date & Time**
   - Publicly viewable full history grouped by **Name → Date** (with optional **Date → Name** toggle)
   - Supports multiple entries per person per day, search, person filter, and date-range filters

2. **Pending Tasks & Immutable Audit Log**
   - Fields: **Status** (`Completed` / `Ongoing` / `Not Started` / `NA`), **Task Name**, **Assigned To** (dropdown), **Assigned At** (date & time), **Task Description**
   - Every task creation and every status modification appends a permanent, timestamped entry to the **Task Activity & Status Audit Log**
   - **Non-deletable**: Deletion is disabled in both the UI and HTTP API (`405 Method Not Allowed`)

3. **Add People (Team Directory)**
   - Add team members (Full Name + optional Role/Title) in one place to populate the **Name** and **Assigned To** dropdowns across the app (plus inline `+ Add Person` quick modal)

## Tech Stack

- **Backend**: Node.js (`>=22.13`) + Express
- **Database**: PostgreSQL via `DATABASE_URL` (for Render cloud persistence) with automatic built-in SQLite (`node:sqlite`) fallback for local runs
- **Frontend**: Responsive HTML5 / CSS3 / Vanilla ES Modules (`Inter` + `JetBrains Mono`)

## Local Development

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Data is stored locally in `data/tracker.db` when `DATABASE_URL` is not set.

Run tests:

```bash
npm test
```

## Deploying to Render

This repository includes a [`render.yaml`](./render.yaml) Blueprint that provisions:
- A Node.js Web Service (`ctw-task-checklist`)
- A managed PostgreSQL database (`ctw-task-checklist-db`) wired via `DATABASE_URL`

### Steps
1. In the [Render Dashboard](https://dashboard.render.com/), click **New +** → **Blueprint** (or use the direct Blueprint deploy link: `https://render.com/deploy?repo=https://github.com/AyushMJXLabs/Project-Update-Tracker`).
2. Select `AyushMJXLabs/Project-Update-Tracker` and set **Blueprint Name** to `CTW-Task-Checklist`.
3. Render automatically detects `render.yaml` and creates both the web service and PostgreSQL database.
4. Once deployed, share the generated `https://ctw-task-checklist.onrender.com` URL directly with your client.

> **Note on Persistence**: Render's web service filesystem resets on deploys/restarts, so using `DATABASE_URL` (PostgreSQL via `render.yaml`, or an external Postgres provider like Neon/Supabase) ensures all logs remain permanently stored.
