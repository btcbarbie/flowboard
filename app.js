/* =============================================
   FlowBoard — Smart Workflow Task Manager
   Application Logic
   ============================================= */

/**
 * ARCHITECTURE OVERVIEW
 * 
 * This app follows a simple MVC-inspired pattern:
 *   Model:      Tasks stored in localStorage as JSON array
 *   View:       DOM rendering functions (renderBoard, renderMetrics, etc.)
 *   Controller: Event handlers for CRUD, filtering, drag-and-drop
 * 
 * Key design decisions:
 *   1. Single source of truth in localStorage — all mutations go through
 *      saveTasks() → re-render pipeline.
 *   2. Workflow state machine enforces ordered transitions (Backlog →
 *      In Progress → Review → Done) with a controlled override.
 *   3. Native HTML5 Drag & Drop is used for cross-column card movement.
 *   4. All status changes are automatically logged in each task's
 *      activityLog array with timestamps.
 *   5. Filtering, search, and sort are applied at render time — the
 *      full dataset is always preserved.
 */

// =============================================
// CONSTANTS
// =============================================

const STORAGE_KEY = 'flowboard_tasks';

/** Ordered workflow states — tasks flow left to right */
const STATUSES = ['backlog', 'inprogress', 'review', 'done'];

/** Display labels for each status */
const STATUS_LABELS = {
    backlog: 'Backlog',
    inprogress: 'In Progress',
    review: 'Review',
    done: 'Done'
};

/** Priority sort order (lower number = higher priority) */
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Assignee avatar colors (consistent per person) */
const AVATAR_COLORS = {
    Alex: '#6C5CE7',
    Sam: '#00B894',
    Jordan: '#FDCB6E',
    Taylor: '#E17055'
};

/** Allowed forward transitions from each status */
const ALLOWED_TRANSITIONS = {
    backlog: ['inprogress'],
    inprogress: ['review', 'backlog'],
    review: ['done', 'inprogress'],
    done: ['review']
};

// =============================================
// STATE
// =============================================

let tasks = loadTasks();
let draggedTaskId = null;

// =============================================
// PERSISTENCE (localStorage)
// =============================================

/** Load tasks from localStorage, falling back to empty array */
function loadTasks() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/** Persist current tasks array to localStorage */
function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// =============================================
// TASK CRUD
// =============================================

/** Generate a short unique task ID, e.g. "FB-001" */
function generateId() {
    const max = tasks.reduce((m, t) => {
        const num = parseInt(t.id.replace('FB-', ''), 10);
        return isNaN(num) ? m : Math.max(m, num);
    }, 0);
    return 'FB-' + String(max + 1).padStart(3, '0');
}

/** Create a new task object from form values */
function createTask(data) {
    const now = new Date().toISOString();
    return {
        id: generateId(),
        title: data.title.trim(),
        description: data.description.trim(),
        status: 'backlog',
        priority: data.priority,
        assignee: data.assignee,
        dueDate: data.dueDate,
        createdDate: now,
        effort: data.effort ? parseFloat(data.effort) : null,
        tags: data.tags
            ? data.tags.split(',').map(t => t.trim()).filter(Boolean)
            : [],
        activityLog: [
            { action: 'Task created', timestamp: now }
        ]
    };
}

/** Update an existing task by ID. Returns the updated task or null. */
function updateTask(id, updates) {
    const task = tasks.find(t => t.id === id);
    if (!task) return null;
    Object.assign(task, updates);
    saveTasks();
    return task;
}

/** Delete a task by ID */
function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    renderAll();
}

// =============================================
// WORKFLOW STATE MACHINE
// =============================================

/**
 * Attempt to change a task's status. Enforces workflow ordering.
 * Returns true if the transition was allowed, false otherwise.
 */
function changeStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return false;

    const allowed = ALLOWED_TRANSITIONS[task.status] || [];
    if (!allowed.includes(newStatus)) {
        showToast(`Cannot move from ${STATUS_LABELS[task.status]} to ${STATUS_LABELS[newStatus]}. Use sequential transitions.`, 'warning');
        return false;
    }

    const oldStatus = task.status;
    task.status = newStatus;
    task.activityLog.push({
        action: `Status changed from ${STATUS_LABELS[oldStatus]} to ${STATUS_LABELS[newStatus]}`,
        timestamp: new Date().toISOString()
    });

    saveTasks();
    renderAll();
    return true;
}

// =============================================
// OVERDUE DETECTION
// =============================================

/** Check if a task is overdue (due date < today AND not done) */
function isOverdue(task) {
    if (!task.dueDate || task.status === 'done') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate + 'T00:00:00');
    return due < today;
}

// =============================================
// FILTERING, SEARCH, SORT
// =============================================

/** Apply all active filters, search, and sort to the tasks array */
function getFilteredTasks() {
    const search = document.getElementById('searchInput').value.toLowerCase().trim();
    const statusFilter = document.getElementById('filterStatus').value;
    const priorityFilter = document.getElementById('filterPriority').value;
    const assigneeFilter = document.getElementById('filterAssignee').value;
    const sortBy = document.getElementById('sortBy').value;

    let filtered = tasks.filter(t => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
        if (assigneeFilter !== 'all' && t.assignee !== assigneeFilter) return false;
        if (search && !t.title.toLowerCase().includes(search)) return false;
        return true;
    });

    // Sort
    filtered.sort((a, b) => {
        if (sortBy === 'dueDate') {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        }
        if (sortBy === 'priority') {
            return (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
        }
        // Default: created date (newest first)
        return new Date(b.createdDate) - new Date(a.createdDate);
    });

    return filtered;
}

// =============================================
// DASHBOARD METRICS
// =============================================

function renderMetrics() {
    const total = tasks.length;
    const inProgress = tasks.filter(t => t.status === 'inprogress').length;
    const done = tasks.filter(t => t.status === 'done').length;
    const overdue = tasks.filter(t => isOverdue(t)).length;
    const highPriority = tasks.filter(t =>
        t.priority === 'high' || t.priority === 'urgent'
    ).length;
    const productivity = total > 0 ? Math.round((done / total) * 100) : 0;

    animateMetric('metricTotal', total);
    animateMetric('metricInProgress', inProgress);
    animateMetric('metricOverdue', overdue);
    animateMetric('metricDone', done);
    animateMetric('metricHigh', highPriority);
    document.getElementById('metricProductivity').textContent = productivity + '%';
}

/** Simple counter animation for metric values */
function animateMetric(elementId, targetValue) {
    const el = document.getElementById(elementId);
    const current = parseInt(el.textContent, 10) || 0;
    if (current === targetValue) return;

    const duration = 400;
    const steps = 20;
    const increment = (targetValue - current) / steps;
    let step = 0;

    const timer = setInterval(() => {
        step++;
        if (step >= steps) {
            el.textContent = targetValue;
            clearInterval(timer);
        } else {
            el.textContent = Math.round(current + increment * step);
        }
    }, duration / steps);
}

// =============================================
// RENDERING — KANBAN BOARD
// =============================================

function renderBoard() {
    const filtered = getFilteredTasks();

    STATUSES.forEach(status => {
        const list = document.getElementById('list' + capitalize(status));
        const count = document.getElementById('count' + capitalize(status));
        const statusTasks = filtered.filter(t => t.status === status);

        count.textContent = statusTasks.length;

        if (statusTasks.length === 0) {
            list.innerHTML = `
        <div class="column__empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" stroke-width="1.5"/>
            <path d="M9 12h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <p>No tasks</p>
        </div>`;
            return;
        }

        list.innerHTML = statusTasks.map(task => buildCardHTML(task)).join('');
    });

    // Re-attach drag listeners after render
    attachCardListeners();
}

/** Build HTML string for a single task card */
function buildCardHTML(task) {
    const overdue = isOverdue(task);
    const overdueClass = overdue ? ' task-card--overdue' : '';
    const avatarColor = AVATAR_COLORS[task.assignee] || '#6B7280';
    const initials = task.assignee ? task.assignee.charAt(0) : '?';
    const dueDateFormatted = task.dueDate ? formatDate(task.dueDate) : 'No date';
    const tagsHTML = task.tags.length > 0
        ? `<div class="task-card__tags">${task.tags.map(t => `<span class="task-card__tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

    // Build status select with allowed transitions
    const statusOptions = STATUSES.map(s => {
        const allowed = s === task.status || (ALLOWED_TRANSITIONS[task.status] || []).includes(s);
        return `<option value="${s}" ${s === task.status ? 'selected' : ''} ${!allowed ? 'disabled' : ''}>${STATUS_LABELS[s]}</option>`;
    }).join('');

    return `
    <div class="task-card${overdueClass}" draggable="true" data-task-id="${task.id}">
      <div class="task-card__top">
        <span class="task-card__id">${task.id}</span>
        <span class="task-card__priority task-card__priority--${task.priority}">${task.priority}</span>
      </div>
      <div class="task-card__title" data-action="detail" data-task-id="${task.id}">${escapeHtml(task.title)}</div>
      <div class="task-card__meta">
        <span class="task-card__assignee">
          <span class="task-card__avatar" style="background:${avatarColor}">${initials}</span>
          ${escapeHtml(task.assignee)}
        </span>
        <span class="task-card__due">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          ${dueDateFormatted}
        </span>
      </div>
      ${tagsHTML}
      <div class="task-card__actions">
        <select class="task-card__status-select" data-action="status" data-task-id="${task.id}">
          ${statusOptions}
        </select>
        <button class="task-card__btn" data-action="edit" data-task-id="${task.id}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
        <button class="task-card__btn task-card__btn--delete" data-action="delete" data-task-id="${task.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>`;
}

/** Capitalize status key for DOM ID lookup, e.g. "inprogress" → "InProgress" */
function capitalize(status) {
    const map = {
        backlog: 'Backlog',
        inprogress: 'InProgress',
        review: 'Review',
        done: 'Done'
    };
    return map[status] || status;
}

/** Render both metrics and board */
function renderAll() {
    renderMetrics();
    renderBoard();
}

// =============================================
// DRAG & DROP
// =============================================

function initDragAndDrop() {
    // Column drop zones
    STATUSES.forEach(status => {
        const body = document.getElementById('list' + capitalize(status));

        body.addEventListener('dragover', (e) => {
            e.preventDefault();
            body.classList.add('drag-over');
        });

        body.addEventListener('dragleave', () => {
            body.classList.remove('drag-over');
        });

        body.addEventListener('drop', (e) => {
            e.preventDefault();
            body.classList.remove('drag-over');
            if (draggedTaskId) {
                changeStatus(draggedTaskId, status);
                draggedTaskId = null;
            }
        });
    });
}

/** Attach drag start/end listeners to rendered cards */
function attachCardListeners() {
    document.querySelectorAll('.task-card[draggable]').forEach(card => {
        card.addEventListener('dragstart', (e) => {
            draggedTaskId = card.dataset.taskId;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Firefox requires setData
            e.dataTransfer.setData('text/plain', draggedTaskId);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            draggedTaskId = null;
            // Remove any lingering drag-over states
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    });
}

// =============================================
// EVENT DELEGATION — CARD ACTIONS
// =============================================

function initBoardActions() {
    const board = document.getElementById('board');

    board.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const taskId = target.dataset.taskId;

        switch (action) {
            case 'detail':
                openDetailModal(taskId);
                break;
            case 'edit':
                openEditModal(taskId);
                break;
            case 'delete':
                if (confirm('Delete this task? This cannot be undone.')) {
                    deleteTask(taskId);
                }
                break;
        }
    });

    board.addEventListener('change', (e) => {
        if (e.target.dataset.action === 'status') {
            changeStatus(e.target.dataset.taskId, e.target.value);
        }
    });
}

// =============================================
// MODAL — CREATE / EDIT TASK
// =============================================

function openCreateModal() {
    const overlay = document.getElementById('modalOverlay');
    const form = document.getElementById('taskForm');
    document.getElementById('modalTitle').textContent = 'New Task';
    document.getElementById('btnSaveTask').textContent = 'Create Task';
    document.getElementById('taskEditId').value = '';
    form.reset();
    clearValidation();
    overlay.classList.add('active');
}

function openEditModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = 'Edit Task';
    document.getElementById('btnSaveTask').textContent = 'Save Changes';
    document.getElementById('taskEditId').value = task.id;
    document.getElementById('taskTitleInput').value = task.title;
    document.getElementById('taskDescInput').value = task.description;
    document.getElementById('taskPriority').value = task.priority;
    document.getElementById('taskAssignee').value = task.assignee;
    document.getElementById('taskDueDate').value = task.dueDate;
    document.getElementById('taskEffort').value = task.effort || '';
    document.getElementById('taskTags').value = task.tags.join(', ');
    clearValidation();
    overlay.classList.add('active');
}

function closeCreateModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

/** Form validation — returns true if valid */
function validateForm() {
    let valid = true;
    const fields = [
        { id: 'taskTitleInput', errorId: 'errorTitle' },
        { id: 'taskPriority', errorId: 'errorPriority' },
        { id: 'taskAssignee', errorId: 'errorAssignee' },
        { id: 'taskDueDate', errorId: 'errorDueDate' }
    ];

    fields.forEach(({ id }) => {
        const input = document.getElementById(id);
        if (!input.value.trim()) {
            input.classList.add('error');
            valid = false;
        } else {
            input.classList.remove('error');
        }
    });

    return valid;
}

function clearValidation() {
    document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
}

function handleFormSubmit(e) {
    e.preventDefault();
    if (!validateForm()) return;

    const editId = document.getElementById('taskEditId').value;
    const formData = {
        title: document.getElementById('taskTitleInput').value,
        description: document.getElementById('taskDescInput').value,
        priority: document.getElementById('taskPriority').value,
        assignee: document.getElementById('taskAssignee').value,
        dueDate: document.getElementById('taskDueDate').value,
        effort: document.getElementById('taskEffort').value,
        tags: document.getElementById('taskTags').value
    };

    if (editId) {
        // Editing existing task
        const task = tasks.find(t => t.id === editId);
        if (task) {
            // Log changes
            const changes = [];
            if (task.title !== formData.title.trim()) changes.push('title');
            if (task.priority !== formData.priority) changes.push('priority');
            if (task.assignee !== formData.assignee) changes.push('assignee');
            if (task.dueDate !== formData.dueDate) changes.push('due date');

            task.title = formData.title.trim();
            task.description = formData.description.trim();
            task.priority = formData.priority;
            task.assignee = formData.assignee;
            task.dueDate = formData.dueDate;
            task.effort = formData.effort ? parseFloat(formData.effort) : null;
            task.tags = formData.tags
                ? formData.tags.split(',').map(t => t.trim()).filter(Boolean)
                : [];

            if (changes.length > 0) {
                task.activityLog.push({
                    action: `Updated: ${changes.join(', ')}`,
                    timestamp: new Date().toISOString()
                });
            }

            saveTasks();
            showToast('Task updated successfully!', 'success');
        }
    } else {
        // Creating new task
        const newTask = createTask(formData);
        tasks.push(newTask);
        saveTasks();
        showToast('Task created successfully!', 'success');
    }

    closeCreateModal();
    renderAll();
}

// =============================================
// MODAL — TASK DETAIL & ACTIVITY LOG
// =============================================

function openDetailModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const overlay = document.getElementById('detailOverlay');
    document.getElementById('detailTitle').textContent = `${task.id} — ${escapeHtml(task.title)}`;

    const avatarColor = AVATAR_COLORS[task.assignee] || '#6B7280';
    const activityHTML = task.activityLog
        .slice()
        .reverse()
        .map(log => `
      <li class="activity-log__item">
        <span class="activity-log__dot"></span>
        <span class="activity-log__text">${escapeHtml(log.action)}</span>
        <span class="activity-log__time">${formatDateTime(log.timestamp)}</span>
      </li>
    `).join('');

    document.getElementById('detailBody').innerHTML = `
    <div class="detail-section">
      <h3 class="detail-section__title">Details</h3>
      <div class="detail-grid">
        <div class="detail-field">
          <span class="detail-field__label">Status</span>
          <span class="detail-field__value">
            <span class="task-card__priority task-card__priority--${statusToPriorityColor(task.status)}">${STATUS_LABELS[task.status]}</span>
          </span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Priority</span>
          <span class="detail-field__value">
            <span class="task-card__priority task-card__priority--${task.priority}">${task.priority}</span>
          </span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Assignee</span>
          <span class="detail-field__value" style="display:flex;align-items:center;gap:6px;">
            <span class="task-card__avatar" style="background:${avatarColor}">${task.assignee.charAt(0)}</span>
            ${escapeHtml(task.assignee)}
          </span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Due Date</span>
          <span class="detail-field__value${isOverdue(task) ? ' task-card__due' : ''}" style="${isOverdue(task) ? 'color:var(--overdue);font-weight:600;' : ''}">
            ${task.dueDate ? formatDate(task.dueDate) : '—'}
            ${isOverdue(task) ? ' ⚠ Overdue' : ''}
          </span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Created</span>
          <span class="detail-field__value">${formatDateTime(task.createdDate)}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Effort</span>
          <span class="detail-field__value">${task.effort ? task.effort + 'h' : '—'}</span>
        </div>
      </div>
    </div>
    ${task.description ? `
    <div class="detail-section">
      <h3 class="detail-section__title">Description</h3>
      <div class="detail-description">${escapeHtml(task.description)}</div>
    </div>` : ''}
    ${task.tags.length > 0 ? `
    <div class="detail-section">
      <h3 class="detail-section__title">Tags</h3>
      <div class="task-card__tags">${task.tags.map(t => `<span class="task-card__tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>` : ''}
    <div class="detail-section">
      <h3 class="detail-section__title">Activity Log</h3>
      <ul class="activity-log">${activityHTML}</ul>
    </div>
    <div class="detail-actions">
      <button class="btn btn--ghost btn--small" onclick="openEditModal('${task.id}'); closeDetailModal();">Edit Task</button>
      <button class="btn btn--danger btn--small" onclick="if(confirm('Delete this task?')){deleteTask('${task.id}'); closeDetailModal();}">Delete</button>
    </div>
  `;

    overlay.classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detailOverlay').classList.remove('active');
}

/** Map status to a color class for display in detail view */
function statusToPriorityColor(status) {
    const map = {
        backlog: 'low',
        inprogress: 'medium',
        review: 'high',
        done: 'medium'
    };
    return map[status] || 'low';
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================

function showToast(message, type = 'info') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#10B981' : type === 'warning' ? '#F59E0B' : '#6C5CE7'};
    color: #fff;
    border-radius: 8px;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    z-index: 2000;
    animation: fadeInUp 300ms ease forwards;
    cursor: pointer;
  `;
    document.body.appendChild(toast);

    toast.addEventListener('click', () => toast.remove());
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 300ms ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

/** Format ISO date to short display, e.g. "Feb 26" */
function formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
}

/** Format ISO datetime to readable string */
function formatDateTime(isoStr) {
    const date = new Date(isoStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hours = date.getHours();
    const mins = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${h}:${mins} ${ampm}`;
}

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/** Set today's date in the topbar */
function setCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', options);
}

// =============================================
// SEED DATA — Populate with sample tasks if empty
// =============================================

function seedSampleTasks() {
    if (tasks.length > 0) return;

    const today = new Date();
    const dayMs = 86400000;

    const sampleTasks = [
        {
            title: 'Design new dashboard layout',
            description: 'Create wireframes and high-fidelity mockups for the updated dashboard. Include mobile and desktop responsive views.',
            status: 'inprogress',
            priority: 'high',
            assignee: 'Alex',
            dueDate: formatDateForInput(new Date(today.getTime() + 2 * dayMs)),
            effort: 8,
            tags: ['design', 'ui', 'dashboard']
        },
        {
            title: 'Implement user authentication API',
            description: 'Build REST endpoints for login, register, password reset, and token refresh using JWT.',
            status: 'review',
            priority: 'urgent',
            assignee: 'Sam',
            dueDate: formatDateForInput(new Date(today.getTime() + 1 * dayMs)),
            effort: 16,
            tags: ['backend', 'auth', 'api']
        },
        {
            title: 'Write onboarding documentation',
            description: 'Create developer onboarding guide covering setup, architecture overview, and contribution guidelines.',
            status: 'backlog',
            priority: 'medium',
            assignee: 'Jordan',
            dueDate: formatDateForInput(new Date(today.getTime() + 7 * dayMs)),
            effort: 6,
            tags: ['docs']
        },
        {
            title: 'Fix payment webhook handler',
            description: 'The Stripe webhook for subscription renewals is failing intermittently. Investigate and fix the idempotency logic.',
            status: 'inprogress',
            priority: 'urgent',
            assignee: 'Taylor',
            dueDate: formatDateForInput(new Date(today.getTime() - 1 * dayMs)),
            effort: 4,
            tags: ['backend', 'payments', 'bug']
        },
        {
            title: 'Set up CI/CD pipeline',
            description: 'Configure GitHub Actions with lint, test, build, and deploy stages for staging and production.',
            status: 'backlog',
            priority: 'high',
            assignee: 'Sam',
            dueDate: formatDateForInput(new Date(today.getTime() + 5 * dayMs)),
            effort: 10,
            tags: ['devops', 'infrastructure']
        },
        {
            title: 'Refactor notification service',
            description: 'Decouple the notification service from the main application. Support email, SMS, and push channels.',
            status: 'backlog',
            priority: 'low',
            assignee: 'Alex',
            dueDate: formatDateForInput(new Date(today.getTime() + 14 * dayMs)),
            effort: 12,
            tags: ['backend', 'refactor']
        },
        {
            title: 'Add dark mode support',
            description: 'Implement dark mode toggle with CSS custom properties. Persist preference in localStorage.',
            status: 'done',
            priority: 'medium',
            assignee: 'Jordan',
            dueDate: formatDateForInput(new Date(today.getTime() - 3 * dayMs)),
            effort: 5,
            tags: ['frontend', 'ui']
        },
        {
            title: 'Performance audit and optimization',
            description: 'Run Lighthouse audit. Optimize images, lazy load below-the-fold content, and reduce bundle size.',
            status: 'review',
            priority: 'medium',
            assignee: 'Taylor',
            dueDate: formatDateForInput(new Date(today.getTime() + 3 * dayMs)),
            effort: 8,
            tags: ['performance', 'frontend']
        }
    ];

    sampleTasks.forEach(data => {
        const now = new Date().toISOString();
        const task = {
            id: generateId(),
            title: data.title,
            description: data.description,
            status: data.status,
            priority: data.priority,
            assignee: data.assignee,
            dueDate: data.dueDate,
            createdDate: now,
            effort: data.effort,
            tags: data.tags,
            activityLog: [{ action: 'Task created', timestamp: now }]
        };

        // If not backlog, add status-change log entries
        const statusPath = STATUSES.slice(0, STATUSES.indexOf(data.status) + 1);
        for (let i = 1; i < statusPath.length; i++) {
            task.activityLog.push({
                action: `Status changed from ${STATUS_LABELS[statusPath[i - 1]]} to ${STATUS_LABELS[statusPath[i]]}`,
                timestamp: new Date(Date.now() - (statusPath.length - i) * 3600000).toISOString()
            });
        }

        tasks.push(task);
    });

    saveTasks();
}

/** Format a Date object to YYYY-MM-DD for input[type=date] */
function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

// =============================================
// INITIALIZATION
// =============================================

function init() {
    setCurrentDate();
    seedSampleTasks();

    // --- Event listeners ---

    // New Task button
    document.getElementById('btnNewTask').addEventListener('click', openCreateModal);

    // Modal close buttons
    document.getElementById('btnCloseModal').addEventListener('click', closeCreateModal);
    document.getElementById('btnCancelModal').addEventListener('click', closeCreateModal);
    document.getElementById('btnCloseDetail').addEventListener('click', closeDetailModal);

    // Close modal on overlay click
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeCreateModal();
    });
    document.getElementById('detailOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDetailModal();
    });

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCreateModal();
            closeDetailModal();
        }
    });

    // Form submit
    document.getElementById('taskForm').addEventListener('submit', handleFormSubmit);

    // Filters & search
    document.getElementById('searchInput').addEventListener('input', renderBoard);
    document.getElementById('filterStatus').addEventListener('change', renderBoard);
    document.getElementById('filterPriority').addEventListener('change', renderBoard);
    document.getElementById('filterAssignee').addEventListener('change', renderBoard);
    document.getElementById('sortBy').addEventListener('change', renderBoard);

    // Initialize drag-and-drop zones
    initDragAndDrop();

    // Board card actions via delegation
    initBoardActions();

    // Initial render
    renderAll();
}

// Boot up
document.addEventListener('DOMContentLoaded', init);