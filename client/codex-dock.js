import { DialogScreenshotController } from './dialog-screenshots.js';
import { collectSelection, findInspectableElement, isPluginNode } from './dom.js';
import { clamp, el, sourceReferenceLabel } from './dialog-utils.js';

const DOCK_STATE_KEY = 'code-intent-inspector:codex-dock-state';
const DEFAULT_WIDTH = 960;
const MIN_WIDTH = 560;
const MIN_HEIGHT = 420;
const DEFAULT_VISIBLE_SESSIONS_PER_PROJECT = 5;
const MAX_PROGRESS_EVENTS = 24;
const REASONING_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
];
const SPEED_OPTIONS = [
    { value: 'standard', label: 'Standard', detail: 'Default speed' },
    { value: 'fast', label: 'Fast', detail: '1.5x speed, increased usage' },
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
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(diff / 60_000);
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

function progressEventLabel(type) {
    if (type === 'reasoning')
        return 'Thinking';
    if (type === 'tool')
        return 'Tool';
    if (type === 'file-change')
        return 'Files';
    if (type === 'assistant')
        return 'Draft';
    if (type === 'prompt')
        return 'Prompt';
    if (type === 'failed')
        return 'Failed';
    if (type === 'completed')
        return 'Done';
    if (type === 'started')
        return 'Start';
    return 'Event';
}

function progressEventKey(event) {
    const itemId = event?.raw?.item?.id;
    if (typeof itemId === 'string' && itemId)
        return itemId;
    return '';
}

function normalizeProgressEvent(event) {
    const type = typeof event?.type === 'string' && event.type ? event.type : 'message';
    const text = messageText(event?.text);
    return {
        type,
        text,
        key: progressEventKey(event),
        raw: event?.raw,
    };
}

function normalizeReasoning(value) {
    if (value === 'extra-high')
        return 'xhigh';
    return REASONING_OPTIONS.some((item) => item.value === value) ? value : 'xhigh';
}

function normalizeSpeed(value) {
    return value === 'fast' ? 'fast' : 'standard';
}

function maxDockWidth() {
    return Math.max(MIN_WIDTH, window.innerWidth - 16);
}

function maxDockHeight() {
    return Math.max(MIN_HEIGHT, window.innerHeight - 16);
}

function defaultDockWidth() {
    return clamp(DEFAULT_WIDTH, MIN_WIDTH, maxDockWidth());
}

function defaultDockHeight() {
    return maxDockHeight();
}

function contextPercent(metrics) {
    const percent = Number(metrics?.contextPercent);
    if (!Number.isFinite(percent))
        return calculatedContextPercent(metrics);
    return Math.max(0, Math.min(100, Math.round(percent)));
}

function calculatedContextPercent(metrics) {
    const tokensUsed = Number(metrics?.tokensUsed);
    const contextWindow = Number(metrics?.contextWindow);
    if (!Number.isFinite(tokensUsed) || !Number.isFinite(contextWindow) || contextWindow <= 0)
        return 0;
    return Math.max(0, Math.min(100, Math.round((tokensUsed / contextWindow) * 100)));
}

function compactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return '';
    if (number >= 1_000_000)
        return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (number >= 1_000)
        return `${(number / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(Math.round(number));
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
    const calculated = calculatedContextPercent(metrics);
    if (calculated)
        return `${calculated}% used`;
    const tokens = compactNumber(metrics?.tokensUsed);
    if (tokens)
        return `${tokens} tokens`;
    const text = typeof metrics?.contextText === 'string' ? metrics.contextText.trim() : '';
    return text || '0% used';
}

function readableModelLabel(value) {
    const text = String(value || '').trim();
    if (!text)
        return '';
    if (/^gpt[-_]/i.test(text)) {
        return text
            .replace(/_/g, '-')
            .replace(/^gpt/i, 'GPT')
            .replace(/-mini\b/i, '-Mini')
            .replace(/-codex\b/i, '-Codex')
            .replace(/-spark\b/i, '-Spark');
    }
    return text
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.toLowerCase() === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function displayModelLabel(label) {
    const text = String(label || '').trim();
    if (!text || text === 'Default')
        return 'Default';
    return text.replace(/^GPT-/i, '');
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
    modelMenuOpen = false;
    modelSubmenu = 'model';
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
    defaultModel = '';
    screenshots;

    /**
     * Create a dock controller bound to one host page.
     *
     * Boundary: `parent`, `api`, and `overlay` must be live objects from the
     * client runtime; missing dependencies break rendering, route calls, or
     * element picking before user interaction begins. Persisted unsupported
     * fields are ignored so the dock always initializes with the current
     * editing-only controls.
     *
     * @param {Element} parent Host element that receives the dock DOM.
     * @param {Record<string, unknown>} config Browser inspector config.
     * @param {Record<string, Function>} api Route client used for resolve/send calls.
     * @param {Record<string, Function>} overlay Page overlay controller for picking.
     * @returns {CodexDock} Constructed dock controller instance.
     */
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
            width: clamp(Number(stored.width) || defaultDockWidth(), MIN_WIDTH, maxDockWidth()),
            height: clamp(Number(stored.height) || defaultDockHeight(), MIN_HEIGHT, maxDockHeight()),
            sidebarCollapsed: stored.sidebarCollapsed === true,
            threadId: typeof stored.threadId === 'string' ? stored.threadId : null,
            model: typeof stored.model === 'string' ? stored.model : this.models[0]?.value ?? '',
            reasoningEffort: normalizeReasoning(stored.reasoningEffort),
            speed: normalizeSpeed(stored.speed),
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

    /**
     * Persist user-adjustable dock state into local storage.
     *
     * Boundary: persisted values are UI conveniences only; stale unsupported
     * fields from older builds are intentionally not written back. Passing no
     * state to `writeDockState` would reset dock placement and session affinity
     * for the next render.
     *
     * @returns {void}
     */
    persistState() {
        writeDockState({
            collapsed: this.state.collapsed,
            x: this.state.x,
            y: this.state.y,
            width: this.state.width,
            height: this.state.height,
            sidebarCollapsed: this.state.sidebarCollapsed,
            threadId: this.isNewThread ? null : this.currentThreadId,
            model: this.state.model,
            reasoningEffort: this.state.reasoningEffort,
            speed: this.state.speed,
        });
    }

    /**
     * Render the dock root into the plugin host element.
     *
     * Boundary: this method replaces the previous dock DOM and must preserve
     * draft text before removal. Calling it before `screenshots` is constructed
     * breaks screenshot menus and resize positioning.
     *
     * @returns {void}
     */
    render() {
        if (this.textarea)
            this.draft = this.textarea.value;
        if (this.dockEl)
            this.dockEl.remove();

        const dock = el('section', `cii-codex-dock${this.state.collapsed ? ' cii-codex-dock-collapsed' : ''}`);
        dock.setAttribute('aria-label', 'Codex dock');
        dock.addEventListener('mousedown', (event) => {
            this.screenshots.closeMenuFromOutside(event.target);
            this.closeModelMenuFromOutside(event.target);
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
        const main = el('div', `cii-codex-main${this.state.sidebarCollapsed ? ' cii-codex-main-sidebar-collapsed' : ''}`);
        main.append(this.renderSidebar(), this.renderChat());
        shell.append(main, ...this.renderResizeHandles());
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

        const brand = el('div', 'cii-codex-sidebar-brand');
        brand.addEventListener('mousedown', (event) => {
            if (event.target instanceof HTMLElement && event.target.closest('button'))
                return;
            this.startDrag(event);
        });
        brand.append(el('span', 'cii-codex-sidebar-title', 'Codex Dock'));
        const brandControls = el('div', 'cii-codex-sidebar-controls');
        this.refreshButton = el('button', 'cii-codex-sidebar-icon-btn', '↻');
        this.refreshButton.type = 'button';
        this.refreshButton.title = 'Refresh sessions';
        this.refreshButton.addEventListener('click', () => void this.loadSessions());
        const collapse = el('button', 'cii-codex-sidebar-icon-btn', '‹');
        collapse.type = 'button';
        collapse.title = 'Collapse dock';
        collapse.addEventListener('click', () => this.collapse());
        brandControls.append(this.refreshButton, collapse);
        brand.append(brandControls);

        const toolbar = el('div', 'cii-codex-sidebar-toolbar');
        const newChat = el('button', 'cii-codex-new-chat', '+ New chat');
        newChat.type = 'button';
        newChat.addEventListener('click', () => this.startNewChat());
        const toggle = el('button', 'cii-codex-sidebar-toggle', '‹');
        toggle.type = 'button';
        toggle.title = 'Hide sessions';
        toggle.addEventListener('click', () => this.toggleSidebar(true));
        toolbar.append(newChat, toggle);
        this.sessionListEl = el('div', 'cii-codex-session-list');
        sidebar.append(brand, toolbar, this.sessionListEl);
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

    /**
     * Render the chat pane and composer controls.
     *
     * Boundary: the composer always sends editing requests now; UI controls
     * should not alter request routing. Returning a detached element is expected
     * because `renderShell` owns insertion into the dock.
     *
     * @returns {HTMLElement} Chat pane element containing messages and composer.
     */
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
        this.textarea.placeholder = 'Ask Codex to change this project';
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
        leftTools.append(this.screenshots.renderPicker());
        const rightTools = el('div', 'cii-codex-send-row');
        this.sendButton = el('button', 'cii-codex-send', '↑');
        this.sendButton.type = 'submit';
        this.sendButton.title = 'Send';
        rightTools.append(this.renderModelSelect(), this.sendButton);
        footer.append(leftTools, rightTools);
        composer.append(attachmentTray, this.textarea, footer);

        chat.append(this.environmentEl, this.messageListEl, this.statusEl, composer);
        this.renderMessages();
        this.renderReferences();
        return chat;
    }

    renderEnvironmentPanel() {
        const panel = el('header', 'cii-codex-env-panel');
        panel.addEventListener('mousedown', (event) => {
            if (event.target instanceof HTMLElement && event.target.closest('button, textarea, input, select'))
                return;
            this.startDrag(event);
        });
        const model = el('div', 'cii-codex-env-model');
        model.append(el('span', undefined, 'Model: '), el('strong', undefined, this.currentModelLabel()));
        const right = el('div', 'cii-codex-env-right');
        const state = el('div', 'cii-codex-run-state');
        state.append(el('span', 'cii-codex-run-dot'), el('span', undefined, this.busy ? 'Running' : 'Ready'));
        const meter = el('div', 'cii-codex-env-meter');
        const meterTrack = el('span', 'cii-codex-env-meter-track');
        const meterFill = el('span', 'cii-codex-env-meter-fill');
        meterFill.style.width = `${contextPercent(this.metrics)}%`;
        meterTrack.append(meterFill);
        meter.append(meterTrack, el('span', undefined, formatContextUsage(this.metrics)));
        right.append(state, meter);
        panel.append(model, right);
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
        if (model?.value)
            return model.label;
        const session = this.isNewThread ? null : this.sessions.find((item) => item.id === this.currentThreadId);
        const sessionModel = typeof session?.model === 'string' ? session.model.trim() : '';
        if (sessionModel) {
            const configured = this.models.find((item) => item.value === sessionModel || item.label === sessionModel);
            return configured?.label || readableModelLabel(sessionModel);
        }
        const defaultLabel = this.defaultModelLabel();
        if (defaultLabel)
            return defaultLabel;
        return model?.label || 'Default';
    }

    defaultModelLabel() {
        const defaultModel = String(this.defaultModel || '').trim();
        if (!defaultModel)
            return '';
        const configured = this.models.find((item) => item.value === defaultModel || item.label === defaultModel);
        return configured?.label || readableModelLabel(defaultModel);
    }

    renderModelSelect() {
        const wrapper = el('div', 'cii-codex-model-picker');
        const button = el('button', 'cii-codex-model-trigger');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', this.modelMenuOpen ? 'true' : 'false');
        if (this.isFastSpeed())
            button.append(el('span', 'cii-codex-model-icon'));
        button.append(el('span', 'cii-codex-model-trigger-text', this.modelControlLabel()), el('span', 'cii-codex-model-chevron', '⌄'));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.modelMenuOpen = !this.modelMenuOpen;
            this.modelSubmenu = this.modelSubmenu || 'model';
            this.render();
        });
        wrapper.append(button);
        if (this.modelMenuOpen)
            wrapper.append(this.renderModelMenu());
        return wrapper;
    }

    modelControlLabel() {
        const modelLabel = this.currentModelLabel();
        if (modelLabel === 'Default')
            return 'Default';
        return `${displayModelLabel(modelLabel)} ${this.currentReasoningLabel()}`;
    }

    currentReasoningLabel() {
        return REASONING_OPTIONS.find((item) => item.value === this.state.reasoningEffort)?.label ?? 'Extra High';
    }

    currentSpeedLabel() {
        return SPEED_OPTIONS.find((item) => item.value === this.state.speed)?.label ?? 'Standard';
    }

    isFastSpeed() {
        return this.state.speed === 'fast';
    }

    renderModelMenu() {
        const menu = el('div', 'cii-codex-model-menu');
        menu.setAttribute('role', 'menu');
        menu.append(el('div', 'cii-codex-menu-title', 'Reasoning'));
        for (const option of REASONING_OPTIONS) {
            const item = this.renderModelMenuItem(option.label, {
                active: this.state.reasoningEffort === option.value,
                onClick: () => {
                    this.state.reasoningEffort = option.value;
                    this.closeModelMenu();
                },
            });
            menu.append(item);
        }
        menu.append(el('div', 'cii-codex-menu-separator'));
        menu.append(this.renderModelMenuItem(this.currentModelLabel(), {
            icon: this.isFastSpeed() ? '⚡' : '',
            submenu: true,
            active: this.modelSubmenu === 'model',
            onEnter: () => this.setModelSubmenu('model'),
            onClick: () => this.setModelSubmenu('model'),
        }));
        menu.append(this.renderModelMenuItem('Speed', {
            submenu: true,
            active: this.modelSubmenu === 'speed',
            onEnter: () => this.setModelSubmenu('speed'),
            onClick: () => this.setModelSubmenu('speed'),
        }));
        menu.append(this.renderModelSubmenu());
        return menu;
    }

    renderModelMenuItem(label, options = {}) {
        const item = el('button', `cii-codex-menu-item${options.active ? ' cii-codex-menu-item-active' : ''}`);
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        const text = el('span', 'cii-codex-menu-item-text');
        if (options.icon)
            text.append(el('span', 'cii-codex-menu-item-icon', options.icon));
        if (options.detail) {
            const copy = el('span', 'cii-codex-menu-item-copy');
            copy.append(el('span', 'cii-codex-menu-item-label', label), el('span', 'cii-codex-menu-detail', options.detail));
            text.append(copy);
        }
        else {
            text.append(el('span', 'cii-codex-menu-item-label', label));
        }
        item.append(text);
        if (options.submenu)
            item.append(el('span', 'cii-codex-menu-item-chevron', '›'));
        else if (options.active)
            item.append(el('span', 'cii-codex-menu-check', '✓'));
        item.addEventListener('mouseenter', () => options.onEnter?.());
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onClick?.();
        });
        return item;
    }

    renderModelSubmenu() {
        const submenu = el('div', 'cii-codex-model-submenu');
        submenu.setAttribute('role', 'menu');
        if (this.modelSubmenu === 'speed') {
            submenu.append(el('div', 'cii-codex-menu-title', 'Speed'));
            for (const option of SPEED_OPTIONS) {
                const item = this.renderModelMenuItem(option.label, {
                    icon: option.value === 'fast' ? '⚡' : '',
                    active: this.state.speed === option.value,
                    detail: option.detail,
                    onClick: () => {
                        this.state.speed = option.value;
                        this.closeModelMenu();
                    },
                });
                submenu.append(item);
            }
            return submenu;
        }

        submenu.append(el('div', 'cii-codex-menu-title', 'Model'));
        const effectiveModel = this.effectiveModelValue();
        for (const model of this.models) {
            const item = this.renderModelMenuItem(model.label, {
                icon: model.value && this.isFastSpeed() ? '⚡' : '',
                active: model.value === effectiveModel,
                onClick: () => {
                    this.state.model = model.value;
                    this.closeModelMenu();
                    this.updateEnvironmentPanel();
                },
            });
            submenu.append(item);
        }
        return submenu;
    }

    setModelSubmenu(value) {
        if (this.modelSubmenu === value)
            return;
        this.modelSubmenu = value;
        this.render();
    }

    closeModelMenu() {
        this.modelMenuOpen = false;
        this.persistState();
        this.render();
        this.focusComposer();
    }

    closeModelMenuFromOutside(target) {
        if (!this.modelMenuOpen)
            return;
        if (target instanceof Node && this.dockEl?.contains(target)) {
            const node = target instanceof HTMLElement ? target : target.parentElement;
            if (node?.closest?.('.cii-codex-model-picker'))
                return;
        }
        this.modelMenuOpen = false;
        this.render();
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
            this.defaultModel = typeof res.defaultModel === 'string' ? res.defaultModel.trim() : '';
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
        if (this.isNewThread || !this.currentThreadId)
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
        groups.forEach((group) => {
            const section = el('section', 'cii-codex-project-group');
            const heading = el('div', 'cii-codex-project-heading');
            heading.append(el('span', 'cii-codex-project-icon'), el('span', 'cii-codex-project-name', group.label));
            section.append(heading);

            const expanded = this.expandedSessionGroups.has(group.key);
            section.classList.toggle('cii-codex-project-group-expanded', expanded);
            const visibleCount = expanded
                ? group.sessions.length
                : Math.min(DEFAULT_VISIBLE_SESSIONS_PER_PROJECT, group.sessions.length);
            const sessionStack = el('div', 'cii-codex-session-stack');
            sessionStack.style.setProperty('--cii-session-visible', String(visibleCount));

            group.sessions.forEach((session, index) => {
                const button = el('button', 'cii-codex-session');
                button.type = 'button';
                if (index >= DEFAULT_VISIBLE_SESSIONS_PER_PROJECT) {
                    button.dataset.sessionExtra = 'true';
                    if (!expanded)
                        button.tabIndex = -1;
                }
                const active = !this.isNewThread && session.id === this.currentThreadId;
                button.classList.toggle('cii-codex-session-active', active);
                if (active)
                    button.setAttribute('aria-current', 'true');
                const title = el('span', 'cii-codex-session-title', session.title || 'Untitled session');
                const meta = el('span', 'cii-codex-session-meta', formatRelativeTime(session.updatedAt));
                button.append(title, meta);
                button.addEventListener('click', () => void this.selectSession(session));
                sessionStack.append(button);
            });
            section.append(sessionStack);

            if (group.sessions.length > DEFAULT_VISIBLE_SESSIONS_PER_PROJECT) {
                section.append(this.renderSessionMoreButton(group.key, expanded, group.sessions.length));
            }

            this.sessionListEl.append(section);
        });
    }

    renderSessionMoreButton(groupKey, expanded, totalCount) {
        const showMore = el('button', 'cii-codex-session-more', expanded ? 'Show less' : 'Show more');
        showMore.type = 'button';
        showMore.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        showMore.addEventListener('click', () => {
            const nextExpanded = !this.expandedSessionGroups.has(groupKey);
            if (nextExpanded)
                this.expandedSessionGroups.add(groupKey);
            else
                this.expandedSessionGroups.delete(groupKey);
            this.persistState();
            const section = showMore.closest('.cii-codex-project-group');
            const stack = section?.querySelector?.('.cii-codex-session-stack');
            section?.classList.toggle('cii-codex-project-group-expanded', nextExpanded);
            if (stack instanceof HTMLElement)
                stack.style.setProperty('--cii-session-visible', String(nextExpanded ? totalCount : DEFAULT_VISIBLE_SESSIONS_PER_PROJECT));
            section?.querySelectorAll?.('[data-session-extra="true"]').forEach((button) => {
                if (button instanceof HTMLElement)
                    button.tabIndex = nextExpanded ? 0 : -1;
            });
            showMore.textContent = nextExpanded ? 'Show less' : 'Show more';
            showMore.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        });
        return showMore;
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
            this.metrics = res.metrics && typeof res.metrics === 'object' ? res.metrics : {};
            this.render();
            this.setStatus('');
            this.scrollMessagesToBottom();
        }
        catch (err) {
            if (this.currentThreadId !== session.id)
                return;
            this.messages = [{ type: 'failed', text: err instanceof Error ? err.message : String(err) }];
            this.renderMessages();
            this.setStatus('');
            this.scrollMessagesToBottom();
        }
    }

    startNewChat() {
        this.currentThreadId = null;
        this.isNewThread = true;
        this.state.threadId = null;
        this.messages = [];
        this.references = [];
        this.selectedElement = null;
        this.draft = '';
        this.metrics = {};
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

    /**
     * Add one source selection as a reusable composer reference chip.
     *
     * Boundary: `selection` must include an `inspPath` that the server can
     * resolve; missing or duplicate selections are ignored, while invalid
     * server responses surface as dock errors. Passing the wrong
     * `selectedElement` only affects screenshot focus for later captures.
     *
     * @param {Record<string, unknown>} selection Browser source selection.
     * @param {Element | null} selectedElement DOM element associated with the selection.
     * @returns {Promise<void>} Resolves after the chip and screenshot preview state are updated.
     */
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
                applyMode: 'agent-edit',
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

    /**
     * Build the payload sent to the Codex dock route.
     *
     * Boundary: screenshot payload creation is asynchronous and may return no
     * screenshots; thread fields must stay consistent so stale selected-thread
     * ids are not resumed accidentally. Passing a non-string `intentValue`
     * relies on server normalization and may produce an empty prompt.
     *
     * @param {string} intentValue Composer text to send to Codex.
     * @returns {Promise<Record<string, unknown>>} Serialized dock request payload.
     */
    async buildPayload(intentValue = this.textarea?.value ?? '') {
        const screenshots = await this.screenshots.buildPayloadScreenshots();
        const threadId = this.isNewThread ? undefined : this.currentThreadId || undefined;
        const payload = {
            pageUrl: location.href,
            intent: intentValue,
            applyMode: 'agent-edit',
            references: this.payloadReferences(),
            threadId,
            newThread: !threadId,
            resume: Boolean(threadId),
            model: this.effectiveModelValue() || undefined,
            reasoningEffort: this.state.reasoningEffort,
            speed: this.state.speed,
        };
        if (screenshots)
            payload.screenshots = screenshots;
        return payload;
    }

    effectiveModelValue() {
        return this.state.model || this.defaultModel || '';
    }

    restoreSubmittedDraft(value) {
        if (!value || this.draft || this.textarea?.value)
            return;
        this.draft = value;
        if (this.textarea)
            this.textarea.value = value;
    }

    async send() {
        if (this.busy)
            return;
        const submittedText = this.textarea?.value ?? '';
        const intent = submittedText.trim();
        const hasRefs = this.payloadReferences().length > 0;
        const hasScreenshots = this.screenshots.choices.size > 0;
        if (!intent && !hasRefs && !hasScreenshots) {
            this.setStatus('Type a message or add a code reference');
            return;
        }

        this.setBusy(true);
        this.draft = '';
        if (this.textarea)
            this.textarea.value = '';
        let progressId = '';
        try {
            const payload = await this.buildPayload(submittedText);
            this.messages = [
                ...this.messages,
                {
                    type: 'user',
                    text: intent || '(attachments)',
                    references: this.references.map((item) => ({ label: item.label })),
                    screenshots: payload.screenshots ?? [],
                },
            ];
            progressId = this.startLiveProgress();
            const useStream = typeof this.api.codexTurnStream === 'function';
            const result = useStream
                ? await this.api.codexTurnStream(payload, {
                    onEvent: (event) => this.appendProgressEvent(progressId, event),
                })
                : await this.api.codexTurn(payload);
            this.finishLiveProgress(progressId);
            if (result.metrics)
                this.metrics = result.metrics;
            if (result.threadId) {
                this.currentThreadId = result.threadId;
                this.isNewThread = false;
                this.persistState();
            }
            this.attachPromptToLastUserMessage(result.prompt);
            this.appendResult(result, { includeEvents: !useStream });
            if (result.ok) {
                this.draft = '';
                if (this.textarea)
                    this.textarea.value = '';
                this.references = [];
                this.renderReferences();
                void this.loadSessions();
            }
            else {
                this.restoreSubmittedDraft(submittedText);
            }
        }
        catch (err) {
            this.finishLiveProgress(progressId);
            this.restoreSubmittedDraft(submittedText);
            this.messages = [...this.messages, { type: 'failed', text: err instanceof Error ? err.message : String(err) }];
            this.renderMessages();
        }
        finally {
            this.setBusy(false);
        }
    }

    /**
     * Insert the temporary progress bubble shown while a Codex turn streams.
     *
     * Boundary: the returned id is local to the current render cycle; callers must remove it before appending the final
     * response so progress text is replaced by the completed answer.
     *
     * @returns {string} Temporary progress message id.
     */
    startLiveProgress() {
        const id = `progress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.messages = [
            ...this.messages,
            {
                id,
                type: 'progress',
                text: 'Working',
                events: [],
            },
        ];
        this.renderMessages();
        return id;
    }

    /**
     * Merge one streamed progress event into the temporary progress bubble.
     *
     * Boundary: item-level updates with the same SDK item id replace the prior row to avoid noisy command-output
     * duplicates. Missing ids append a new row.
     *
     * @param {string} id Temporary progress message id from `startLiveProgress`.
     * @param {Record<string, unknown>} event Normalized server progress event.
     * @returns {void}
     */
    appendProgressEvent(id, event) {
        if (!id)
            return;
        const nextEvent = normalizeProgressEvent(event);
        if (!nextEvent.text && nextEvent.type !== 'completed')
            return;
        this.messages = this.messages.map((item) => {
            if (item.id !== id)
                return item;
            const events = Array.isArray(item.events) ? [...item.events] : [];
            const existingIndex = nextEvent.key
                ? events.findIndex((entry) => entry.key === nextEvent.key)
                : -1;
            if (existingIndex >= 0)
                events[existingIndex] = nextEvent;
            else
                events.push(nextEvent);
            return {
                ...item,
                text: nextEvent.type === 'failed' ? 'Failed' : 'Working',
                events: events.slice(-MAX_PROGRESS_EVENTS),
            };
        });
        this.renderMessages();
    }

    /**
     * Remove the temporary progress bubble.
     *
     * Boundary: this does not append final output; callers should invoke `appendResult` after removal.
     *
     * @param {string} id Temporary progress message id.
     * @returns {void}
     */
    finishLiveProgress(id) {
        if (!id)
            return;
        this.messages = this.messages.filter((item) => item.id !== id);
        this.renderMessages();
    }

    /**
     * Attach the authoritative server-built prompt to the latest user message.
     *
     * Boundary: the browser payload is only a draft; this stores the prompt after the server resolves code references
     * and screenshots. Missing/empty prompts leave the message unchanged.
     *
     * @param {unknown} prompt Final prompt text returned by the server.
     * @returns {void}
     */
    attachPromptToLastUserMessage(prompt) {
        const text = typeof prompt === 'string' ? prompt.trimEnd() : '';
        if (!text)
            return;
        for (let index = this.messages.length - 1; index >= 0; index -= 1) {
            const message = this.messages[index];
            if (message?.type !== 'user')
                continue;
            this.messages = this.messages.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: text } : item);
            return;
        }
    }

    /**
     * Append the final Codex turn result.
     *
     * Boundary: streaming calls pass `includeEvents: false` so progress rows are replaced by the complete response.
     * Non-stream calls still render legacy final events.
     *
     * @param {Record<string, unknown>} result Adapter result returned by the server.
     * @param {{ includeEvents?: boolean }} options Rendering options for progress/event history.
     * @returns {void}
     */
    appendResult(result, options = {}) {
        const includeEvents = options.includeEvents !== false;
        const next = [];
        if (includeEvents && Array.isArray(result.events)) {
            for (const event of result.events) {
                const text = messageText(event.text);
                if (!text)
                    continue;
                next.push({ type: event.type || 'message', text });
            }
        }
        const finalOutput = result.output ||
            (Array.isArray(result.events)
                ? [...result.events].reverse().find((event) => event?.type === 'completed' && event?.text)?.text
                : '');
        if (finalOutput && !next.some((item) => item.text === finalOutput)) {
            next.push({ type: 'assistant', text: finalOutput });
        }
        if (!result.ok) {
            next.push({ type: 'failed', text: result.error ?? 'Codex turn failed' });
        }
        this.messages = [...this.messages, ...next];
        this.renderMessages();
        this.updateEnvironmentPanel();
    }

    /**
     * Render the chat transcript from the local message models.
     *
     * Boundary: user messages may carry a server-built prompt that is exposed only
     * through the hover action; progress messages render through their dedicated
     * live card. Missing `messageListEl` means the dock is not mounted yet and no
     * DOM update should be attempted.
     *
     * @returns {void}
     */
    renderMessages() {
        if (!this.messageListEl)
            return;
        this.messageListEl.innerHTML = '';
        if (!this.messages.length && !this.busy) {
            const empty = el('div', 'cii-codex-empty', 'What should we build?');
            this.messageListEl.append(empty);
            return;
        }
        for (const item of this.messages) {
            const row = el('div', `cii-codex-msg cii-codex-msg-${item.type || 'message'}`);
            if (item.type === 'progress') {
                row.append(this.renderProgressMessage(item));
                this.messageListEl.append(row);
                continue;
            }
            const text = el('div', 'cii-codex-msg-text', messageText(item.text));
            row.append(text);
            const prompt = typeof item.prompt === 'string' && item.prompt.trim() ? item.prompt : '';
            if (item.type === 'user' && prompt)
                row.append(this.renderPromptHoverAction(prompt));
            this.renderMessageAttachments(row, item);
            this.messageListEl.append(row);
        }
        if (this.busy && !this.messages.some((item) => item.type === 'progress'))
            this.messageListEl.append(this.renderBusyMessage());
        this.scrollMessagesToBottom();
    }

    scrollMessagesToBottom() {
        const list = this.messageListEl;
        if (!list)
            return;
        const scroll = () => {
            list.scrollTop = list.scrollHeight;
        };
        scroll();
        window.requestAnimationFrame(() => {
            scroll();
            window.requestAnimationFrame(scroll);
        });
        window.setTimeout(scroll, 80);
    }

    renderBusyMessage() {
        const row = el('div', 'cii-codex-msg cii-codex-msg-assistant cii-codex-msg-busy');
        const card = el('div', 'cii-codex-progress-card');
        const title = el('div', 'cii-codex-progress-title');
        title.append(el('span', 'cii-codex-spinner'), el('span', undefined, 'Generating'));
        card.append(title);
        row.append(card);
        return row;
    }

    /**
     * Render the temporary progress log bubble.
     *
     * Boundary: this view is intentionally transient; the completed response replaces it once the server sends the
     * final result event.
     *
     * @param {Record<string, unknown>} item Progress message model.
     * @returns {HTMLElement} Progress card element.
     */
    renderProgressMessage(item) {
        const card = el('div', 'cii-codex-progress-card cii-codex-progress-card-live');
        const title = el('div', 'cii-codex-progress-title');
        title.append(el('span', 'cii-codex-spinner'), el('span', undefined, item.text || 'Working'));
        card.append(title);
        const events = Array.isArray(item.events) ? item.events : [];
        if (events.length) {
            const log = el('div', 'cii-codex-progress-log');
            for (const event of events) {
                const row = el('div', `cii-codex-progress-entry cii-codex-progress-entry-${event.type || 'message'}`);
                row.append(el('span', 'cii-codex-progress-kind', progressEventLabel(event.type)), el('span', 'cii-codex-progress-body', messageText(event.text)));
                log.append(row);
            }
            card.append(log);
        }
        return card;
    }

    /**
     * Append static message attachments such as screenshots and source chips.
     *
     * Boundary: prompt text is intentionally excluded here because it is exposed
     * by the user-message hover action. Missing or malformed attachment payloads
     * are skipped so historical session rows cannot break transcript rendering.
     *
     * @param {HTMLElement} row Message row receiving attachment DOM.
     * @param {Record<string, unknown>} item Message model.
     * @returns {void}
     */
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

    /**
     * Render the hover action that reveals the server-built final prompt.
     *
     * Boundary: the prompt is plain text and is inserted via textContent helpers,
     * so prompt content cannot execute as HTML inside the inspected page. The
     * wrapper stays hidden until the parent user row is hovered or focused.
     *
     * @param {string} prompt Server-built prompt text.
     * @returns {HTMLElement} Prompt hover action wrapper.
     */
    renderPromptHoverAction(prompt) {
        const wrapper = el('div', 'cii-codex-prompt-action');
        const button = el('button', 'cii-codex-prompt-button');
        button.type = 'button';
        button.title = 'View assembled prompt';
        button.setAttribute('aria-label', 'View assembled prompt');
        button.append(el('span', 'cii-codex-prompt-button-icon'));
        const preview = el('div', 'cii-codex-prompt-popover');
        preview.append(el('div', 'cii-codex-prompt-popover-title', 'Prompt'), el('pre', undefined, prompt));
        wrapper.append(button, preview);
        return wrapper;
    }

    setBusy(busy) {
        this.busy = busy;
        if (this.sendButton)
            this.sendButton.disabled = busy;
        this.screenshots.setDisabled(busy);
        this.updateEnvironmentPanel();
        this.setStatus(busy ? 'Codex is working' : '');
        this.renderMessages();
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
