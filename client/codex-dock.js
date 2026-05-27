import { DialogScreenshotController } from './dialog-screenshots.js';
import { collectSelection, findInspectableElement, isPluginNode } from './dom.js';
import { clamp, el, sourceReferenceLabel } from './dialog-utils.js';

const DOCK_STATE_KEY = 'code-intent-inspector:codex-dock-state';
const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 620;
const MIN_WIDTH = 560;
const MIN_HEIGHT = 420;
const DEFAULT_VISIBLE_SESSIONS_PER_PROJECT = 5;
const DOCK_MODES = [
    { value: 'build', label: 'Build', title: 'Let Codex edit the project' },
    { value: 'plan', label: 'Plan', title: 'Ask Codex for a plan before edits' },
];

function normalizeModelOptions(config) {
    const models = Array.isArray(config?.codexDock?.models) ? config.codexDock.models : [];
    const normalized = models
        .map((entry) => {
        const label = String(entry?.label ?? entry?.value ?? '').trim();
        const value = String(entry?.value ?? '').trim();
        return label ? { label, value } : null;
    })
        .filter(Boolean);

    return normalized.length ? normalized : [{ label: 'Default', value: '' }];
}

function displayReferenceLabel(label) {
    return String(label || '').replace(/^@/, '');
}

function readDockState() {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(DOCK_STATE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}

function writeDockState(state) {
    try {
        window.localStorage.setItem(DOCK_STATE_KEY, JSON.stringify(state));
    }
    catch {
        // Dock state is a convenience; interaction still works without storage.
    }
}

function formatRelativeTime(value) {
    if (!value)
        return '';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time))
        return '';
    const diff = Math.max(0, Date.now() - time);
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1)
        return 'now';
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

function messageText(value) {
    if (typeof value === 'string')
        return value;
    if (value == null)
        return '';
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}

function normalizeDockMode(value) {
    return value === 'plan' ? 'plan' : 'build';
}

function maxDockWidth() {
    return Math.max(MIN_WIDTH, window.innerWidth - 16);
}

function maxDockHeight() {
    return Math.max(MIN_HEIGHT, window.innerHeight - 16);
}

function formatMetricRate(metrics) {
    const value = Number(metrics?.tokensPerSecond);
    if (!Number.isFinite(value) || value <= 0)
        return '0 tokens/s';
    const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value));
    return `${rounded} tokens/s`;
}

function formatContextUsage(metrics) {
    const percent = Number(metrics?.contextPercent);
    if (Number.isFinite(percent))
        return `${Math.max(0, Math.min(100, Math.round(percent)))}% used`;
    const text = typeof metrics?.contextText === 'string' ? metrics.contextText.trim() : '';
    return text || '-- used';
}

function formatSessionCount(count) {
    if (!count)
        return '';
    return count > 99 ? '99+' : String(count);
}

function basenameFromPath(value) {
    const normalized = String(value || '').replace(/[\\/]+$/g, '');
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || 'Project';
}

function groupSessionsByProject(sessions) {
    const groups = new Map();
    for (const session of sessions) {
        const cwd = typeof session?.cwd === 'string' && session.cwd.trim()
            ? session.cwd.trim()
            : 'Unknown project';
        if (!groups.has(cwd)) {
            groups.set(cwd, {
                key: cwd,
                label: basenameFromPath(cwd),
                sessions: [],
            });
        }
        groups.get(cwd).sessions.push(session);
    }
    return [...groups.values()];
}

export class CodexDock {
    parent;
    config;
    api;
    overlay;
    dockEl = null;
    textarea = null;
    sessionListEl = null;
    messageListEl = null;
    referencesEl = null;
    statusEl = null;
    environmentEl = null;
    sendButton = null;
    refreshButton = null;
    modelSelect = null;
    state;
    models;
    sessions = [];
    sessionProjectRoots = [];
    expandedSessionGroups = new Set();
    messages = [];
    references = [];
    currentThreadId = null;
    isNewThread = true;
    selectedElement = null;
    busy = false;
    draft = '';
    metrics = {};
    screenshots;

    constructor(parent, config, api, overlay) {
        this.parent = parent;
        this.config = config;
        this.api = api;
        this.overlay = overlay;
        this.models = normalizeModelOptions(config);
        const stored = readDockState();
        this.state = {
            collapsed: stored.collapsed !== false,
            x: typeof stored.x === 'number' ? stored.x : null,
            y: typeof stored.y === 'number' ? stored.y : null,
            width: clamp(Number(stored.width) || DEFAULT_WIDTH, MIN_WIDTH, maxDockWidth()),
            height: clamp(Number(stored.height) || DEFAULT_HEIGHT, MIN_HEIGHT, maxDockHeight()),
            sidebarCollapsed: stored.sidebarCollapsed === true,
            threadId: typeof stored.threadId === 'string' ? stored.threadId : null,
            model: typeof stored.model === 'string' ? stored.model : this.models[0]?.value ?? '',
            mode: normalizeDockMode(stored.mode),
        };
        if (!this.models.some((model) => model.value === this.state.model)) {
            this.state.model = this.models[0]?.value ?? '';
        }
        this.currentThreadId = this.state.threadId;
        this.isNewThread = !this.currentThreadId;
        this.screenshots = new DialogScreenshotController({
            selectedElement: () => this.selectedElement ?? document.body,
            backdrop: () => this.dockEl,
            reposition: () => this.positionDock(),
            showError: (text) => this.showError(text),
            onChange: () => this.updateEnvironmentPanel(),
        });
    }

    start() {
        this.screenshots.reset(false);
        this.render();
        void this.loadSessions();
    }

    persistState() {
        writeDockState({
            collapsed: this.state.collapsed,
            x: this.state.x,
            y: this.state.y,
            width: this.state.width,
            height: this.state.height,
            sidebarCollapsed: this.state.sidebarCollapsed,
            threadId: this.currentThreadId,
            model: this.state.model,
            mode: this.state.mode,
        });
    }

    render() {
        if (this.textarea)
            this.draft = this.textarea.value;
        if (this.dockEl)
            this.dockEl.remove();

        const dock = el('section', `cii-codex-dock${this.state.collapsed ? ' cii-codex-dock-collapsed' : ''}`);
        dock.setAttribute('aria-label', 'Codex dock');
        dock.addEventListener('mousedown', (event) => {
            this.screenshots.closeMenuFromOutside(event.target);
        }, true);

        if (this.state.collapsed) {
            const button = el('button', 'cii-codex-orb', 'C');
            button.type = 'button';
            button.title = 'Codex';
            button.addEventListener('click', () => this.expand());
            button.addEventListener('mousedown', (event) => this.startDrag(event));
            dock.append(button);
        }
        else {
            dock.style.width = `${this.state.width}px`;
            dock.style.height = `${this.state.height}px`;
            dock.append(this.renderShell());
        }

        this.parent.append(dock);
        this.dockEl = dock;
        this.positionDock();
    }

    renderShell() {
        const shell = el('div', 'cii-codex-shell');
        const header = el('header', 'cii-codex-header');
        header.addEventListener('mousedown', (event) => {
            if (event.target instanceof HTMLElement && event.target.closest('button, textarea, input, select'))
                return;
            this.startDrag(event);
        });

        const title = el('div', 'cii-codex-title');
        title.append(el('strong', undefined, 'Codex'), el('span', undefined, this.currentSessionTitle()));
        const controls = el('div', 'cii-codex-controls');
        this.refreshButton = el('button', 'cii-codex-icon-btn', '↻');
        this.refreshButton.type = 'button';
        this.refreshButton.title = 'Refresh sessions';
        this.refreshButton.addEventListener('click', () => void this.loadSessions());
        const collapse = el('button', 'cii-codex-icon-btn', '−');
        collapse.type = 'button';
        collapse.title = 'Collapse';
        collapse.addEventListener('click', () => this.collapse());
        controls.append(this.refreshButton, collapse);
        header.append(title, controls);

        const main = el('div', `cii-codex-main${this.state.sidebarCollapsed ? ' cii-codex-main-sidebar-collapsed' : ''}`);
        main.append(this.renderSidebar(), this.renderChat());
        shell.append(header, main, ...this.renderResizeHandles());
        return shell;
    }

    renderSidebar() {
        const sidebar = el('aside', `cii-codex-sidebar${this.state.sidebarCollapsed ? ' cii-codex-sidebar-collapsed' : ''}`);
        if (this.state.sidebarCollapsed) {
            this.sessionListEl = null;
            const newChat = el('button', 'cii-codex-sidebar-rail-btn', '+');
            newChat.type = 'button';
            newChat.title = 'New chat';
            newChat.addEventListener('click', () => this.startNewChat());
            const expand = el('button', 'cii-codex-sidebar-rail-btn', '›');
            expand.type = 'button';
            expand.title = this.sessions.length ? `Show ${this.sessions.length} sessions` : 'Show sessions';
            const count = formatSessionCount(this.sessions.length);
            if (count)
                expand.append(el('span', 'cii-codex-rail-badge', count));
            expand.addEventListener('click', () => this.toggleSidebar(false));
            const refresh = el('button', 'cii-codex-sidebar-rail-btn', '↻');
            refresh.type = 'button';
            refresh.title = 'Refresh sessions';
            refresh.addEventListener('click', () => void this.loadSessions());
            sidebar.append(newChat, expand, refresh);
            return sidebar;
        }

        const toolbar = el('div', 'cii-codex-sidebar-toolbar');
        const newChat = el('button', 'cii-codex-new-chat', '+ New chat');
        newChat.type = 'button';
        newChat.addEventListener('click', () => this.startNewChat());
        const toggle = el('button', 'cii-codex-sidebar-toggle', '‹');
        toggle.type = 'button';
        toggle.title = 'Hide sessions';
        toggle.addEventListener('click', () => this.toggleSidebar(true));
        toolbar.append(newChat, toggle);
        const heading = el('div', 'cii-codex-sidebar-heading', 'Projects');
        this.sessionListEl = el('div', 'cii-codex-session-list');
        sidebar.append(toolbar, heading, this.sessionListEl);
        this.renderSessions();
        return sidebar;
    }

    renderResizeHandles() {
        return ['left', 'right', 'bottom', 'bottom-left', 'bottom-right'].map((edge) => {
            const handle = el('div', `cii-codex-resize cii-codex-resize-${edge}`);
            handle.addEventListener('mousedown', (event) => this.startResize(event, edge));
            return handle;
        });
    }

    renderChat() {
        const chat = el('div', 'cii-codex-chat');
        this.environmentEl = this.renderEnvironmentPanel();
        this.messageListEl = el('div', 'cii-codex-messages');
        this.statusEl = el('div', 'cii-codex-status');

        const screenshotPreview = el('div', 'cii-screenshot-preview cii-codex-shot-preview');
        this.screenshots.attachPreview(screenshotPreview);

        const composer = el('form', 'cii-codex-composer');
        composer.addEventListener('submit', (event) => {
            event.preventDefault();
            void this.send();
        });
        const attachmentTray = el('div', 'cii-codex-attachments');
        this.referencesEl = el('div', 'cii-codex-ref-row');
        attachmentTray.append(screenshotPreview, this.referencesEl);
        this.textarea = el('textarea', 'cii-codex-textarea');
        this.textarea.value = this.draft;
        this.textarea.placeholder = this.state.mode === 'plan'
            ? 'Ask Codex to plan the change'
            : 'Ask Codex to change this project';
        this.textarea.addEventListener('input', () => {
            this.draft = this.textarea?.value ?? '';
        });
        this.textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                void this.send();
            }
        });

        const footer = el('div', 'cii-codex-composer-footer');
        const leftTools = el('div', 'cii-codex-tool-row');
        leftTools.append(this.screenshots.renderPicker(), this.renderModeToggle(), this.renderModelSelect());
        this.sendButton = el('button', 'cii-codex-send', '↑');
        this.sendButton.type = 'submit';
        this.sendButton.title = 'Send';
        footer.append(leftTools, this.sendButton);
        composer.append(attachmentTray, this.textarea, footer);

        chat.append(this.environmentEl, this.messageListEl, this.statusEl, composer);
        this.renderMessages();
        this.renderReferences();
        return chat;
    }

    renderEnvironmentPanel() {
        const panel = el('section', 'cii-codex-env-panel');
        const header = el('div', 'cii-codex-env-header');
        header.append(el('span', undefined, 'Environment'), el('span', 'cii-codex-env-dot', this.busy ? 'Running' : 'Ready'));

        const rows = el('div', 'cii-codex-env-rows');
        rows.append(this.renderEnvironmentRow('Mode', this.state.mode === 'plan' ? 'Plan first' : 'Agent edit'));
        rows.append(this.renderEnvironmentRow('Model', this.currentModelLabel()));
        rows.append(this.renderEnvironmentRow('Session', this.currentThreadId ? 'Continue thread' : 'New thread'));
        rows.append(this.renderEnvironmentRow('Sources', this.environmentSourcesLabel()));

        const meter = el('div', 'cii-codex-env-meter');
        meter.append(el('span', undefined, formatMetricRate(this.metrics)), el('span', undefined, formatContextUsage(this.metrics)));
        panel.append(header, rows, meter);
        return panel;
    }

    renderEnvironmentRow(label, value) {
        const row = el('div', 'cii-codex-env-row');
        row.append(el('span', 'cii-codex-env-label', label), el('span', 'cii-codex-env-value', value));
        return row;
    }

    updateEnvironmentPanel() {
        if (!this.environmentEl)
            return;
        const next = this.renderEnvironmentPanel();
        this.environmentEl.replaceWith(next);
        this.environmentEl = next;
    }

    environmentSourcesLabel() {
        const pieces = [];
        if (this.references.length)
            pieces.push(`${this.references.length} code`);
        if (this.screenshots.choices.size)
            pieces.push(`${this.screenshots.choices.size} screenshot`);
        return pieces.length ? pieces.join(', ') : 'Page context';
    }

    currentModelLabel() {
        const model = this.models.find((item) => item.value === this.state.model);
        return model?.label || 'Default';
    }

    renderModeToggle() {
        const group = el('div', 'cii-codex-mode-toggle');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Codex mode');
        for (const mode of DOCK_MODES) {
            const button = el('button', `cii-codex-mode-option${this.state.mode === mode.value ? ' cii-codex-mode-option-active' : ''}`, mode.label);
            button.type = 'button';
            button.title = mode.title;
            button.addEventListener('click', () => {
                this.state.mode = mode.value;
                this.persistState();
                this.render();
                this.focusComposer();
            });
            group.append(button);
        }
        return group;
    }

    renderModelSelect() {
        const wrapper = el('label', 'cii-codex-model');
        const marker = el('span', 'cii-codex-model-icon', '⚡');
        this.modelSelect = document.createElement('select');
        this.modelSelect.setAttribute('aria-label', 'Model');
        for (const model of this.models) {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.label;
            option.selected = model.value === this.state.model;
            this.modelSelect.append(option);
        }
        this.modelSelect.addEventListener('change', () => {
            this.state.model = this.modelSelect?.value ?? '';
            this.persistState();
            this.updateEnvironmentPanel();
        });
        wrapper.append(marker, this.modelSelect);
        return wrapper;
    }

    positionDock() {
        if (!this.dockEl)
            return;
        if (!this.state.collapsed) {
            this.state.width = clamp(this.state.width, MIN_WIDTH, maxDockWidth());
            this.state.height = clamp(this.state.height, MIN_HEIGHT, maxDockHeight());
            this.dockEl.style.width = `${this.state.width}px`;
            this.dockEl.style.height = `${this.state.height}px`;
        }
        const width = this.state.collapsed ? 56 : this.state.width;
        const height = this.state.collapsed ? 56 : this.state.height;
        const margin = 16;
        const defaultX = window.innerWidth - width - margin;
        const defaultY = window.innerHeight - height - margin;
        const minX = margin;
        const minY = margin;
        const maxX = Math.max(minX, window.innerWidth - width - margin);
        const maxY = Math.max(minY, window.innerHeight - height - margin);
        const x = clamp(this.state.x ?? defaultX, minX, maxX);
        const y = clamp(this.state.y ?? defaultY, minY, maxY);
        this.state.x = x;
        this.state.y = y;
        this.dockEl.style.left = `${x}px`;
        this.dockEl.style.top = `${y}px`;
    }

    startDrag(event) {
        if (event.button !== 0)
            return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const baseX = this.state.x ?? 0;
        const baseY = this.state.y ?? 0;
        const move = (moveEvent) => {
            this.state.x = baseX + moveEvent.clientX - startX;
            this.state.y = baseY + moveEvent.clientY - startY;
            this.positionDock();
        };
        const up = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            this.persistState();
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    }

    startResize(event, edge) {
        if (event.button !== 0)
            return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = this.state.width;
        const startLeft = this.state.x ?? 0;
        const startY = event.clientY;
        const startHeight = this.state.height;
        const startRight = startLeft + startWidth;
        const move = (moveEvent) => {
            if (edge.includes('left')) {
                this.state.width = clamp(startWidth + startX - moveEvent.clientX, MIN_WIDTH, maxDockWidth());
                this.state.x = startRight - this.state.width;
            }
            if (edge.includes('right')) {
                this.state.width = clamp(startWidth + moveEvent.clientX - startX, MIN_WIDTH, maxDockWidth());
            }
            if (edge.includes('bottom')) {
                this.state.height = clamp(startHeight + moveEvent.clientY - startY, MIN_HEIGHT, maxDockHeight());
            }
            this.positionDock();
        };
        const up = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            this.persistState();
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    }

    toggleSidebar(collapsed) {
        this.state.sidebarCollapsed = collapsed;
        this.persistState();
        this.render();
        this.screenshots.updatePicker();
    }

    expand() {
        if (!this.state.collapsed)
            return;
        this.state.collapsed = false;
        this.persistState();
        this.render();
    }

    collapse() {
        this.state.collapsed = true;
        this.persistState();
        this.render();
    }

    async loadSessions() {
        if (!this.config.codexDock?.enabled)
            return;
        this.setStatus('Loading sessions');
        if (this.refreshButton)
            this.refreshButton.disabled = true;
        try {
            const res = await this.api.codexSessions(this.config.codexDock.days);
            if (!res.ok)
                throw new Error(res.error ?? 'Failed to load Codex sessions');
            this.sessions = Array.isArray(res.sessions) ? res.sessions : [];
            this.sessionProjectRoots = Array.isArray(res.projectRoots) ? res.projectRoots : [];
            if (this.currentThreadId && !this.sessions.some((session) => session.id === this.currentThreadId)) {
                this.currentThreadId = null;
                this.isNewThread = true;
                this.persistState();
            }
            this.render();
            this.setStatus(this.sessions.length ? '' : 'No recent project sessions');
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : String(err));
        }
        finally {
            if (this.refreshButton)
                this.refreshButton.disabled = false;
        }
    }

    currentSessionTitle() {
        if (!this.currentThreadId)
            return 'New chat';
        const session = this.sessions.find((item) => item.id === this.currentThreadId);
        return session?.title ? `Continue: ${session.title}` : 'Continue session';
    }

    renderSessions() {
        if (!this.sessionListEl)
            return;
        this.sessionListEl.innerHTML = '';
        if (!this.sessions.length) {
            const empty = el('div', 'cii-codex-session-empty', 'No recent project sessions');
            if (this.sessionProjectRoots.length) {
                const detail = el('span', 'cii-codex-session-empty-detail', `Checked ${this.sessionProjectRoots[0]}`);
                empty.append(detail);
            }
            this.sessionListEl.append(empty);
            return;
        }
        const groups = groupSessionsByProject(this.sessions);
        groups.forEach((group, groupIndex) => {
            const section = el('section', 'cii-codex-project-group');
            const heading = el('div', 'cii-codex-project-heading');
            heading.title = group.key;
            heading.append(el('span', 'cii-codex-project-icon'), el('span', 'cii-codex-project-name', group.label));
            section.append(heading);

            const expanded = this.expandedSessionGroups.has(group.key);
            const visibleSessions = expanded
                ? group.sessions
                : group.sessions.slice(0, DEFAULT_VISIBLE_SESSIONS_PER_PROJECT);

            visibleSessions.forEach((session, index) => {
                const button = el('button', 'cii-codex-session');
                button.type = 'button';
                const active = session.id === this.currentThreadId;
                button.classList.toggle('cii-codex-session-active', active);
                if (active)
                    button.setAttribute('aria-current', 'true');
                const title = el('span', 'cii-codex-session-title', session.title || 'Untitled session');
                const shortcut = groupIndex === 0 && index < DEFAULT_VISIBLE_SESSIONS_PER_PROJECT
                    ? `⌘${index + 1}`
                    : '';
                const meta = el('span', shortcut ? 'cii-codex-session-shortcut' : 'cii-codex-session-meta', shortcut || formatRelativeTime(session.updatedAt));
                button.append(title, meta);
                button.addEventListener('click', () => void this.selectSession(session));
                section.append(button);
            });

            if (group.sessions.length > DEFAULT_VISIBLE_SESSIONS_PER_PROJECT) {
                const showMore = el('button', 'cii-codex-session-more', expanded ? 'Show less' : 'Show more');
                showMore.type = 'button';
                showMore.addEventListener('click', () => {
                    if (expanded)
                        this.expandedSessionGroups.delete(group.key);
                    else
                        this.expandedSessionGroups.add(group.key);
                    this.renderSessions();
                });
                section.append(showMore);
            }

            this.sessionListEl.append(section);
        });
    }

    async selectSession(session) {
        this.currentThreadId = session.id;
        this.isNewThread = false;
        this.references = [];
        this.selectedElement = null;
        this.screenshots.reset(false);
        this.messages = [{ type: 'status', text: `Loading ${session.title || session.id}` }];
        this.persistState();
        this.render();
        this.setStatus('Loading session history');

        try {
            const res = await this.api.codexSession(session.id, this.config.codexDock?.days);
            if (this.currentThreadId !== session.id)
                return;
            if (!res.ok)
                throw new Error(res.error ?? 'Failed to load Codex session');
            if (res.session?.id) {
                this.sessions = this.sessions.map((item) => item.id === res.session.id ? res.session : item);
            }
            const messages = Array.isArray(res.messages) ? res.messages : [];
            this.messages = messages.length
                ? messages
                : [{ type: 'status', text: 'No messages found in this session' }];
            this.render();
            this.setStatus('');
        }
        catch (err) {
            if (this.currentThreadId !== session.id)
                return;
            this.messages = [{ type: 'failed', text: err instanceof Error ? err.message : String(err) }];
            this.renderMessages();
            this.setStatus('');
        }
    }

    startNewChat() {
        this.currentThreadId = null;
        this.isNewThread = true;
        this.messages = [];
        this.references = [];
        this.selectedElement = null;
        this.draft = '';
        this.screenshots.reset(false);
        if (this.textarea)
            this.textarea.value = '';
        this.persistState();
        this.render();
        this.screenshots.updatePicker();
        this.setStatus('');
    }

    previewTarget(target) {
        if (this.state.collapsed || isPluginNode(target)) {
            this.overlay.hide();
            return;
        }
        const inspectable = findInspectableElement(target);
        if (inspectable) {
            this.overlay.showFor(inspectable);
            return;
        }
        if (target instanceof HTMLElement)
            this.overlay.showNoMapping(target);
        else
            this.overlay.hide();
    }

    async addCodeReferenceFromTarget(target) {
        if (isPluginNode(target))
            return false;
        const inspectable = findInspectableElement(target);
        if (!inspectable) {
            if (target instanceof HTMLElement)
                this.overlay.showNoMapping(target);
            return true;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
        this.overlay.hide();
        await this.addCodeReference(selection, inspectable);
        return true;
    }

    async addCodeReference(selection, selectedElement) {
        if (!selection?.inspPath)
            return;
        this.expand();
        const existing = this.references.find((item) => item.selection?.inspPath === selection.inspPath);
        if (existing) {
            this.focusComposer();
            return;
        }

        let label = sourceReferenceLabel(selection, this.references.length);
        try {
            const res = await this.api.resolve({
                pageUrl: location.href,
                intent: '',
                agent: 'codex-sdk',
                applyMode: this.state.mode === 'plan' ? 'prompt-only' : 'agent-edit',
                planMode: this.state.mode === 'plan',
                resume: true,
                selection,
            });
            if (res.ok && typeof res.reference === 'string')
                label = res.reference;
            else if (!res.ok)
                throw new Error(res.error ?? 'Failed to resolve source reference');
        }
        catch (err) {
            this.showError(err instanceof Error ? err.message : String(err));
            return;
        }

        this.references = [...this.references, { label, selection }];
        this.selectedElement = selectedElement;
        this.screenshots.clearCaptures();
        this.screenshots.updatePicker();
        this.renderReferences();
        this.updateEnvironmentPanel();
        void this.screenshots.captureSelected();
        this.focusComposer();
    }

    renderReferences() {
        if (!this.referencesEl)
            return;
        this.referencesEl.innerHTML = '';
        this.referencesEl.hidden = this.references.length === 0;
        for (const item of this.references) {
            this.referencesEl.append(this.renderReferenceChip(item));
        }
    }

    renderReferenceChip(item, options = {}) {
        const chip = el('span', `cii-codex-ref-chip${options.static ? ' cii-codex-ref-chip-static' : ''}`);
        const icon = el('span', 'cii-codex-ref-icon');
        const text = el('span', 'cii-codex-ref-text', displayReferenceLabel(item.label));
        chip.append(icon, text);
        if (!options.static) {
            const remove = el('button', 'cii-codex-ref-remove', '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove ${displayReferenceLabel(item.label)}`);
            remove.addEventListener('click', () => {
                this.references = this.references.filter((ref) => ref !== item);
                this.renderReferences();
                this.updateEnvironmentPanel();
            });
            chip.append(remove);
        }
        return chip;
    }

    payloadReferences() {
        return this.references.map((item) => item.selection);
    }

    async buildPayload() {
        const screenshots = await this.screenshots.buildPayloadScreenshots();
        const payload = {
            pageUrl: location.href,
            intent: this.textarea?.value ?? '',
            applyMode: this.state.mode === 'plan' ? 'prompt-only' : 'agent-edit',
            planMode: this.state.mode === 'plan',
            references: this.payloadReferences(),
            threadId: this.currentThreadId || undefined,
            newThread: this.isNewThread,
            resume: !this.isNewThread,
            model: this.state.model || undefined,
        };
        if (screenshots)
            payload.screenshots = screenshots;
        return payload;
    }

    async send() {
        if (this.busy)
            return;
        const intent = (this.textarea?.value ?? '').trim();
        const hasRefs = this.payloadReferences().length > 0;
        const hasScreenshots = this.screenshots.choices.size > 0;
        if (!intent && !hasRefs && !hasScreenshots) {
            this.setStatus('Type a message or add a code reference');
            return;
        }

        this.setBusy(true);
        try {
            const payload = await this.buildPayload();
            this.messages = [
                ...this.messages,
                {
                    type: 'user',
                    text: intent || '(attachments)',
                    references: this.references.map((item) => ({ label: item.label })),
                    screenshots: payload.screenshots ?? [],
                },
            ];
            this.renderMessages();
            const result = await this.api.codexTurn(payload);
            if (result.metrics)
                this.metrics = result.metrics;
            if (result.threadId) {
                this.currentThreadId = result.threadId;
                this.isNewThread = false;
                this.persistState();
            }
            this.appendResult(result);
            if (result.ok) {
                this.draft = '';
                if (this.textarea)
                    this.textarea.value = '';
                this.references = [];
                this.renderReferences();
                void this.loadSessions();
            }
        }
        catch (err) {
            this.messages = [...this.messages, { type: 'failed', text: err instanceof Error ? err.message : String(err) }];
            this.renderMessages();
        }
        finally {
            this.setBusy(false);
        }
    }

    appendResult(result) {
        const next = [];
        if (Array.isArray(result.events)) {
            for (const event of result.events) {
                const text = messageText(event.text);
                if (!text)
                    continue;
                next.push({ type: event.type || 'message', text });
            }
        }
        if (result.output && !next.some((item) => item.text === result.output)) {
            next.push({ type: 'assistant', text: result.output });
        }
        if (!result.ok) {
            next.push({ type: 'failed', text: result.error ?? 'Codex turn failed' });
        }
        this.messages = [...this.messages, ...next];
        this.renderMessages();
        this.updateEnvironmentPanel();
    }

    renderMessages() {
        if (!this.messageListEl)
            return;
        this.messageListEl.innerHTML = '';
        if (!this.messages.length) {
            const empty = el('div', 'cii-codex-empty', 'What should we build?');
            this.messageListEl.append(empty);
            return;
        }
        for (const item of this.messages) {
            const row = el('div', `cii-codex-msg cii-codex-msg-${item.type || 'message'}`);
            this.renderMessageAttachments(row, item);
            const text = el('div', 'cii-codex-msg-text', messageText(item.text));
            row.append(text);
            this.messageListEl.append(row);
        }
        this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
    }

    renderMessageAttachments(row, item) {
        const screenshots = Array.isArray(item.screenshots) ? item.screenshots : [];
        const references = Array.isArray(item.references) ? item.references : [];
        if (!screenshots.length && !references.length)
            return;

        const attachments = el('div', 'cii-codex-msg-attachments');
        for (const screenshot of screenshots) {
            if (!screenshot?.dataUrl)
                continue;
            const frame = el('button', 'cii-codex-msg-shot');
            frame.type = 'button';
            const img = document.createElement('img');
            img.src = screenshot.dataUrl;
            img.alt = screenshot.scope || 'Screenshot';
            frame.append(img);
            frame.addEventListener('click', () => this.screenshots.openPreview(screenshot));
            attachments.append(frame);
        }
        for (const reference of references) {
            attachments.append(this.renderReferenceChip(reference, { static: true }));
        }
        row.append(attachments);
    }

    setBusy(busy) {
        this.busy = busy;
        if (this.sendButton)
            this.sendButton.disabled = busy;
        this.screenshots.setDisabled(busy);
        this.updateEnvironmentPanel();
        this.setStatus(busy ? 'Codex is working' : '');
    }

    setStatus(text) {
        if (!this.statusEl)
            return;
        this.statusEl.textContent = text || '';
        this.statusEl.hidden = !text;
    }

    focusComposer() {
        if (!this.textarea)
            return;
        this.textarea.focus({ preventScroll: true });
    }

    showError(text) {
        this.setStatus(text);
    }
}
