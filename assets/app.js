
const TASKS_KEY = 'tugasku_tasks';
const LEGACY_TASKS_KEY = 'taskflow_tasks';
const SETTINGS_KEY = 'tugasku_settings';
const EDIT_KEY = 'tugasku_edit_id';
const INCOMING_DRAFT_KEY = 'tugasku_incoming_draft';
const defaultReminderOffsets = [10080, 4320, 1440, 120];
let tasks = [];
let settings = { default7: true, default3: true, default1: true, default2h: true, theme: 'light' };
let currentPriority = 'medium';
let deferredPrompt = null;

function $(id) { return document.getElementById(id); }
function page() { return document.body.dataset.page || 'dashboard'; }

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function loadTasks() {
  const saved = localStorage.getItem(TASKS_KEY) || localStorage.getItem(LEGACY_TASKS_KEY);
  if (!saved) {
    tasks = [];
    return;
  }
  try {
    const parsed = JSON.parse(saved);
    tasks = Array.isArray(parsed) ? parsed.map(normalizeTask) : [];
  } catch (e) {
    console.error('Gagal membaca data tugas', e);
    tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  localStorage.setItem(LEGACY_TASKS_KEY, JSON.stringify(tasks));
  syncWidgetSummaryToServiceWorker();
}


function getWidgetSummaryPayload() {
  const summary = getSummary();
  const urgentTask = tasks
    .filter(task => !task.archived && !task.completed)
    .sort(sortBySmartPriority)[0];
  const dueSoonToday = tasks.filter(task => {
    if (!task.deadline || task.archived || task.completed) return false;
    const diff = new Date(task.deadline).getTime() - Date.now();
    return diff >= 0 && diff <= 2 * 86400000;
  }).length;
  const statusLabel = dueSoonToday
    ? `${dueSoonToday} deadline hari ini atau besok.`
    : summary.overdue
      ? `${summary.overdue} tugas sudah melewati deadline.`
      : 'Belum ada deadline dekat.';

  return {
    title: 'TugasKu',
    subtitle: urgentTask
      ? `Prioritas saat ini: ${urgentTask.text}`
      : 'Ringkasan cepat tugas kuliah dan deadline terdekat.',
    total: String(summary.total),
    active: String(summary.active),
    dueSoon: String(summary.dueThisWeek),
    todayLabel: statusLabel,
    progress: `${summary.progress}%`
  };
}

async function syncWidgetSummaryToServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const payload = { type: 'UPDATE_WIDGET_SUMMARY', summary: getWidgetSummaryPayload() };
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    }
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting || registration.installing;
    worker?.postMessage(payload);
  } catch (error) {
    console.warn('Sinkronisasi widget belum aktif di browser ini.', error);
  }
}

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    settings = {
      default7: parsed.default7 !== false,
      default3: parsed.default3 !== false,
      default1: parsed.default1 !== false,
      default2h: parsed.default2h !== false,
      theme: ['light', 'dark', 'auto'].includes(parsed.theme) ? parsed.theme : (settings.theme || 'light')
    };
  } catch (e) {
    console.error('Gagal membaca pengaturan', e);
  }
}

function saveSettings() {
  const themeValue = document.querySelector('input[name="themeMode"]:checked')?.value || settings.theme || 'light';
  const next = {
    default7: $('default7')?.checked ?? settings.default7,
    default3: $('default3')?.checked ?? settings.default3,
    default1: $('default1')?.checked ?? settings.default1,
    default2h: $('default2h')?.checked ?? settings.default2h,
    theme: themeValue
  };
  settings = next;
  persistSettings();
  applyTheme();
  renderNotificationStatus('Pengaturan berhasil disimpan.');
}

function defaultOffsetsFromSettings() {
  const offsets = [
    settings.default7 ? 10080 : null,
    settings.default3 ? 4320 : null,
    settings.default1 ? 1440 : null,
    settings.default2h ? 120 : null
  ].filter(Boolean);
  return offsets.length ? offsets : [...defaultReminderOffsets];
}

function getPreferredTheme(themeMode = settings.theme) {
  if (themeMode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return themeMode || 'light';
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function syncThemeControls() {
  document.querySelectorAll('input[name="themeMode"]').forEach(input => {
    input.checked = input.value === (settings.theme || 'light');
  });
}

function applyTheme() {
  const activeTheme = getPreferredTheme();
  document.documentElement.setAttribute('data-theme', activeTheme);
  document.body?.setAttribute('data-theme-active', activeTheme);
  document.documentElement.style.colorScheme = activeTheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', activeTheme === 'dark' ? '#0B1220' : '#2563EB');
  const toggle = $('themeToggle');
  if (toggle) {
    toggle.innerHTML = activeTheme === 'dark' ? '☀️<span>Tema</span>' : '🌙<span>Tema</span>';
    toggle.setAttribute('aria-label', activeTheme === 'dark' ? 'Ubah ke mode terang' : 'Ubah ke mode gelap');
    toggle.dataset.themeMode = settings.theme || 'light';
  }
  syncThemeControls();
}

function setThemeMode(mode) {
  settings.theme = ['light', 'dark', 'auto'].includes(mode) ? mode : 'light';
  persistSettings();
  applyTheme();
}

function toggleTheme() {
  const nextMode = getPreferredTheme() === 'dark' ? 'light' : 'dark';
  setThemeMode(nextMode);
}

function normalizeTask(task) {
  const normalized = {
    id: task.id || Date.now(),
    text: task.text || '',
    subject: task.subject || 'Umum',
    description: task.description || '',
    deadline: task.deadline || null,
    completed: Boolean(task.completed),
    archived: Boolean(task.archived),
    priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
    status: task.status || (task.completed ? 'selesai' : 'belum'),
    type: task.type || 'Tugas',
    workMode: task.workMode || 'Individu',
    weight: Number(task.weight || 0),
    estimateMinutes: Number(task.estimateMinutes || 0),
    lecturer: task.lecturer || '',
    channel: task.channel || 'LMS',
    checklist: Array.isArray(task.checklist) ? task.checklist.map(item => ({ text: item.text || '', done: Boolean(item.done) })) : [],
    reminderOffsets: Array.isArray(task.reminderOffsets) && task.reminderOffsets.length ? task.reminderOffsets.map(Number) : defaultOffsetsFromSettings(),
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
    completedAt: task.completedAt || null,
    notifiedOffsets: Array.isArray(task.notifiedOffsets) ? task.notifiedOffsets.map(Number) : []
  };
  normalized.completed = normalized.status === 'selesai' ? true : normalized.completed;
  return normalized;
}

function computeSmartPriority(task) {
  let score = 0;
  const manualScore = { high: 36, medium: 20, low: 10 };
  const statusPenalty = { belum: 16, progress: 10, revisi: 14, selesai: -30 };
  score += manualScore[task.priority] || 0;
  score += statusPenalty[task.status] || 0;
  score += Math.min(Number(task.weight || 0), 100) * 0.35;
  score += Math.min(Number(task.estimateMinutes || 0), 480) / 18;
  if (task.deadline) {
    const diffHours = (new Date(task.deadline).getTime() - Date.now()) / 3600000;
    if (diffHours < 0) score += 40;
    else if (diffHours <= 6) score += 34;
    else if (diffHours <= 24) score += 26;
    else if (diffHours <= 72) score += 18;
    else if (diffHours <= 168) score += 10;
    else score += 4;
  }
  if (task.archived) score -= 40;
  if (task.completed) score -= 18;
  let level = 'low';
  if (score >= 64) level = 'high';
  else if (score >= 38) level = 'medium';
  return { score, level, label: getPriorityLabel(level) };
}

function getPriorityLabel(priority) {
  return priority === 'high' ? 'Tinggi' : priority === 'medium' ? 'Sedang' : 'Rendah';
}

function getStatusLabel(status) {
  if (status === 'progress') return 'Sedang dikerjakan';
  if (status === 'revisi') return 'Revisi';
  if (status === 'selesai') return 'Selesai';
  return 'Belum dikerjakan';
}

function formatDateTime(value) {
  if (!value) return 'Belum ditentukan';
  const d = new Date(value);
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatForDateTimeLocal(value) {
  const d = new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelativeTime(diffMs) {
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  if (minutes < 60) return past ? `Terlambat ${minutes} menit` : `${minutes} menit lagi`;
  if (hours < 48) return past ? `Terlambat ${hours} jam` : `${hours} jam lagi`;
  return past ? `Terlambat ${days} hari` : `${days} hari lagi`;
}

function formatMinutes(minutes) {
  const v = Number(minutes || 0);
  if (!v) return '0 menit';
  if (v < 60) return `${v} menit`;
  if (v % 60 === 0) return `${v / 60} jam`;
  return `${Math.floor(v / 60)} jam ${v % 60} menit`;
}

function getDeadlineInfo(task) {
  if (!task.deadline) return { label: 'Belum ditentukan', relative: 'Tambahkan deadline agar prioritas lebih akurat', className: '' };
  const diff = new Date(task.deadline).getTime() - Date.now();
  const hours = diff / 3600000;
  let className = 'deadline-safe';
  if (hours < 0) className = 'deadline-danger';
  else if (hours <= 24) className = 'deadline-warning';
  return { label: formatDateTime(task.deadline), relative: formatRelativeTime(diff), className };
}

function isOverdue(task) {
  return Boolean(task.deadline) && new Date(task.deadline).getTime() < Date.now();
}

function daysUntil(value) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

function isWithinLastDays(date, days) {
  return Date.now() - date.getTime() <= days * 86400000;
}

function getTasksDueWithinDays(days, includeCompleted=false) {
  const now = Date.now();
  const future = now + (days * 86400000);
  return tasks.filter(task => {
    if (!task.deadline || task.archived) return false;
    if (!includeCompleted && task.completed) return false;
    const time = new Date(task.deadline).getTime();
    return time >= now && time <= future;
  });
}

function groupTasksBySubject() {
  return tasks.reduce((acc, task) => {
    const key = task.subject || 'Umum';
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});
}

function getAverageWeight() {
  const weighted = tasks.filter(t => Number(t.weight) > 0);
  if (!weighted.length) return 0;
  return Math.round(weighted.reduce((s, t) => s + Number(t.weight || 0), 0) / weighted.length);
}

function getBusiestSubject() {
  const grouped = groupTasksBySubject();
  let best = '';
  let max = 0;
  Object.entries(grouped).forEach(([subject, arr]) => {
    const count = arr.filter(task => !task.archived && !task.completed).length;
    if (count > max) {
      max = count;
      best = subject;
    }
  });
  return best;
}

function sortByDeadline(a, b) {
  const at = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
  return at - bt;
}

function sortBySmartPriority(a, b) {
  const diff = computeSmartPriority(b).score - computeSmartPriority(a).score;
  if (diff !== 0) return diff;
  return sortByDeadline(a, b);
}

function getSummary() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const archived = tasks.filter(t => t.archived).length;
  const active = tasks.filter(t => !t.archived && !t.completed).length;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const dueThisWeek = getTasksDueWithinDays(7, false).length;
  const highPriority = tasks.filter(t => !t.archived && !t.completed && computeSmartPriority(t).level === 'high').length;
  const subjects = new Set(tasks.filter(t => t.subject).map(t => t.subject)).size;
  const overdue = tasks.filter(t => !t.completed && isOverdue(t)).length;
  const completedThisWeek = tasks.filter(t => t.completedAt && isWithinLastDays(new Date(t.completedAt), 7)).length;
  const weekLoadHours = Math.round((getTasksDueWithinDays(7, false).reduce((sum, t) => sum + Number(t.estimateMinutes || 0), 0) / 60) * 10) / 10;
  return { total, completed, archived, active, progress, dueThisWeek, highPriority, subjects, overdue, completedThisWeek, weekLoadHours, averageWeight: getAverageWeight(), busiest: getBusiestSubject() || '-' };
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function updateHeaderStats() {
  const s = getSummary();
  setText('sidebarTotal', s.total);
  setText('sidebarCompleted', s.completed);
  setText('sidebarProgress', `${s.progress}%`);
  setText('chipDueCount', s.dueThisWeek);
  setText('chipLoadCount', `${s.weekLoadHours || 0}j`);
}

function renderDashboard() {
  const summary = getSummary();
  setText('statActive', summary.active);
  setText('statHigh', summary.highPriority);
  setText('statSubject', summary.subjects);
  setText('statArchive', summary.archived);
  setText('statProgress', `${summary.progress}%`);
  setText('heroDueText', `${summary.dueThisWeek} deadline dalam 7 hari`);
  setText('heroLoadText', `${summary.weekLoadHours || 0} jam estimasi minggu ini`);
  setText('heroDoneText', `${summary.completedThisWeek} tugas selesai minggu ini`);

  const urgent = tasks.filter(t => !t.archived && !t.completed).sort(sortBySmartPriority)[0];
  const urgentBox = $('urgentTaskBox');
  if (urgentBox) {
    if (!urgent) {
      urgentBox.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><h3>Belum ada tugas prioritas</h3><p>Tambahkan tugas baru agar sistem menyusun prioritas secara otomatis.</p></div>`;
    } else {
      const smart = computeSmartPriority(urgent);
      const deadline = getDeadlineInfo(urgent);
      urgentBox.innerHTML = `
        <div>
          <div class="task-subject">${escapeHtml(urgent.subject)}</div>
          <div class="task-title">${escapeHtml(urgent.text)}</div>
          ${urgent.description ? `<div class="task-desc">${escapeHtml(urgent.description)}</div>` : ''}
          <div class="task-meta">
            <span class="pill ${smart.level}">🔥 Smart ${smart.label}</span>
            <span class="pill">📅 ${escapeHtml(deadline.label)}</span>
            <span class="pill ${deadline.className}">⏱ ${escapeHtml(deadline.relative)}</span>
          </div>
          <div class="form-actions" style="margin-top:16px;">
            <a class="btn" href="tugas.html">Lihat semua tugas</a>
            <button class="btn-secondary" onclick="goEdit(${urgent.id})">Edit tugas ini</button>
          </div>
        </div>`;
    }
  }

  const dueList = $('dueSoonList');
  if (dueList) {
    const dueTasks = getTasksDueWithinDays(7, false).sort(sortBySmartPriority).slice(0, 4);
    if (!dueTasks.length) {
      dueList.innerHTML = emptyState('📆', 'Belum ada deadline dekat', 'Tugas yang jatuh tempo dalam 7 hari akan muncul di sini.');
    } else {
      dueList.innerHTML = dueTasks.map(renderCompactTaskCard).join('');
    }
  }

  const recentList = $('recentTaskList');
  if (recentList) {
    const recent = tasks.filter(t => !t.archived).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0,5);
    recentList.innerHTML = recent.length ? recent.map(renderTaskCard).join('') : emptyState('📝', 'Belum ada tugas', 'Mulai dengan menambahkan tugas pertama semester ini.');
  }
}

function renderCompactTaskCard(task) {
  const smart = computeSmartPriority(task);
  const deadline = getDeadlineInfo(task);
  return `
    <article class="task-card">
      <button class="task-check ${task.completed ? 'checked' : ''}" onclick="toggleTask(${task.id})" title="Tandai selesai">${task.completed ? '✓' : ''}</button>
      <div>
        <div class="task-head">
          <div>
            <div class="task-subject">${escapeHtml(task.subject)}</div>
            <div class="task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.text)}</div>
          </div>
          <div class="task-meta">
            <span class="pill ${smart.level}">🔥 ${smart.label}</span>
          </div>
        </div>
        <div class="task-meta">
          <span class="pill">📅 ${escapeHtml(deadline.label)}</span>
          <span class="pill ${deadline.className}">⏱ ${escapeHtml(deadline.relative)}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="btn-secondary" onclick="goEdit(${task.id})">Edit</button>
      </div>
    </article>`;
}

function getTaskFilters() {
  return {
    keyword: ($('searchInput')?.value || '').trim().toLowerCase(),
    subject: $('subjectFilter')?.value || 'all',
    status: $('statusFilter')?.value || 'all',
    sort: $('sortFilter')?.value || 'smart',
    tab: document.querySelector('.tab-btn.active')?.dataset.filter || 'all'
  };
}

function getFilteredTasks() {
  const filters = getTaskFilters();
  let filtered = tasks.filter(t => !t.archived);
  if (filters.keyword) {
    filtered = filtered.filter(task => [task.text, task.subject, task.description, task.lecturer, task.type, task.channel]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(filters.keyword)));
  }
  if (filters.subject !== 'all') filtered = filtered.filter(t => t.subject === filters.subject);
  if (filters.status !== 'all') filtered = filtered.filter(t => t.status === filters.status);
  if (filters.tab === 'active') filtered = filtered.filter(t => !t.completed);
  if (filters.tab === 'completed') filtered = filtered.filter(t => t.completed);
  if (filters.tab === 'high') filtered = filtered.filter(t => !t.completed && computeSmartPriority(t).level === 'high');
  if (filters.tab === 'overdue') filtered = filtered.filter(t => !t.completed && isOverdue(t));

  if (filters.sort === 'deadline') filtered.sort(sortByDeadline);
  else if (filters.sort === 'newest') filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  else if (filters.sort === 'subject') filtered.sort((a,b) => a.subject.localeCompare(b.subject, 'id'));
  else filtered.sort(sortBySmartPriority);
  return filtered;
}

function renderTasksPage() {
  const list = $('taskList');
  const archive = $('archiveList');
  if (!list) return;
  const active = getFilteredTasks();
  list.innerHTML = active.length ? active.map(renderTaskCard).join('') : emptyState('📂', 'Tidak ada tugas yang cocok', 'Coba ubah filter atau tambahkan tugas baru.');
  const archived = tasks.filter(t => t.archived).sort(sortBySmartPriority);
  if (archive) archive.innerHTML = archived.length ? archived.map(renderArchiveCard).join('') : emptyState('🗄️', 'Belum ada arsip', 'Tugas yang sudah selesai dan diarsipkan akan tampil di sini.');

  const summary = getSummary();
  setText('taskSummaryText', `${summary.progress}% selesai • ${summary.active} tugas aktif • ${summary.overdue} terlambat`);
  populateSubjectOptions();
}

function renderTaskCard(task) {
  const smart = computeSmartPriority(task);
  const deadline = getDeadlineInfo(task);
  const checklistDone = task.checklist.filter(item => item.done).length;
  const checklistText = task.checklist.length ? `${checklistDone}/${task.checklist.length} subbagian selesai` : 'Tanpa checklist';
  return `
    <article class="task-card">
      <button class="task-check ${task.completed ? 'checked' : ''}" onclick="toggleTask(${task.id})" title="Tandai selesai / belum selesai">${task.completed ? '✓' : ''}</button>
      <div>
        <div class="task-head">
          <div>
            <div class="task-subject">${escapeHtml(task.subject)}</div>
            <div class="task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.text)}</div>
          </div>
          <div class="task-meta">
            <span class="pill ${smart.level}">🔥 Smart ${smart.label}</span>
            <span class="pill ${task.priority}">🎯 Manual ${getPriorityLabel(task.priority)}</span>
            <span class="pill status-${task.status}">📌 ${getStatusLabel(task.status)}</span>
          </div>
        </div>
        ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          <span class="pill">📅 ${escapeHtml(deadline.label)}</span>
          <span class="pill ${deadline.className}">⏱ ${escapeHtml(deadline.relative)}</span>
          <span class="pill">📚 ${escapeHtml(task.type)}</span>
          <span class="pill">👥 ${escapeHtml(task.workMode)}</span>
        </div>
        <div class="task-extra">
          <span class="pill">🏆 Bobot ${task.weight || 0}%</span>
          <span class="pill">⌛ ${formatMinutes(task.estimateMinutes)}</span>
          <span class="pill">📨 ${escapeHtml(task.channel)}</span>
          <span class="pill">👨‍🏫 ${escapeHtml(task.lecturer || '-')}</span>
          <span class="pill">🧩 ${escapeHtml(checklistText)}</span>
        </div>
        ${task.checklist.length ? `<div class="checklist">${task.checklist.map((item, index) => `
          <label class="check-item">
            <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleChecklist(${task.id}, ${index})" />
            <span class="${item.done ? 'done' : ''}">${escapeHtml(item.text)}</span>
          </label>`).join('')}</div>` : ''}
      </div>
      <div class="task-actions">
        <select onchange="updateTaskStatus(${task.id}, this.value)">
          <option value="belum" ${task.status === 'belum' ? 'selected' : ''}>Belum dikerjakan</option>
          <option value="progress" ${task.status === 'progress' ? 'selected' : ''}>Sedang dikerjakan</option>
          <option value="revisi" ${task.status === 'revisi' ? 'selected' : ''}>Revisi</option>
          <option value="selesai" ${task.status === 'selesai' ? 'selected' : ''}>Selesai</option>
        </select>
        <button class="btn-secondary" onclick="goEdit(${task.id})">Edit</button>
        ${task.completed ? `<button class="btn-success" onclick="archiveTask(${task.id})">Arsipkan</button>` : ''}
        <button class="btn-danger" onclick="deleteTask(${task.id})">Hapus</button>
      </div>
    </article>`;
}

function renderArchiveCard(task) {
  const deadline = getDeadlineInfo(task);
  return `
    <article class="task-card">
      <div class="task-check checked">✓</div>
      <div>
        <div class="task-subject">${escapeHtml(task.subject)}</div>
        <div class="task-title completed">${escapeHtml(task.text)}</div>
        <div class="task-meta">
          <span class="pill status-selesai">✅ Selesai</span>
          <span class="pill">🗄️ Arsip</span>
          <span class="pill">📅 ${escapeHtml(deadline.label)}</span>
          <span class="pill">⌛ ${formatMinutes(task.estimateMinutes)}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="btn-secondary" onclick="restoreTask(${task.id})">Kembalikan</button>
        <button class="btn-danger" onclick="deleteTask(${task.id})">Hapus</button>
      </div>
    </article>`;
}

function emptyState(icon, title, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p></div>`;
}

function populateSubjectOptions() {
  const subjects = Array.from(new Set(tasks.map(task => task.subject).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'id'));
  const datalist = $('subjectSuggestions');
  if (datalist) datalist.innerHTML = subjects.map(subject => `<option value="${escapeHtml(subject)}"></option>`).join('');
  const filter = $('subjectFilter');
  if (filter) {
    const selected = filter.value || 'all';
    filter.innerHTML = '<option value="all">Semua mata kuliah</option>' + subjects.map(subject => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('');
    filter.value = subjects.includes(selected) ? selected : 'all';
  }
}

function renderCalendarPage() {
  const grid = $('calendarGrid');
  if (!grid) return;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + i);
    return d;
  });
  grid.innerHTML = days.map(date => {
    const daily = tasks.filter(task => {
      if (task.archived || !task.deadline) return false;
      return new Date(task.deadline).toDateString() === date.toDateString();
    }).sort(sortBySmartPriority);
    return `
      <article class="calendar-card ${new Date().toDateString() === date.toDateString() ? 'today' : ''}">
        <div class="calendar-date">
          <strong>${date.toLocaleDateString('id-ID', { weekday:'short', day:'numeric', month:'short' })}</strong>
          <span class="pill">${daily.length} tugas</span>
        </div>
        <div class="calendar-list">
          ${daily.length ? daily.map(task => `
            <div class="calendar-item">
              <strong>${escapeHtml(task.text)}</strong>
              <span>${escapeHtml(task.subject)} • ${formatTime(task.deadline)} • ${getPriorityLabel(computeSmartPriority(task).level)}</span>
            </div>`).join('') : '<div class="calendar-item"><strong>Hari relatif kosong</strong><span>Tidak ada deadline pada hari ini.</span></div>'}
        </div>
      </article>`;
  }).join('');
}

function renderCoursesPage() {
  const grid = $('courseGrid');
  if (!grid) return;
  const grouped = groupTasksBySubject();
  const subjects = Object.keys(grouped).sort((a,b) => a.localeCompare(b, 'id'));
  if (!subjects.length) {
    grid.innerHTML = emptyState('📚', 'Belum ada mata kuliah', 'Tambahkan tugas lebih dulu, lalu ringkasan mata kuliah akan muncul otomatis.');
    return;
  }
  grid.innerHTML = subjects.map(subject => {
    const courseTasks = grouped[subject];
    const active = courseTasks.filter(t => !t.completed && !t.archived).length;
    const done = courseTasks.filter(t => t.completed).length;
    const upcoming = courseTasks.filter(t => !t.completed && !t.archived && t.deadline && daysUntil(t.deadline) <= 7).length;
    const heavy = courseTasks.filter(t => !t.archived).reduce((sum, t) => sum + Number(t.estimateMinutes || 0), 0);
    return `
      <article class="course-card">
        <h3>${escapeHtml(subject)}</h3>
        <p>${active ? `${active} tugas aktif sedang dipantau.` : 'Tidak ada tugas aktif saat ini.'}</p>
        <div class="course-meta">
          <span class="pill">📝 Aktif ${active}</span>
          <span class="pill">✅ Selesai ${done}</span>
          <span class="pill">📅 Deadline 7 hari ${upcoming}</span>
          <span class="pill">⌛ ${formatMinutes(heavy)}</span>
        </div>
      </article>`;
  }).join('');
}

function renderStatsPage() {
  const s = getSummary();
  setText('statsCompletedWeek', s.completedThisWeek);
  setText('statsOverdue', s.overdue);
  setText('statsBusiest', s.busiest);
  setText('statsWeight', `${s.averageWeight}%`);

  const activeTasks = tasks.filter(t => !t.archived);
  const high = activeTasks.filter(t => computeSmartPriority(t).level === 'high').length;
  const medium = activeTasks.filter(t => computeSmartPriority(t).level === 'medium').length;
  const low = activeTasks.filter(t => computeSmartPriority(t).level === 'low').length;
  const completed = tasks.filter(t => t.completed).length;
  const progress = s.progress || 0;

  const distribution = $('priorityDistribution');
  if (distribution) {
    distribution.innerHTML = `
      <article class="chart-card">
        <div class="panel-head"><div><h3>Progres pengerjaan</h3><p>Persentase tugas selesai dari seluruh tugas yang tercatat.</p></div></div>
        <div class="donut-chart">
          <div class="donut-wrap">
            <div class="donut" style="--value:${progress};"></div>
            <div class="donut-center"><strong>${progress}%</strong><span>Selesai</span></div>
          </div>
          <div class="legend-list">
            <div class="legend-item">
              <div class="legend-top"><div class="legend-left"><span class="legend-dot done"></span><span>Tugas selesai</span></div><strong>${completed}</strong></div>
              <div class="bar-track"><div class="bar-fill" style="width:${progress}%"></div></div>
            </div>
            <div class="legend-item">
              <div class="legend-top"><div class="legend-left"><span class="legend-dot todo"></span><span>Belum selesai</span></div><strong>${Math.max(tasks.length - completed, 0)}</strong></div>
              <div class="bar-track"><div class="bar-fill" style="width:${100 - progress}%; background: rgba(148,163,184,.6);"></div></div>
            </div>
            <div class="micro-note">${s.total} total tugas tercatat • ${s.archived} diarsipkan • ${s.active} masih aktif</div>
          </div>
        </div>
      </article>
      <article class="chart-card">
        <div class="panel-head"><div><h3>Distribusi prioritas</h3><p>Komposisi tugas aktif berdasarkan penilaian prioritas otomatis.</p></div></div>
        <div class="bar-list">
          <div class="bar-item"><div class="bar-top"><span>🔥 Tinggi</span><strong>${high}</strong></div><div class="bar-track"><div class="bar-fill high" style="width:${activeTasks.length ? (high / activeTasks.length) * 100 : 0}%"></div></div></div>
          <div class="bar-item"><div class="bar-top"><span>⚡ Sedang</span><strong>${medium}</strong></div><div class="bar-track"><div class="bar-fill medium" style="width:${activeTasks.length ? (medium / activeTasks.length) * 100 : 0}%"></div></div></div>
          <div class="bar-item"><div class="bar-top"><span>🌿 Rendah</span><strong>${low}</strong></div><div class="bar-track"><div class="bar-fill low" style="width:${activeTasks.length ? (low / activeTasks.length) * 100 : 0}%"></div></div></div>
        </div>
        <div class="micro-note" style="margin-top:14px;">Beban minggu ini ${s.weekLoadHours || 0} jam • ${s.dueThisWeek} deadline dalam 7 hari</div>
      </article>`;
  }

  const statusBreakdown = $('statusBreakdown');
  if (statusBreakdown) {
    const activeOnly = tasks.filter(t => !t.archived);
    const counts = {
      belum: activeOnly.filter(t => t.status === 'belum').length,
      progress: activeOnly.filter(t => t.status === 'progress').length,
      revisi: activeOnly.filter(t => t.status === 'revisi').length,
      selesai: activeOnly.filter(t => t.status === 'selesai').length
    };
    const total = activeOnly.length || 1;
    statusBreakdown.innerHTML = `
      <div class="status-grid">
        <div class="status-row"><div class="bar-top"><span>Belum dikerjakan</span><strong>${counts.belum}</strong></div><div class="bar-track"><div class="bar-fill belum" style="width:${(counts.belum / total) * 100}%"></div></div></div>
        <div class="status-row"><div class="bar-top"><span>Sedang dikerjakan</span><strong>${counts.progress}</strong></div><div class="bar-track"><div class="bar-fill progress" style="width:${(counts.progress / total) * 100}%"></div></div></div>
        <div class="status-row"><div class="bar-top"><span>Revisi</span><strong>${counts.revisi}</strong></div><div class="bar-track"><div class="bar-fill revisi" style="width:${(counts.revisi / total) * 100}%"></div></div></div>
        <div class="status-row"><div class="bar-top"><span>Selesai</span><strong>${counts.selesai}</strong></div><div class="bar-track"><div class="bar-fill selesai" style="width:${(counts.selesai / total) * 100}%"></div></div></div>
      </div>`;
  }

  const subjectLoadChart = $('subjectLoadChart');
  if (subjectLoadChart) {
    const grouped = groupTasksBySubject();
    const subjects = Object.entries(grouped)
      .map(([subject, arr]) => ({
        subject,
        minutes: arr.filter(t => !t.archived && !t.completed).reduce((sum, t) => sum + Number(t.estimateMinutes || 0), 0)
      }))
      .filter(item => item.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);
    const max = subjects[0]?.minutes || 1;
    subjectLoadChart.innerHTML = subjects.length ? `
      <div class="bar-list">
        ${subjects.map(item => `
          <div class="bar-item">
            <div class="bar-top"><span>${escapeHtml(item.subject)}</span><strong>${Math.round(item.minutes / 60 * 10) / 10} jam</strong></div>
            <div class="bar-track"><div class="bar-fill" style="width:${(item.minutes / max) * 100}%"></div></div>
          </div>`).join('')}
      </div>` : emptyState('📚', 'Belum ada data beban', 'Tambah estimasi waktu pada tugas agar grafik beban per mata kuliah muncul.');
  }
}

function renderSettingsPage() {
  if ($('default7')) $('default7').checked = settings.default7;
  if ($('default3')) $('default3').checked = settings.default3;
  if ($('default1')) $('default1').checked = settings.default1;
  if ($('default2h')) $('default2h').checked = settings.default2h;
  syncThemeControls();
  renderNotificationStatus();
}


function setFieldValue(id, value) {
  const field = $(id);
  if (field && typeof value !== 'undefined' && value !== null) field.value = value;
}

function mergeTextParts(...parts) {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join('\n\n');
}

function buildDraftFromParams(params) {
  const sharedTitle = params.get('title')?.trim() || '';
  const sharedText = params.get('text')?.trim() || '';
  const sharedUrl = params.get('url')?.trim() || '';
  const protocolRaw = params.get('protocol') || '';
  let protocolValue = '';
  if (protocolRaw) {
    try {
      protocolValue = decodeURIComponent(protocolRaw);
    } catch (error) {
      protocolValue = protocolRaw;
    }
  }
  if (!sharedTitle && !sharedText && !sharedUrl && !protocolValue) return null;
  const title = sharedTitle || (sharedText ? sharedText.split('\n').map(item => item.trim()).find(Boolean) || 'Tugas baru dari Share' : 'Tugas baru dari Share');
  const description = mergeTextParts(
    sharedText && sharedText !== title ? sharedText : '',
    sharedUrl ? `Sumber: ${sharedUrl}` : '',
    protocolValue ? `Deep link: ${protocolValue}` : ''
  );
  return {
    taskInput: title,
    descriptionInput: description,
    channelInput: sharedUrl ? 'WhatsApp' : 'LMS'
  };
}

function saveIncomingDraft(draft) {
  if (!draft) return;
  localStorage.setItem(INCOMING_DRAFT_KEY, JSON.stringify(draft));
}

function consumeIncomingDraft() {
  const raw = localStorage.getItem(INCOMING_DRAFT_KEY);
  if (!raw) return null;
  localStorage.removeItem(INCOMING_DRAFT_KEY);
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Draft masuk gagal dibaca', error);
    return null;
  }
}

function applyDraftToForm(draft, sourceLabel='sumber eksternal') {
  if (!draft) return false;
  setFieldValue('taskInput', draft.taskInput || '');
  setFieldValue('subjectInput', draft.subjectInput || '');
  setFieldValue('deadlineInput', draft.deadlineInput || '');
  setFieldValue('descriptionInput', draft.descriptionInput || '');
  setFieldValue('lecturerInput', draft.lecturerInput || '');
  if (draft.channelInput && $('channelInput')) $('channelInput').value = draft.channelInput;
  if (draft.typeInput && $('typeInput')) $('typeInput').value = draft.typeInput;
  if (draft.modeInput && $('modeInput')) $('modeInput').value = draft.modeInput;
  if (draft.estimateInput && $('estimateInput')) $('estimateInput').value = String(draft.estimateInput);
  if (draft.priority) setPriority(draft.priority);
  setText('formStateText', `Draft form berhasil diisi dari ${sourceLabel}. Silakan cek kembali sebelum menyimpan.`);
  return true;
}

function handleIncomingDraftParams() {
  const params = new URLSearchParams(location.search);
  const draft = buildDraftFromParams(params);
  if (!draft) return false;
  applyDraftToForm(draft, params.get('protocol') ? 'deep link' : 'share target');
  history.replaceState({}, document.title, location.pathname);
  return true;
}

function buildDraftFromTextFile(text, filename='') {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  return {
    taskInput: lines[0] || filename || 'Draft tugas impor',
    descriptionInput: mergeTextParts(lines.slice(1).join('\n'), filename ? `Sumber file: ${filename}` : ''),
    channelInput: 'Offline'
  };
}

function buildDraftFromJson(jsonData, filename='') {
  const source = Array.isArray(jsonData) ? jsonData[0] : jsonData;
  if (!source || typeof source !== 'object') return null;
  const taskName = source.text || source.title || source.name || filename || 'Draft tugas impor';
  return {
    taskInput: taskName,
    subjectInput: source.subject || source.course || '',
    deadlineInput: source.deadline || '',
    descriptionInput: mergeTextParts(source.description || source.notes || '', filename ? `Sumber file: ${filename}` : ''),
    lecturerInput: source.lecturer || '',
    channelInput: source.channel || 'Offline',
    typeInput: source.type || 'Tugas',
    modeInput: source.workMode || source.mode || 'Individu',
    estimateInput: source.estimateMinutes || 120,
    priority: ['high', 'medium', 'low'].includes(source.priority) ? source.priority : 'medium'
  };
}

async function handleLaunchFiles() {
  if (!('launchQueue' in window) || typeof window.launchQueue.setConsumer !== 'function') return;
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams?.files?.length) return;
    try {
      const fileHandle = launchParams.files[0];
      const file = await fileHandle.getFile();
      const filename = file.name || '';
      const content = await file.text();
      let draft = null;
      if (file.type === 'application/json' || filename.toLowerCase().endsWith('.json')) {
        draft = buildDraftFromJson(JSON.parse(content), filename);
      } else {
        draft = buildDraftFromTextFile(content, filename);
      }
      if (!draft) return;
      if (page() === 'form') applyDraftToForm(draft, 'file yang dibuka');
      else {
        saveIncomingDraft(draft);
        location.href = 'tambah.html?from=file';
      }
    } catch (error) {
      console.error('Gagal memproses file yang dibuka lewat PWA', error);
    }
  });
}

async function setupBackgroundFeatures() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      try {
        await registration.sync.register('refresh-app-shell');
      } catch (error) {
        console.warn('Background Sync belum aktif di browser ini.', error);
      }
    }
    if ('periodicSync' in registration && 'permissions' in navigator) {
      try {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await registration.periodicSync.register('refresh-app-shell-periodic', {
            minInterval: 24 * 60 * 60 * 1000
          });
        }
      } catch (error) {
        console.warn('Periodic Background Sync belum tersedia.', error);
      }
    }
  } catch (error) {
    console.error('Gagal menyiapkan background features', error);
  }
}

function parseChecklist(text) {
  return text.split('\n').map(item => item.trim()).filter(Boolean).map(item => ({ text: item, done: false }));
}

function getSelectedReminderOffsets() {
  const selected = Array.from(document.querySelectorAll('.reminder-check:checked')).map(el => Number(el.value));
  return selected.length ? selected : defaultOffsetsFromSettings();
}

function setPriority(priority) {
  currentPriority = priority;
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === priority);
  });
}

function resetForm() {
  localStorage.removeItem(EDIT_KEY);
  const form = $('taskForm');
  if (!form) return;
  form.reset();
  if ($('subjectInput')) $('subjectInput').value = '';
  if ($('statusInput')) $('statusInput').value = 'belum';
  if ($('typeInput')) $('typeInput').value = 'Tugas';
  if ($('channelInput')) $('channelInput').value = 'LMS';
  if ($('modeInput')) $('modeInput').value = 'Individu';
  if ($('estimateInput')) $('estimateInput').value = '120';
  setPriority('medium');
  applyReminderOffsets(defaultOffsetsFromSettings());
  setText('formStateText', 'Tambahkan tugas baru dengan informasi yang lengkap agar prioritas tersusun lebih akurat.');
  setText('submitTaskText', 'Simpan tugas');
}

function applyReminderOffsets(offsets) {
  document.querySelectorAll('.reminder-check').forEach(el => {
    el.checked = offsets.includes(Number(el.value));
  });
}

function initFormPage() {
  const form = $('taskForm');
  if (!form) return;
  populateSubjectOptions();
  applyReminderOffsets(defaultOffsetsFromSettings());
  setPriority('medium');
  const editId = Number(new URLSearchParams(location.search).get('edit') || localStorage.getItem(EDIT_KEY) || 0);
  if (editId) {
    const task = tasks.find(t => Number(t.id) === editId);
    if (task) {
      localStorage.setItem(EDIT_KEY, String(editId));
      $('taskInput').value = task.text;
      $('subjectInput').value = task.subject;
      $('deadlineInput').value = task.deadline ? formatForDateTimeLocal(task.deadline) : '';
      $('statusInput').value = task.status;
      $('typeInput').value = task.type;
      $('descriptionInput').value = task.description || '';
      $('checklistInput').value = task.checklist.map(i => i.text).join('\n');
      $('lecturerInput').value = task.lecturer || '';
      $('channelInput').value = task.channel || 'LMS';
      $('modeInput').value = task.workMode || 'Individu';
      $('weightInput').value = task.weight || '';
      $('estimateInput').value = String(task.estimateMinutes || 120);
      applyReminderOffsets(task.reminderOffsets || defaultOffsetsFromSettings());
      setPriority(task.priority || 'medium');
      setText('formStateText', 'Mode edit aktif. Setelah disimpan, data tugas akan diperbarui.');
      setText('submitTaskText', 'Perbarui tugas');
    }
  } else {
    const storedDraft = consumeIncomingDraft();
    if (storedDraft) applyDraftToForm(storedDraft, 'draft impor');
    handleIncomingDraftParams();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addOrUpdateTask();
  });
}

function addOrUpdateTask() {
  const taskName = $('taskInput').value.trim();
  if (!taskName) return;
  const editId = Number(localStorage.getItem(EDIT_KEY) || 0);
  const existing = editId ? tasks.find(t => Number(t.id) === editId) : null;
  const status = $('statusInput').value;
  const data = normalizeTask({
    id: existing?.id || Date.now(),
    text: taskName,
    subject: $('subjectInput').value.trim() || 'Umum',
    description: $('descriptionInput').value.trim(),
    deadline: $('deadlineInput').value || null,
    completed: status === 'selesai',
    archived: existing?.archived || false,
    priority: currentPriority,
    status,
    type: $('typeInput').value,
    workMode: $('modeInput').value,
    weight: Number($('weightInput').value || 0),
    estimateMinutes: Number($('estimateInput').value || 0),
    lecturer: $('lecturerInput').value.trim(),
    channel: $('channelInput').value,
    checklist: parseChecklist($('checklistInput').value),
    reminderOffsets: getSelectedReminderOffsets(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: status === 'selesai' ? (existing?.completedAt || new Date().toISOString()) : null,
    notifiedOffsets: existing?.notifiedOffsets || []
  });

  if (existing) tasks = tasks.map(t => Number(t.id) === editId ? data : t);
  else tasks.unshift(data);
  saveTasks();
  localStorage.removeItem(EDIT_KEY);
  location.href = 'tugas.html';
}

function goEdit(id) {
  localStorage.setItem(EDIT_KEY, String(id));
  location.href = `tambah.html?edit=${id}`;
}

function deleteTask(id) {
  if (!confirm('Hapus tugas ini?')) return;
  tasks = tasks.filter(t => Number(t.id) !== Number(id));
  saveTasks();
  rerenderCurrentPage();
}

function toggleTask(id) {
  const task = tasks.find(t => Number(t.id) === Number(id));
  if (!task) return;
  task.completed = !task.completed;
  task.status = task.completed ? 'selesai' : 'belum';
  task.completedAt = task.completed ? new Date().toISOString() : null;
  task.updatedAt = new Date().toISOString();
  saveTasks();
  rerenderCurrentPage();
}

function updateTaskStatus(id, status) {
  const task = tasks.find(t => Number(t.id) === Number(id));
  if (!task) return;
  task.status = status;
  task.completed = status === 'selesai';
  task.completedAt = task.completed ? (task.completedAt || new Date().toISOString()) : null;
  task.updatedAt = new Date().toISOString();
  saveTasks();
  rerenderCurrentPage();
}

function toggleChecklist(taskId, index) {
  const task = tasks.find(t => Number(t.id) === Number(taskId));
  if (!task || !task.checklist[index]) return;
  task.checklist[index].done = !task.checklist[index].done;
  task.updatedAt = new Date().toISOString();
  saveTasks();
  rerenderCurrentPage();
}

function archiveTask(id) {
  const task = tasks.find(t => Number(t.id) === Number(id));
  if (!task) return;
  task.archived = true;
  task.updatedAt = new Date().toISOString();
  saveTasks();
  rerenderCurrentPage();
}

function restoreTask(id) {
  const task = tasks.find(t => Number(t.id) === Number(id));
  if (!task) return;
  task.archived = false;
  task.updatedAt = new Date().toISOString();
  saveTasks();
  rerenderCurrentPage();
}

function archiveCompletedTasks() {
  tasks = tasks.map(task => task.completed ? { ...task, archived: true, updatedAt: new Date().toISOString() } : task);
  saveTasks();
  rerenderCurrentPage();
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    renderNotificationStatus('Browser ini belum mendukung Notification API.');
    return;
  }
  Notification.requestPermission().then(permission => {
    renderNotificationStatus(
      permission === 'granted' ? 'Notifikasi berhasil diaktifkan.' :
      permission === 'denied' ? 'Notifikasi ditolak. Pengingat tetap bisa dilihat saat aplikasi dibuka.' :
      'Permintaan notifikasi belum dipilih.'
    );
  });
}

function renderNotificationStatus(customText='') {
  const el = $('notificationStatusText');
  if (!el) return;
  if (customText) { el.textContent = customText; return; }
  if (!('Notification' in window)) el.textContent = 'Browser ini belum mendukung browser notification.';
  else el.textContent = `Izin notifikasi saat ini: ${Notification.permission}.`;
}

async function showDeadlineNotification(task, offset) {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification('Pengingat TugasKu', {
        body: `${task.text} (${task.subject}) akan jatuh tempo ${getReminderLabel(offset)}.`,
        icon: 'icons/icon-192x192-A.png',
        badge: 'icons/icon-192x192-A.png',
        tag: `task-${task.id}-${offset}`
      });
    }
  } catch (e) {
    console.error('Gagal menampilkan notifikasi', e);
  }
}

function getReminderLabel(offset) {
  if (offset === 10080) return 'dalam 7 hari';
  if (offset === 4320) return 'dalam 3 hari';
  if (offset === 1440) return 'dalam 1 hari';
  if (offset === 120) return 'dalam 2 jam';
  return 'segera';
}

function checkDueReminders() {
  let updated = false;
  tasks.forEach(task => {
    if (!task.deadline || task.completed || task.archived) return;
    const diffMinutes = Math.floor((new Date(task.deadline).getTime() - Date.now()) / 60000);
    task.reminderOffsets.forEach(offset => {
      const already = task.notifiedOffsets.includes(offset);
      if (!already && diffMinutes <= offset && diffMinutes >= 0) {
        task.notifiedOffsets.push(offset);
        showDeadlineNotification(task, offset);
        updated = true;
      }
    });
  });
  if (updated) saveTasks();
}

function setupInstallButtons() {
  const buttons = [ $('installBtn'), $('installBtnAlt') ].filter(Boolean);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    buttons.forEach(btn => btn.style.display = 'inline-flex');
  });
  buttons.forEach(button => {
    button.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      buttons.forEach(btn => btn.style.display = 'none');
    });
  });
}

function setupSidebar() {
  const menuBtn = $('menuBtn');
  const sidebar = $('sidebar');
  const overlay = $('overlay');
  if (!menuBtn || !sidebar || !overlay) return;
  const close = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.classList.remove('no-scroll');
  };
  menuBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.classList.add('no-scroll');
  });
  overlay.addEventListener('click', close);
  document.querySelectorAll('[data-close-sidebar]').forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function setActiveNav() {
  const current = page();
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === current);
  });
}

function bindTaskFilters() {
  ['searchInput', 'subjectFilter', 'statusFilter', 'sortFilter'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', renderTasksPage);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', renderTasksPage);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTasksPage();
    });
  });
}

function rerenderCurrentPage() {
  loadTasks();
  updateHeaderStats();
  if (page() === 'dashboard') renderDashboard();
  if (page() === 'tasks') renderTasksPage();
  if (page() === 'calendar') renderCalendarPage();
  if (page() === 'courses') renderCoursesPage();
  if (page() === 'stats') renderStatsPage();
  if (page() === 'settings') renderSettingsPage();
}

function initThemeListeners() {
  $('themeToggle')?.addEventListener('click', toggleTheme);
  document.querySelectorAll('input[name="themeMode"]').forEach(input => {
    input.addEventListener('change', (event) => {
      if (event.target.checked) {
        setThemeMode(event.target.value);
      }
    });
  });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSchemeChange = () => {
    if (settings.theme === 'auto') applyTheme();
  };
  if (media?.addEventListener) media.addEventListener('change', handleSchemeChange);
  else if (media?.addListener) media.addListener(handleSchemeChange);
}

function initPage() {
  loadSettings();
  applyTheme();
  loadTasks();
  syncWidgetSummaryToServiceWorker();
  setupSidebar();
  setActiveNav();
  updateHeaderStats();
  setupInstallButtons();
  checkDueReminders();
  initThemeListeners();
  handleLaunchFiles();
  setupBackgroundFeatures();
  if (page() === 'dashboard') renderDashboard();
  if (page() === 'form') initFormPage();
  if (page() === 'tasks') { bindTaskFilters(); renderTasksPage(); }
  if (page() === 'calendar') renderCalendarPage();
  if (page() === 'courses') renderCoursesPage();
  if (page() === 'stats') renderStatsPage();
  if (page() === 'settings') renderSettingsPage();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDueReminders(); });
window.addEventListener('focus', checkDueReminders);
setInterval(checkDueReminders, 60000);

document.addEventListener('DOMContentLoaded', initPage);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./service-worker.js');
      setupBackgroundFeatures();
    } catch (err) {
      console.error('Service Worker error', err);
    }
  });
}

window.goEdit = goEdit;
window.deleteTask = deleteTask;
window.toggleTask = toggleTask;
window.updateTaskStatus = updateTaskStatus;
window.toggleChecklist = toggleChecklist;
window.archiveTask = archiveTask;
window.restoreTask = restoreTask;
window.archiveCompletedTasks = archiveCompletedTasks;
window.setPriority = setPriority;
window.requestNotificationPermission = requestNotificationPermission;
window.saveSettings = saveSettings;
window.resetForm = resetForm;
window.toggleTheme = toggleTheme;
