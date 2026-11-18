const state = {
  people: [],
  workLogs: [],
  tasks: [],
  taskLogs: [],
  activeTab: 'work-logs',
  workGroupMode: 'name-date',
  taskStatusFilter: 'ALL',
  auditTaskFilter: '',
  lastActiveDropdownTarget: null,
};

const VALID_STATUSES = ['Not Started', 'Ongoing', 'Completed', 'NA'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toLocalDateKey(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'Unknown Date';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateHeading(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTimeWithSeconds(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimeOnly(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDatetimeLocalValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function statusClass(status) {
  switch (status) {
    case 'Completed':
      return 'status-completed';
    case 'Ongoing':
      return 'status-ongoing';
    case 'Not Started':
      return 'status-not-started';
    default:
      return 'status-na';
  }
}

function showToast(message, type = 'default') {
  const region = document.getElementById('toastRegion');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3600);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function updateLiveClock() {
  const clockEl = document.getElementById('liveClockWork');
  if (!clockEl) return;
  clockEl.textContent = new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadBootstrap() {
  const data = await apiFetch('/api/bootstrap');
  state.people = data.people || [];
  state.workLogs = data.workLogs || [];
  state.tasks = data.tasks || [];
  state.taskLogs = data.taskLogs || [];
  renderAll();
}

function renderAll() {
  renderKpis();
  renderPeopleDropdowns();
  renderWorkLogs();
  renderTasks();
  renderTaskLogs();
  renderPeopleDirectory();
}

function renderKpis() {
  const todayKey = toLocalDateKey(new Date().toISOString());
  const todayLogs = state.workLogs.filter((l) => toLocalDateKey(l.created_at) === todayKey);

  const pendingCount = state.tasks.filter(
    (t) => t.status === 'Ongoing' || t.status === 'Not Started'
  ).length;
  const ongoingCount = state.tasks.filter((t) => t.status === 'Ongoing').length;
  const completedCount = state.tasks.filter((t) => t.status === 'Completed').length;

  document.getElementById('kpiTodayLogs').textContent = String(todayLogs.length);
  document.getElementById('kpiTotalLogs').textContent = `${state.workLogs.length} total`;
  document.getElementById('kpiPendingTasks').textContent = String(pendingCount);
  document.getElementById('kpiOngoingMeta').textContent = `${ongoingCount} ongoing`;
  document.getElementById('kpiCompletedTasks').textContent = String(completedCount);
  document.getElementById('kpiTotalTasks').textContent = `${state.tasks.length} total tasks`;
  document.getElementById('kpiPeopleCount').textContent = String(state.people.length);

  document.getElementById('tabCountWorkLogs').textContent = String(state.workLogs.length);
  document.getElementById('tabCountTasks').textContent = String(state.tasks.length);
  document.getElementById('tabCountPeople').textContent = String(state.people.length);
}

function populateSelectPreservingValue(selectEl, placeholder, items) {
  const prev = selectEl.value;
  selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    selectEl.appendChild(opt);
  }
  if (prev && items.some((i) => i.value === prev)) {
    selectEl.value = prev;
  }
}

function renderPeopleDropdowns() {
  const peopleOptions = state.people.map((p) => ({
    value: p.name,
    label: p.role ? `${p.name} (${p.role})` : p.name,
  }));

  const workPersonSelect = document.getElementById('workPersonSelect');
  const taskAssignedToSelect = document.getElementById('taskAssignedToSelect');

  populateSelectPreservingValue(
    workPersonSelect,
    state.people.length ? 'Select team member...' : 'No people added yet — click "+ Add Person"',
    peopleOptions
  );
  populateSelectPreservingValue(
    taskAssignedToSelect,
    state.people.length ? 'Select assignee...' : 'No people added yet — click "+ Add Person"',
    peopleOptions
  );

  // Filter dropdowns include registered people plus any historical names in logs/tasks
  const workNameSet = new Set(state.people.map((p) => p.name));
  state.workLogs.forEach((l) => workNameSet.add(l.person_name));
  const sortedWorkNames = [...workNameSet].sort((a, b) => a.localeCompare(b));
  populateSelectPreservingValue(
    document.getElementById('workFilterPerson'),
    'All Team Members',
    sortedWorkNames.map((n) => ({ value: n, label: n }))
  );

  const assigneeSet = new Set(state.people.map((p) => p.name));
  state.tasks.forEach((t) => assigneeSet.add(t.assigned_to));
  const sortedAssignees = [...assigneeSet].sort((a, b) => a.localeCompare(b));
  populateSelectPreservingValue(
    document.getElementById('taskFilterAssignee'),
    'All Assignees',
    sortedAssignees.map((n) => ({ value: n, label: n }))
  );

  // Audit log task filter dropdown
  const auditFilterEl = document.getElementById('auditTaskFilter');
  populateSelectPreservingValue(
    auditFilterEl,
    'All Tasks',
    state.tasks.map((t) => ({
      value: String(t.id),
      label: `#${t.id} · ${t.task_name}`,
    }))
  );
  if (state.auditTaskFilter) {
    auditFilterEl.value = state.auditTaskFilter;
  }
}

function renderWorkLogs() {
  const container = document.getElementById('workLogsContainer');
  const search = document.getElementById('workSearchInput').value.trim().toLowerCase();
  const filterPerson = document.getElementById('workFilterPerson').value;
  const filterRange = document.getElementById('workFilterRange').value;

  const todayKey = toLocalDateKey(new Date().toISOString());
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const filtered = state.workLogs.filter((log) => {
    if (filterPerson && log.person_name !== filterPerson) return false;
    if (filterRange === 'today' && toLocalDateKey(log.created_at) !== todayKey) return false;
    if (filterRange === '7d' && new Date(log.created_at).getTime() < sevenDaysAgoMs) return false;
    if (search) {
      const hay = `${log.person_name} ${log.feature} ${log.work_done}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const emptyMsg =
      state.workLogs.length === 0
        ? 'No daily work logs recorded yet. Add a team member and submit your first entry on the left.'
        : 'No work logs match your current search or filter criteria.';
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMsg)}</div>`;
    return;
  }

  const roleByName = new Map(state.people.map((p) => [p.name, p.role]));

  if (state.workGroupMode === 'name-date') {
    // Group by Name -> Date (descending) -> Entries (descending)
    const byName = new Map();
    for (const log of filtered) {
      if (!byName.has(log.person_name)) {
        byName.set(log.person_name, []);
      }
      byName.get(log.person_name).push(log);
    }

    const sortedNames = [...byName.keys()].sort((a, b) => a.localeCompare(b));
    container.innerHTML = sortedNames
      .map((personName) => {
        const personLogs = byName.get(personName);
        const byDate = new Map();
        for (const log of personLogs) {
          const dateKey = toLocalDateKey(log.created_at);
          if (!byDate.has(dateKey)) byDate.set(dateKey, []);
          byDate.get(dateKey).push(log);
        }
        const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
        const role = roleByName.get(personName);
        const latestAt = personLogs[0]?.created_at;

        const dateBlocksHtml = sortedDates
          .map((dateKey) => {
            const entries = byDate.get(dateKey);
            const isToday = dateKey === todayKey;
            const entriesHtml = entries
              .map(
                (entry) => `
                  <div class="log-entry">
                    <div class="log-entry-top">
                      <span class="feature-badge">${escapeHtml(entry.feature)}</span>
                      <span class="timestamp-mono">${escapeHtml(formatDateTime(entry.created_at))}</span>
                    </div>
                    <p class="log-work-done">${escapeHtml(entry.work_done)}</p>
                  </div>
                `
              )
              .join('');

            return `
              <div class="subgroup-block">
                <div class="subgroup-header">
                  <span class="subgroup-label">
                    ${escapeHtml(formatDateHeading(dateKey))}
                    ${isToday ? '<span class="today-tag">Today</span>' : ''}
                  </span>
                  <span class="subgroup-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
                </div>
                <div class="log-entries-stack">${entriesHtml}</div>
              </div>
            `;
          })
          .join('');

        return `
          <article class="group-card">
            <div class="group-header">
              <div class="group-identity">
                <div class="avatar">${escapeHtml(getInitials(personName))}</div>
                <div>
                  <h3 class="group-title">${escapeHtml(personName)}</h3>
                  <div class="group-sub">${role ? escapeHtml(role) : 'Team Member'} &middot; Latest: ${escapeHtml(formatDateTime(latestAt))}</div>
                </div>
              </div>
              <span class="group-stats">${personLogs.length} total ${personLogs.length === 1 ? 'log' : 'logs'}</span>
            </div>
            ${dateBlocksHtml}
          </article>
        `;
      })
      .join('');
    return;
  }

  // Group by Date (descending) -> Name (alphabetical)
  const byDate = new Map();
  for (const log of filtered) {
    const dateKey = toLocalDateKey(log.created_at);
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(log);
  }

  const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  container.innerHTML = sortedDates
    .map((dateKey) => {
      const dateLogs = byDate.get(dateKey);
      const isToday = dateKey === todayKey;
      const byName = new Map();
      for (const log of dateLogs) {
        if (!byName.has(log.person_name)) byName.set(log.person_name, []);
        byName.get(log.person_name).push(log);
      }
      const sortedNames = [...byName.keys()].sort((a, b) => a.localeCompare(b));

      const nameBlocksHtml = sortedNames
        .map((personName) => {
          const entries = byName.get(personName);
          const entriesHtml = entries
            .map(
              (entry) => `
                <div class="log-entry">
                  <div class="log-entry-top">
                    <span class="feature-badge">${escapeHtml(entry.feature)}</span>
                    <span class="timestamp-mono">${escapeHtml(formatDateTime(entry.created_at))}</span>
                  </div>
                  <p class="log-work-done">${escapeHtml(entry.work_done)}</p>
                </div>
              `
            )
            .join('');

          return `
            <div class="subgroup-block">
              <div class="subgroup-header">
                <span class="subgroup-label">
                  <span class="avatar-xs">${escapeHtml(getInitials(personName))}</span>
                  ${escapeHtml(personName)}
                </span>
                <span class="subgroup-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
              </div>
              <div class="log-entries-stack">${entriesHtml}</div>
            </div>
          `;
        })
        .join('');

      return `
        <article class="group-card">
          <div class="group-header">
            <div class="group-identity">
              <div>
                <h3 class="group-title">
                  ${escapeHtml(formatDateHeading(dateKey))}
                  ${isToday ? '<span class="today-tag">Today</span>' : ''}
                </h3>
                <div class="group-sub">${sortedNames.length} ${sortedNames.length === 1 ? 'contributor' : 'contributors'}</div>
              </div>
            </div>
            <span class="group-stats">${dateLogs.length} ${dateLogs.length === 1 ? 'entry' : 'entries'}</span>
          </div>
          ${nameBlocksHtml}
        </article>
      `;
    })
    .join('');
}

function renderTasks() {
  const counts = {
    ALL: state.tasks.length,
    PENDING: state.tasks.filter((t) => t.status === 'Ongoing' || t.status === 'Not Started').length,
    Ongoing: state.tasks.filter((t) => t.status === 'Ongoing').length,
    'Not Started': state.tasks.filter((t) => t.status === 'Not Started').length,
    Completed: state.tasks.filter((t) => t.status === 'Completed').length,
    NA: state.tasks.filter((t) => t.status === 'NA').length,
  };

  for (const [key, count] of Object.entries(counts)) {
    const badge = document.querySelector(`[data-count="${key}"]`);
    if (badge) badge.textContent = String(count);
  }

  const search = document.getElementById('taskSearchInput').value.trim().toLowerCase();
  const assignee = document.getElementById('taskFilterAssignee').value;

  const statusOrder = { Ongoing: 0, 'Not Started': 1, Completed: 2, NA: 3 };
  const logCountByTask = new Map();
  for (const log of state.taskLogs) {
    logCountByTask.set(log.task_id, (logCountByTask.get(log.task_id) || 0) + 1);
  }

  const filtered = state.tasks
    .filter((t) => {
      if (state.taskStatusFilter === 'PENDING') {
        if (t.status !== 'Ongoing' && t.status !== 'Not Started') return false;
      } else if (state.taskStatusFilter !== 'ALL' && t.status !== state.taskStatusFilter) {
        return false;
      }
      if (assignee && t.assigned_to !== assignee) return false;
      if (search) {
        const hay = `#${t.id} ${t.task_name} ${t.task_description} ${t.assigned_to}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const rankDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  const tbody = document.getElementById('tasksTableBody');
  const emptyEl = document.getElementById('tasksEmptyState');
  const tableWrap = document.getElementById('tasksTable').closest('.table-wrap');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    tableWrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    emptyEl.textContent =
      state.tasks.length === 0
        ? 'No tasks logged yet. Create a task on the left to start tracking.'
        : 'No tasks match your active filter.';
    return;
  }

  tableWrap.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  tbody.innerHTML = filtered
    .map((task) => {
      const logCount = logCountByTask.get(task.id) || 1;
      const optionsHtml = VALID_STATUSES.map(
        (s) => `<option value="${escapeHtml(s)}" ${s === task.status ? 'selected' : ''}>${escapeHtml(s)}</option>`
      ).join('');

      return `
        <tr>
          <td>
            <select
              class="status-select ${statusClass(task.status)}"
              data-task-id="${task.id}"
              aria-label="Update status for ${escapeHtml(task.task_name)}"
            >
              ${optionsHtml}
            </select>
          </td>
          <td class="task-title-cell">
            <div class="task-name-row">
              <span class="task-id-tag">#${task.id}</span>
              <span>${escapeHtml(task.task_name)}</span>
            </div>
            <p class="task-desc-text">${escapeHtml(task.task_description)}</p>
            <button type="button" class="task-history-btn" data-filter-audit-task="${task.id}">
              View History (${logCount})
            </button>
          </td>
          <td>
            <span class="person-chip">
              <span class="avatar-xs">${escapeHtml(getInitials(task.assigned_to))}</span>
              ${escapeHtml(task.assigned_to)}
            </span>
          </td>
          <td><span class="timestamp-mono">${escapeHtml(formatDateTime(task.assigned_at))}</span></td>
          <td><span class="timestamp-mono">${escapeHtml(formatDateTime(task.updated_at))}</span></td>
        </tr>
      `;
    })
    .join('');
}

function renderTaskLogs() {
  const tbody = document.getElementById('taskLogsTableBody');
  const emptyEl = document.getElementById('taskLogsEmptyState');
  const tableWrap = tbody.closest('.table-wrap');

  const taskIdFilter = state.auditTaskFilter ? Number(state.auditTaskFilter) : null;
  const filtered = taskIdFilter
    ? state.taskLogs.filter((l) => l.task_id === taskIdFilter)
    : state.taskLogs;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    tableWrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    emptyEl.textContent =
      state.taskLogs.length === 0
        ? 'Task activity and status modifications will appear here permanently.'
        : 'No audit log entries for the selected task.';
    return;
  }

  tableWrap.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  tbody.innerHTML = filtered
    .map((log) => {
      const isCreated = log.event_type === 'CREATED';
      const eventBadge = isCreated
        ? '<span class="event-badge event-created">Task Created</span>'
        : '<span class="event-badge event-modified">Status Modified</span>';

      const transitionHtml = isCreated
        ? `<span class="status-badge ${statusClass(log.new_status)}">${escapeHtml(log.new_status)}</span>`
        : `
          <span class="transition-cell">
            <span class="status-badge ${statusClass(log.previous_status)}">${escapeHtml(log.previous_status)}</span>
            <span class="arrow-sep">&rarr;</span>
            <span class="status-badge ${statusClass(log.new_status)}">${escapeHtml(log.new_status)}</span>
          </span>
        `;

      return `
        <tr>
          <td><span class="timestamp-mono">${escapeHtml(formatDateTimeWithSeconds(log.logged_at))}</span></td>
          <td>${eventBadge}</td>
          <td class="task-title-cell">
            <div class="task-name-row">
              <span class="task-id-tag">#${log.task_id}</span>
              <span>${escapeHtml(log.task_name)}</span>
            </div>
            <p class="task-desc-text">${escapeHtml(log.task_description)}</p>
          </td>
          <td>${transitionHtml}</td>
          <td>
            <span class="person-chip">
              <span class="avatar-xs">${escapeHtml(getInitials(log.assigned_to))}</span>
              ${escapeHtml(log.assigned_to)}
            </span>
          </td>
          <td><span class="timestamp-mono">${escapeHtml(formatDateTime(log.assigned_at))}</span></td>
        </tr>
      `;
    })
    .join('');
}

function renderPeopleDirectory() {
  const tbody = document.getElementById('peopleTableBody');
  const emptyEl = document.getElementById('peopleEmptyState');
  const tableWrap = tbody.closest('.table-wrap');

  if (state.people.length === 0) {
    tbody.innerHTML = '';
    tableWrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = 'No team members added yet. Add people on the left to populate the dropdowns.';
    return;
  }

  tableWrap.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  const workCounts = new Map();
  for (const log of state.workLogs) {
    workCounts.set(log.person_name, (workCounts.get(log.person_name) || 0) + 1);
  }
  const taskCounts = new Map();
  for (const task of state.tasks) {
    taskCounts.set(task.assigned_to, (taskCounts.get(task.assigned_to) || 0) + 1);
  }

  tbody.innerHTML = state.people
    .map(
      (person) => `
        <tr>
          <td>
            <span class="person-chip">
              <span class="avatar-xs">${escapeHtml(getInitials(person.name))}</span>
              ${escapeHtml(person.name)}
            </span>
          </td>
          <td>${person.role ? escapeHtml(person.role) : '<span class="muted-label">—</span>'}</td>
          <td>${workCounts.get(person.name) || 0}</td>
          <td>${taskCounts.get(person.name) || 0}</td>
          <td><span class="timestamp-mono">${escapeHtml(formatDateTime(person.created_at))}</span></td>
        </tr>
      `
    )
    .join('');
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

function openAddPersonModal(targetSelectId = null) {
  state.lastActiveDropdownTarget = targetSelectId;
  const modal = document.getElementById('addPersonModal');
  modal.classList.remove('hidden');
  document.getElementById('modalPersonName').value = '';
  document.getElementById('modalPersonRole').value = '';
  setTimeout(() => document.getElementById('modalPersonName').focus(), 20);
}

function closeAddPersonModal() {
  document.getElementById('addPersonModal').classList.add('hidden');
}

async function handleCreatePerson({ name, role, autoSelectTargetId }) {
  const { person } = await apiFetch('/api/people', {
    method: 'POST',
    body: JSON.stringify({ name, role }),
  });
  state.people.push(person);
  state.people.sort((a, b) => a.name.localeCompare(b.name));
  renderAll();
  if (autoSelectTargetId) {
    const targetEl = document.getElementById(autoSelectTargetId);
    if (targetEl) targetEl.value = person.name;
  }
  showToast(`Added "${person.name}" to Team Directory.`, 'success');
  return person;
}

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    try {
      await loadBootstrap();
      showToast('Workspace synced.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Work Log Form
  document.getElementById('workLogForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitWorkLogBtn');
    const name = document.getElementById('workPersonSelect').value.trim();
    const feature = document.getElementById('workFeatureInput').value.trim();
    const workDone = document.getElementById('workDoneInput').value.trim();

    if (!name) {
      showToast('Please select a Name (or click "+ Add Person").', 'error');
      return;
    }

    btn.disabled = true;
    try {
      const { workLog } = await apiFetch('/api/work-logs', {
        method: 'POST',
        body: JSON.stringify({ name, feature, workDone }),
      });
      state.workLogs.unshift(workLog);
      document.getElementById('workFeatureInput').value = '';
      document.getElementById('workDoneInput').value = '';
      renderAll();
      showToast(`Logged work for ${workLog.person_name} at ${formatTimeOnly(workLog.created_at)}.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Work Logs Grouping & Filters
  document.querySelectorAll('[data-group-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.workGroupMode = btn.dataset.groupMode;
      document.querySelectorAll('[data-group-mode]').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      renderWorkLogs();
    });
  });

  document.getElementById('workSearchInput').addEventListener('input', renderWorkLogs);
  document.getElementById('workFilterPerson').addEventListener('change', renderWorkLogs);
  document.getElementById('workFilterRange').addEventListener('change', renderWorkLogs);

  // Set Assigned At default & "Set to Now"
  const assignedAtInput = document.getElementById('taskAssignedAtInput');
  assignedAtInput.value = toDatetimeLocalValue(new Date());
  document.getElementById('setAssignedNowBtn').addEventListener('click', () => {
    assignedAtInput.value = toDatetimeLocalValue(new Date());
  });

  // Create Task Form
  document.getElementById('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitTaskBtn');
    const status = document.getElementById('taskStatusSelect').value;
    const taskName = document.getElementById('taskNameInput').value.trim();
    const assignedTo = document.getElementById('taskAssignedToSelect').value.trim();
    const assignedAtLocal = document.getElementById('taskAssignedAtInput').value;
    const taskDescription = document.getElementById('taskDescInput').value.trim();

    if (!assignedTo) {
      showToast('Please select Assigned To (or click "+ Add Person").', 'error');
      return;
    }

    const assignedAt = assignedAtLocal ? new Date(assignedAtLocal).toISOString() : new Date().toISOString();

    btn.disabled = true;
    try {
      const { task, log } = await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ status, taskName, assignedTo, assignedAt, taskDescription }),
      });
      state.tasks.unshift(task);
      if (log) state.taskLogs.unshift(log);
      document.getElementById('taskNameInput').value = '';
      document.getElementById('taskDescInput').value = '';
      document.getElementById('taskStatusSelect').value = 'Not Started';
      assignedAtInput.value = toDatetimeLocalValue(new Date());
      renderAll();
      showToast(`Task #${task.id} created and logged.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Task Status Filter Pills
  document.getElementById('taskStatusFilterPills').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill-btn');
    if (!pill) return;
    state.taskStatusFilter = pill.dataset.statusFilter;
    document.querySelectorAll('#taskStatusFilterPills .pill-btn').forEach((b) =>
      b.classList.toggle('active', b === pill)
    );
    renderTasks();
  });

  document.getElementById('taskSearchInput').addEventListener('input', renderTasks);
  document.getElementById('taskFilterAssignee').addEventListener('change', renderTasks);

  // Inline Task Status Update + View Task History
  const tasksTableBody = document.getElementById('tasksTableBody');
  tasksTableBody.addEventListener('change', async (e) => {
    const select = e.target.closest('.status-select');
    if (!select) return;
    const taskId = Number(select.dataset.taskId);
    const newStatus = select.value;
    select.disabled = true;
    try {
      const result = await apiFetch(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      const idx = state.tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) state.tasks[idx] = result.task;
      if (result.log) state.taskLogs.unshift(result.log);
      renderAll();
      if (!result.unchanged) {
        showToast(`Task #${taskId} status updated to "${newStatus}" and logged.`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
      renderTasks();
    } finally {
      select.disabled = false;
    }
  });

  tasksTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter-audit-task]');
    if (!btn) return;
    const taskId = btn.dataset.filterAuditTask;
    state.auditTaskFilter = taskId;
    const auditSelect = document.getElementById('auditTaskFilter');
    auditSelect.value = taskId;
    renderTaskLogs();
    auditSelect.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('auditTaskFilter').addEventListener('change', (e) => {
    state.auditTaskFilter = e.target.value;
    renderTaskLogs();
  });

  // Add Person Form (Tab 3)
  document.getElementById('personForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitPersonBtn');
    const name = document.getElementById('personNameInput').value.trim();
    const role = document.getElementById('personRoleInput').value.trim();
    btn.disabled = true;
    try {
      await handleCreatePerson({ name, role });
      document.getElementById('personNameInput').value = '';
      document.getElementById('personRoleInput').value = '';
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Quick Add Person Modal triggers
  document.querySelectorAll('.open-add-person').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.form-group');
      const select = group?.querySelector('select');
      openAddPersonModal(select ? select.id : null);
    });
  });

  document.getElementById('closeModalBtn').addEventListener('click', closeAddPersonModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeAddPersonModal);
  document.getElementById('addPersonModal').addEventListener('click', (e) => {
    if (e.target.id === 'addPersonModal') closeAddPersonModal();
  });

  document.getElementById('modalPersonForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('modalPersonName').value.trim();
    const role = document.getElementById('modalPersonRole').value.trim();
    try {
      await handleCreatePerson({
        name,
        role,
        autoSelectTargetId: state.lastActiveDropdownTarget,
      });
      closeAddPersonModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function init() {
  updateLiveClock();
  setInterval(updateLiveClock, 15000);
  setupEventListeners();
  try {
    await loadBootstrap();
  } catch (err) {
    showToast(`Failed to load workspace: ${err.message}`, 'error');
  }
}

init();
