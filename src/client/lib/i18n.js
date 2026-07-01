import { CLIENT_CONFIG_GLOBAL } from '../../shared/constants.js';
import { normalizeLocale } from '../../shared/locale.js';

// Re-exported so existing importers of `normalizeLocale` from this module keep working; the implementation now lives in
// shared/ so the Node server and the browser agree on the zh/en classification.
export { normalizeLocale };

/**
 * Browser-side i18n for every user-visible string in the plugin UI.
 *
 * Purpose: keeps Chinese and English copies of all labels, titles, placeholders, and user-facing errors in one place so
 * the running locale renders a single language while both translations stay defined.
 * Boundary: this module owns presentation copy only — it never touches the prompt text sent to an agent (that stays
 * language-neutral on the server). Brand names such as `Codex App` are intentionally left untranslated by the call
 * sites, so they are not stored here.
 *
 * @type {string} module identity comment.
 */

/** Supported locales in lookup order; the first is the default fallback. */
export const LOCALES = ['zh', 'en'];

/**
 * Translation table keyed by stable dotted ids. Each entry holds the `zh` and `en` copy.
 * Boundary: `{name}` tokens are interpolated from the `params` argument of {@link t}; an unknown key falls back to the
 * key string itself so a missing translation is visible instead of silently empty.
 *
 * @type {Record<string, { zh: string, en: string }>}
 */
const STRINGS = {
    // --- intent editor / dialog shell ---
    'intent.placeholder': {
        zh: '例如：把这个按钮改成主按钮，并加 loading 状态',
        en: 'e.g. Make this the primary button and add a loading state',
    },
    'editor.aria': { zh: '修改意图', en: 'Change intent' },
    'editor.primaryPinned.title': {
        zh: '当前选中的元素（不可移除）：{target}',
        en: 'Currently selected element (cannot be removed): {target}',
    },
    'mention.remove.aria': { zh: '移除 {label}', en: 'Remove {label}' },
    'dialog.pin.title': {
        zh: '固定为悬浮按钮，跨页面继续编辑',
        en: 'Pin as a floating button to keep editing across pages',
    },
    'dialog.pin.aria': { zh: '固定', en: 'Pin' },
    'dialog.close.title': { zh: '取消', en: 'Cancel' },
    'dialog.close.aria': { zh: '取消', en: 'Cancel' },

    // --- source references ---
    'reference.add.title': { zh: '添加代码引用', en: 'Add code reference' },
    'reference.codeFallback': { zh: '代码 {n}', en: 'Code {n}' },
    'reference.resolveFailed': {
        zh: '无法解析源码引用',
        en: 'Failed to resolve source reference',
    },
    'resolve.failed': {
        zh: '无法解析源码位置',
        en: 'Failed to resolve source location',
    },

    // --- app agents ---
    'agent.codexApp.title': {
        zh: '在 Codex App 中打开并预填本次 UI 修改意图。',
        en: 'Open Codex App with this UI change intent prefilled.',
    },
    'agent.claudeApp.title': {
        zh: '在 Claude App 中打开并预填本次 UI 修改意图。',
        en: 'Open Claude App with this UI change intent prefilled.',
    },
    'agent.cursorApp.title': {
        zh: '在 Cursor 中打开并预填本次 UI 修改意图。',
        en: 'Open Cursor with this UI change intent prefilled.',
    },
    'agent.clipboard.label': { zh: '复制 Prompt', en: 'Copy prompt' },
    'agent.clipboard.title': {
        zh: '把整理好的 Prompt 复制到剪贴板，可粘贴到任意 AI。',
        en: 'Copy the assembled prompt to your clipboard — paste it into any AI.',
    },
    'clipboard.copied': { zh: '✓ 已复制到剪贴板', en: '✓ Copied to clipboard' },
    'clipboard.copyFailed': {
        zh: '复制失败，请手动复制。',
        en: 'Copy failed — please copy it manually.',
    },
    'agent.notEnabled': { zh: '{label} 未启用。', en: '{label} is not enabled.' },
    'agent.unavailable': { zh: '{label} 不可用。', en: '{label} is unavailable.' },
    'agent.checkSetup': {
        zh: '请检查适配器配置后重试。',
        en: 'Check the adapter setup and try again.',
    },
    'agent.notEnabledInConfig': {
        zh: '{label} 未在插件配置中启用。',
        en: '{label} is not enabled in the plugin config.',
    },
    'agent.currentlyUnavailable': {
        zh: '{label} 当前不可用。',
        en: '{label} is currently unavailable.',
    },
    'agent.failedHandle': {
        zh: '{label} 处理请求失败。',
        en: '{label} failed to handle the request.',
    },

    // --- screenshots ---
    'screenshot.settings.title': { zh: '截图设置', en: 'Screenshot settings' },
    'screenshot.choice.none': { zh: '不截图', en: 'No screenshot' },
    'screenshot.scope.selection': { zh: '区域截图', en: 'Region screenshot' },
    'screenshot.scope.parent': { zh: '父节点截图', en: 'Parent screenshot' },
    'screenshot.scope.viewport': { zh: '全屏截图', en: 'Full-page screenshot' },
    'screenshot.scopeTitle.selection': { zh: '区域', en: 'Region' },
    'screenshot.scopeTitle.parent': { zh: '父节点', en: 'Parent' },
    'screenshot.scopeTitle.viewport': { zh: '全屏', en: 'Full page' },
    'screenshot.summary': { zh: '截图：{list}', en: 'Screenshot: {list}' },
    'screenshot.preview.aria': { zh: '预览{label}', en: 'Preview {label}' },
    'screenshot.remove.aria': { zh: '移除{label}', en: 'Remove {label}' },
    'screenshot.lightbox.close.aria': { zh: '关闭预览', en: 'Close preview' },
    'screenshot.error.elementGone': {
        zh: '所选元素已不存在',
        en: 'Selected element is no longer available',
    },
    'screenshot.error.canvasUnavailable': {
        zh: 'Canvas 渲染不可用',
        en: 'Canvas rendering is unavailable',
    },
    'screenshot.error.renderTimeout': {
        zh: '图像渲染超时',
        en: 'Timed out rendering image',
    },
    'screenshot.error.renderFailed': {
        zh: '截图图像渲染失败',
        en: 'Failed to render screenshot image',
    },

    // --- recordings ---
    'recording.scope.title': { zh: '录制范围', en: 'Recording scope' },
    'recording.toggle.title': { zh: '录制元素行为', en: 'Record element behavior' },
    'recording.scope.selection': { zh: '选中节点', en: 'Selected node' },
    'recording.scope.parent': { zh: '父节点', en: 'Parent node' },
    'recording.scope.root': { zh: '挂载根', en: 'Mount root' },
    'recording.tooShort': {
        zh: '录制时间太短，未生成片段',
        en: 'Recording too short; no clip was created',
    },
    'recording.indicator.recording': { zh: '录制中 {time}', en: 'Recording {time}' },
    'recording.stop': { zh: '停止', en: 'Stop' },
    'recording.thumb.aria': { zh: '查看/裁剪录制片段', en: 'View/trim recording clip' },
    'recording.still.alt': { zh: '录制静帧', en: 'Recording still frame' },
    'recording.remove.aria': { zh: '移除录制片段', en: 'Remove recording clip' },
    'recording.still.empty': {
        zh: '录制内容为空，无法生成静帧',
        en: 'Recording is empty; cannot generate a still frame',
    },
    'recording.still.replayUnavailable': {
        zh: '回放重建失败：replay iframe 文档不可用',
        en: 'Replay rebuild failed: the replay iframe document is unavailable',
    },

    // --- recording editor (viewer) ---
    'rv.title': { zh: '录制编辑', en: 'Recording editor' },
    'rv.close.aria': { zh: '完成', en: 'Done' },
    'rv.hint': {
        zh: '默认保留全部。在下方时间轴上拖选要删掉的片段，再点「剪掉选区」——被删的时间会压成一帧跳过；也可点片段上的 × 删除整段。',
        en: 'Everything is kept by default. Drag a range on the timeline below to mark a clip to remove, then click “Cut selection” — removed time is collapsed into a single skipped frame; you can also click the × on a segment to delete it.',
    },
    'rv.cut': { zh: '剪掉选区', en: 'Cut selection' },
    'rv.reset': { zh: '还原全部', en: 'Restore all' },
    'rv.useStill': { zh: '用此刻作为静帧', en: 'Use this frame as the still' },
    'rv.done': { zh: '完成', en: 'Done' },
    'rv.seg.remove.title': { zh: '删除该片段', en: 'Delete this segment' },
    'rv.kept': {
        zh: '保留 {kept} / 共 {total}（{count} 段）',
        en: 'Kept {kept} / {total} ({count} segments)',
    },
    'rv.generating': { zh: '生成中…', en: 'Generating…' },
    'rv.stillUpdated': { zh: '已更新静帧 ✓', en: 'Still updated ✓' },

    // --- vendor (rrweb) loading ---
    'vendor.record.loadFail': {
        zh: '无法加载录制库 @rrweb/record：{detail}。请先在项目中安装：npm i @rrweb/record',
        en: 'Failed to load the recording library @rrweb/record: {detail}. Install it first: npm i @rrweb/record',
    },
    'vendor.replay.loadFail': {
        zh: '无法加载回放库 @rrweb/replay：{detail}。请先在项目中安装：npm i @rrweb/replay',
        en: 'Failed to load the replay library @rrweb/replay: {detail}. Install it first: npm i @rrweb/replay',
    },

    // --- pinned orb ---
    'pin.orb.title': { zh: '继续编辑已固定的意图', en: 'Resume the pinned intent' },

    // --- overlay ---
    'overlay.noMapping': { zh: '无源码映射', en: 'no source mapping' },

    // --- style capture (supplementary element styles) ---
    'styles.button.title': { zh: '补充元素渲染样式', en: 'Attach rendered element styles' },
    'styles.panel.title': { zh: '采集渲染样式', en: 'Capture rendered styles' },
    'styles.scope.label': { zh: '作用域', en: 'Scope' },
    'styles.scope.self': { zh: '仅当前元素', en: 'Selected element only' },
    'styles.scope.ancestors': { zh: '父链逐级', en: 'Element + ancestors' },
    'styles.search.placeholder': { zh: '过滤 CSS 属性…', en: 'Filter CSS properties…' },
    'styles.empty': { zh: '没有匹配的属性', en: 'No matching properties' },
    'styles.selectedCount': { zh: '已选 {n} 项', en: '{n} selected' },
    'styles.useDefaults': { zh: '常用默认', en: 'Common defaults' },
    'styles.clear': { zh: '清空', en: 'Clear' },
    'styles.summary': { zh: '样式：{n} 个属性', en: 'Styles: {n} properties' },
    'styles.preview.summary': {
        zh: '渲染样式：{props} 个属性 · {nodes} 个节点',
        en: 'Rendered styles: {props} properties · {nodes} nodes',
    },
    'styles.remove.aria': { zh: '移除样式采集', en: 'Remove style capture' },
    'styles.error.elementGone': {
        zh: '所选元素已不存在',
        en: 'Selected element is no longer available',
    },
};

/** Active locale, lazily resolved on first use. @type {string | null} */
let currentLocale = null;

/**
 * Detect the locale from the injected plugin config first, then the browser language, defaulting to Chinese.
 *
 * Boundary: reads the config global directly so module-load-time label lookups still resolve before `setLocale` runs.
 * Missing both sources falls back to `zh`, the plugin's primary language.
 *
 * @returns {'zh' | 'en'} Resolved locale id.
 */
function detectLocale() {
    const config = typeof window !== 'undefined' ? window[CLIENT_CONFIG_GLOBAL] : null;
    const fromConfig = normalizeLocale(config && typeof config === 'object' ? config.locale : null);
    if (fromConfig)
        return fromConfig;
    const navLang = typeof navigator !== 'undefined' ? navigator.language : '';
    return normalizeLocale(navLang) ?? 'zh';
}

/**
 * Return the active UI locale, resolving it on first use.
 *
 * @returns {'zh' | 'en'} Active locale id.
 */
export function getLocale() {
    if (!currentLocale)
        currentLocale = detectLocale();
    return currentLocale;
}

/**
 * Override the active UI locale.
 *
 * Boundary: unsupported values are ignored so a bad config string cannot blank the UI. Already-rendered DOM is not
 * re-translated; callers should set the locale before building dialog UI.
 *
 * @param {unknown} locale Desired locale id.
 * @returns {void}
 */
export function setLocale(locale) {
    const normalized = normalizeLocale(locale);
    if (normalized)
        currentLocale = normalized;
}

/**
 * Interpolate `{name}` tokens in a template string from a params object.
 *
 * @param {string} template Copy possibly containing `{name}` tokens.
 * @param {Record<string, unknown> | undefined} params Replacement values.
 * @returns {string} Interpolated string.
 */
function interpolate(template, params) {
    if (!params)
        return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

/**
 * Translate a key into the active locale with `{name}` interpolation.
 *
 * Boundary: a missing key resolves to the raw key string, and a key missing the active locale falls back to the other
 * locale, so partial translations stay visible rather than empty.
 *
 * @param {string} key Stable dotted translation id.
 * @param {Record<string, unknown>} [params] Optional interpolation values.
 * @returns {string} Localized, interpolated copy.
 */
export function t(key, params) {
    const entry = STRINGS[key];
    if (!entry)
        return interpolate(key, params);
    const locale = getLocale();
    const text = entry[locale] ?? entry.zh ?? entry.en ?? key;
    return interpolate(text, params);
}
