import { el } from './dialog-utils.js';

/**
 * displayMentionLabel(label): strip the prompt-facing leading `@` for chip display.
 *
 * 作用：mention chip 里展示 `src/App.jsx #9-12`，而序列化进 prompt 时仍用带 `@` 的完整标签。
 * 边界：空值返回空字符串；非字符串会被 String() 兜底，方便暴露异常标签而不是抛错。
 *
 * @param {unknown} label 服务端解析出的引用标签，例如 `@src/App.jsx #9-12`。
 * @returns {string} 去掉前导 `@` 的展示文本。
 */
export function displayMentionLabel(label) {
    return String(label || '').replace(/^@/, '');
}

/**
 * createMentionElement(label, options): 创建一个原子 mention chip 节点。
 *
 * 作用：用 `contenteditable=false` 把引用做成不可被光标拆开的整体；静态(主选择)无删除按钮，补充引用带 `×`。
 * 边界：节点只负责展示与删除交互，selection 数据由调用方用 refId 维护在外部 Map 里，避免把对象塞进 DOM 属性。
 *
 * @param {string} label 引用标签(带 `@`)。
 * @param {{ refId?: string, inspPath?: string, static?: boolean, onRemove?: Function }} options chip 行为配置。
 * @returns {HTMLElement} 可插入 contenteditable 的 mention 节点。
 */
function createMentionElement(label, options = {}) {
    const text = String(label || '').trim();
    const chip = el('span', `cii-mention${options.static ? ' cii-mention-static' : ''}`);
    chip.setAttribute('contenteditable', 'false');
    chip.dataset.label = text;
    if (options.inspPath)
        chip.dataset.inspPath = options.inspPath;
    if (options.refId)
        chip.dataset.refId = options.refId;
    chip.title = options.inspPath || text;

    const icon = el('span', 'cii-mention-icon');
    const labelEl = el('span', 'cii-mention-text', displayMentionLabel(text));
    chip.append(icon, labelEl);

    if (!options.static) {
        const remove = el('button', 'cii-mention-remove', '×');
        remove.type = 'button';
        remove.setAttribute('contenteditable', 'false');
        remove.setAttribute('aria-label', `移除 ${displayMentionLabel(text)}`);
        remove.addEventListener('mousedown', (event) => {
            // contenteditable 里 mousedown 会移动光标/触发删除选区，阻止默认行为后再删。
            event.preventDefault();
            event.stopPropagation();
        });
        remove.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onRemove?.(chip);
        });
        chip.append(remove);
    }
    return chip;
}

/**
 * createDialogEditor(options): 创建意图对话框的轻量 mention 编辑器(tiptap 式 contenteditable)。
 *
 * 作用：用一个 contenteditable 替代原 textarea，让“补充引用”在光标处行内插入、与文本保序；主选择则作为
 * contenteditable 之外、不可删除的 pinned chip 常驻顶部。序列化时把行内引用还原成 `@path #range` 文本，并按
 * 顺序导出 selection 列表给 payload。
 * 边界：编辑器只持有本次弹窗的本地 DOM 与 selection 缓存，源码解析仍由服务端负责；每次弹窗 render 都重建 DOM，
 * 因此 reset 之后必须先 render 再 setPrimary。
 *
 * @param {{ placeholder?: string, onChange?: Function }} options placeholder 文案与结构变化回调(插入/删除引用时触发)。
 * @returns {Record<string, Function>} 编辑器控制方法。
 */
export function createDialogEditor(options = {}) {
    const placeholder = String(options.placeholder || '');
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

    let fieldEl = null;
    let pinnedEl = null;
    let editorEl = null;
    let primary = null; // { label, selection }
    let savedRange = null;
    let refSeq = 0;
    const selections = new Map(); // refId -> selection

    const resolveSelectionRoot = () => editorEl?.getRootNode?.() ?? document;

    /**
     * readRange(): 读取当前落在 contenteditable 内的光标 Range。
     * 边界：shadow DOM 下优先用 root.getSelection()，回退 window.getSelection()；不在编辑器内返回 null。
     */
    const readRange = () => {
        if (!editorEl)
            return null;
        const root = resolveSelectionRoot();
        const selection = (root.getSelection && root.getSelection()) || window.getSelection?.();
        if (!selection || selection.rangeCount === 0)
            return null;
        const range = selection.getRangeAt(0);
        if (!editorEl.contains(range.commonAncestorContainer))
            return null;
        return range.cloneRange();
    };

    const endRange = () => {
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        return range;
    };

    const trackRange = () => {
        const range = readRange();
        if (range)
            savedRange = range;
    };

    /**
     * isEditorEmpty(): 编辑器是否“无意义内容”(无引用 chip 且无非空白文本)。
     * 作用：驱动 placeholder 显示;主选择 pinned chip 在编辑器之外，不影响这里的判断。
     */
    const isEditorEmpty = () => {
        if (!editorEl)
            return true;
        if (editorEl.querySelector('.cii-mention'))
            return false;
        return editorEl.textContent.trim().length === 0;
    };

    const refreshEmptyState = () => {
        editorEl?.classList.toggle('cii-editor-empty', isEditorEmpty());
    };

    const focusEditor = (caretRange) => {
        if (!editorEl)
            return;
        try {
            editorEl.focus({ preventScroll: true });
        }
        catch {
            editorEl.focus();
        }
        if (!caretRange)
            return;
        try {
            const root = resolveSelectionRoot();
            const selection = (root.getSelection && root.getSelection()) || window.getSelection?.();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(caretRange);
            }
        }
        catch {
            // 选区恢复失败不致命：下一次点击/输入会重新建立光标。
        }
    };

    /**
     * renderPinned(): 渲染/刷新 contenteditable 之外的主选择 pinned chip。
     * 边界：无 primary 时隐藏容器;主选择 chip 不带删除按钮、天然不可被编辑删除。
     */
    const renderPinned = () => {
        if (!pinnedEl)
            return;
        pinnedEl.innerHTML = '';
        if (!primary) {
            pinnedEl.hidden = true;
            return;
        }
        pinnedEl.hidden = false;
        const chip = createMentionElement(primary.label, {
            static: true,
            inspPath: primary.selection?.inspPath,
        });
        chip.title = `当前选中的元素（不可移除）：${primary.selection?.inspPath ?? primary.label}`;
        pinnedEl.append(chip);
    };

    /**
     * serializeNode(node, refs): 递归把一个 DOM 节点转成 prompt 文本，并按顺序收集引用 selection。
     * 边界：mention chip 还原成带前后空格的 `@label`;<br>/块级元素当作换行;丢失 selection 的孤立 chip 跳过。
     */
    const serializeNode = (node, refs) => {
        if (node.nodeType === Node.TEXT_NODE)
            return node.data;
        if (!(node instanceof HTMLElement))
            return '';
        if (node.tagName === 'BR')
            return '\n';
        if (node.classList.contains('cii-mention')) {
            const refId = node.dataset.refId;
            const selection = refId ? selections.get(refId) : null;
            if (!selection)
                return '';
            refs.push(selection);
            const label = node.dataset.label || '';
            return ` ${label} `;
        }
        let text = '';
        for (const child of node.childNodes)
            text += serializeNode(child, refs);
        // contenteditable 在某些浏览器里用 <div>/<p> 包裹新行，补一个换行边界。
        if (/^(DIV|P)$/.test(node.tagName))
            text += '\n';
        return text;
    };

    return {
        /**
         * render(): 构建并返回本次弹窗的 `.cii-field`(含 pinned chip 容器 + contenteditable)。
         * 边界：每次弹窗都重建 DOM;若已存在 primary 数据则一并渲染 pinned chip。
         *
         * @returns {HTMLElement} 可直接 append 进对话框 body 的字段容器。
         */
        render() {
            fieldEl = el('div', 'cii-field');
            pinnedEl = el('div', 'cii-editor-pinned');
            pinnedEl.hidden = true;
            editorEl = el('div', 'cii-editor');
            editorEl.setAttribute('contenteditable', 'true');
            editorEl.setAttribute('role', 'textbox');
            editorEl.setAttribute('aria-multiline', 'true');
            editorEl.setAttribute('aria-label', 'Change intent');
            editorEl.dataset.placeholder = placeholder;
            editorEl.spellcheck = false;

            ['keyup', 'mouseup', 'input', 'focus'].forEach((eventName) => {
                editorEl.addEventListener(eventName, trackRange);
            });
            editorEl.addEventListener('input', refreshEmptyState);
            editorEl.addEventListener('paste', (event) => {
                // 只接受纯文本粘贴，避免外部富文本污染 contenteditable 结构。
                event.preventDefault();
                const text = event.clipboardData?.getData('text/plain') ?? '';
                const range = readRange() ?? savedRange ?? endRange();
                range.deleteContents();
                const node = document.createTextNode(text);
                range.insertNode(node);
                const after = document.createRange();
                after.setStartAfter(node);
                after.collapse(true);
                savedRange = after.cloneRange();
                focusEditor(after);
                refreshEmptyState();
            });

            fieldEl.append(pinnedEl, editorEl);
            renderPinned();
            refreshEmptyState();
            return fieldEl;
        },

        /**
         * getEditorElement(): 返回 contenteditable 节点，供对话框挂 keydown(提交/Esc)与焦点守卫。
         * @returns {HTMLElement | null}
         */
        getEditorElement() {
            return editorEl;
        },

        /**
         * focus(): 聚焦编辑器并把光标放到末尾。
         * 边界：编辑器未渲染时安全降级。
         */
        focus() {
            if (!editorEl)
                return;
            focusEditor(endRange());
        },

        /**
         * setPrimary(data): 设置/刷新主选择 chip 数据(点击触发、不可删除)。
         * 作用：先用客户端兜底标签即时展示，待服务端 resolve 出 `@path #range` 后再调用一次升级。
         * 边界：仅更新内存与(若已渲染)pinned DOM;不写入 contenteditable，因此不会进入 intent 文本。
         *
         * @param {{ label: string, selection: Record<string, unknown> }} data 主选择标签与 selection。
         */
        setPrimary(data) {
            if (!data || !data.selection) {
                primary = null;
            }
            else {
                primary = { label: String(data.label || '').trim(), selection: data.selection };
            }
            renderPinned();
        },

        /**
         * captureCursor(): 记录当前光标 Range，供“添加代码引用”隐藏弹窗后回到原位插入。
         * @returns {Range | null} 最近一次落在编辑器内的 Range。
         */
        captureCursor() {
            trackRange();
            return savedRange;
        },

        /**
         * hasReference(inspPath): 编辑器内是否已存在该来源的补充引用。
         * 边界：只看 contenteditable 内的 mention，主选择不计入。
         *
         * @param {string} inspPath code-inspector 注入的 `data-insp-path`。
         * @returns {boolean}
         */
        hasReference(inspPath) {
            if (!editorEl || !inspPath)
                return false;
            return Array.from(editorEl.querySelectorAll('.cii-mention')).some((node) => node.dataset.inspPath === inspPath);
        },

        /**
         * insertReference(item): 在光标处行内插入一枚可删除的引用 chip(保留先后顺序)。
         * 作用：替代旧的“置顶 chip 托盘”，让输入到一半再 @ 的内容落在原位置。
         * 边界：label/selection 缺失或重复来源时不插入;插入后更新缓存光标并触发 onChange(供对话框重新定位)。
         *
         * @param {{ label: string, selection: Record<string, unknown>, range?: Range }} item 引用标签、selection 与
         * 可选的插入位置 Range(由对话框在点击 @ 按钮时捕获，避免弹窗恢复时光标被移到末尾)。
         * @returns {boolean} 是否实际插入。
         */
        insertReference(item) {
            const label = String(item?.label || '').trim();
            const selection = item?.selection;
            if (!editorEl || !label || !selection)
                return false;
            if (selection.inspPath && this.hasReference(selection.inspPath))
                return false;

            const refId = `r${++refSeq}`;
            selections.set(refId, selection);
            const mention = createMentionElement(label, {
                refId,
                inspPath: selection.inspPath,
                onRemove: (node) => this.removeMention(node),
            });

            const insideEditor = (range) => range && editorEl.contains(range.commonAncestorContainer);
            const targetRange = insideEditor(item?.range)
                ? item.range
                : insideEditor(savedRange)
                    ? savedRange
                    : endRange();
            const range = targetRange.cloneRange();
            range.deleteContents();
            const fragment = document.createDocumentFragment();
            fragment.append(document.createTextNode(' '), mention, document.createTextNode(' '));
            range.insertNode(fragment);

            const after = document.createRange();
            after.setStartAfter(mention.nextSibling ?? mention);
            after.collapse(true);
            savedRange = after.cloneRange();
            focusEditor(after);
            refreshEmptyState();
            onChange();
            return true;
        },

        /**
         * removeMention(node): 删除一枚补充引用 chip 及其紧邻的占位空格。
         * 边界：节点已脱离 DOM 时安全降级;删除后刷新空态并触发 onChange。
         *
         * @param {HTMLElement} node 由 insertReference 创建的 mention 节点。
         */
        removeMention(node) {
            if (!node || !editorEl?.contains(node))
                return;
            const next = node.nextSibling;
            const prev = node.previousSibling;
            const isSpace = (sibling) => sibling?.nodeType === Node.TEXT_NODE && /^\s$/.test(sibling.data);
            if (isSpace(next))
                next.remove();
            else if (isSpace(prev))
                prev.remove();
            if (node.dataset.refId)
                selections.delete(node.dataset.refId);
            node.remove();
            trackRange();
            refreshEmptyState();
            onChange();
            this.focus();
        },

        /**
         * serialize(): 把编辑器内容导出为 payload 所需的 { intent, references }。
         * 作用：intent = 文本 + 行内 `@path #range`(主选择不含，由服务端从 selection 置顶);references = 按出现
         * 顺序的 selection 列表(claude-app 附文件、codex-app markdown 链接需要)。
         * 边界：折叠多余空格、按行 trim;主选择不在 contenteditable 内，自然被排除。
         *
         * @returns {{ intent: string, references: Array<Record<string, unknown>> }}
         */
        serialize() {
            const refs = [];
            if (!editorEl)
                return { intent: '', references: refs };
            let text = '';
            for (const child of editorEl.childNodes)
                text += serializeNode(child, refs);
            const intent = text
                .replace(/[ \t]+/g, ' ')
                .split('\n')
                .map((line) => line.trim())
                .join('\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            return { intent, references: refs };
        },

        /**
         * exportContent(): 把编辑器内容导出为保序 token 列表，供 pin 折叠后冷恢复(刷新/跨页)精确重建。
         * 作用：与 serialize() 不同，这里保留“文本段”与“引用 chip”的先后结构(而非压平成一段文本)，所以恢复时
         * 不会把行内引用重复成纯文本。主选择不在 contenteditable 内，由 setPrimary 单独恢复。
         * 边界：丢失 selection 的孤立 chip 跳过;空编辑器返回空数组。
         *
         * @returns {Array<{ t: 'text', v: string } | { t: 'ref', label: string, selection: Record<string, unknown> }>} 保序内容 token。
         */
        exportContent() {
            const tokens = [];
            if (!editorEl)
                return tokens;
            const walk = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    if (node.data)
                        tokens.push({ t: 'text', v: node.data });
                    return;
                }
                if (!(node instanceof HTMLElement))
                    return;
                if (node.tagName === 'BR') {
                    tokens.push({ t: 'text', v: '\n' });
                    return;
                }
                if (node.classList.contains('cii-mention')) {
                    const refId = node.dataset.refId;
                    const selection = refId ? selections.get(refId) : null;
                    if (selection)
                        tokens.push({ t: 'ref', label: node.dataset.label || '', selection });
                    return;
                }
                for (const child of node.childNodes)
                    walk(child);
                if (/^(DIV|P)$/.test(node.tagName))
                    tokens.push({ t: 'text', v: '\n' });
            };
            for (const child of editorEl.childNodes)
                walk(child);
            return tokens;
        },

        /**
         * importContent(tokens): 用 exportContent() 的 token 列表重建编辑器内容(冷恢复)。
         * 边界：必须在 render() 之后调用;按顺序追加文本与引用 chip，保持原有先后关系;非数组或空安全降级。
         *
         * @param {Array<Record<string, unknown>>} tokens 由 exportContent() 导出的保序内容 token。
         * @returns {void}
         */
        importContent(tokens) {
            if (!editorEl || !Array.isArray(tokens))
                return;
            for (const token of tokens) {
                if (token?.t === 'text' && token.v) {
                    const range = endRange();
                    const node = document.createTextNode(token.v);
                    range.insertNode(node);
                    const after = document.createRange();
                    after.setStartAfter(node);
                    after.collapse(true);
                    savedRange = after.cloneRange();
                }
                else if (token?.t === 'ref' && token.label && token.selection) {
                    this.insertReference({ label: token.label, selection: token.selection });
                }
            }
            refreshEmptyState();
        },

        /**
         * setDisabled(disabled): 忙碌(resolving/sending)时禁用编辑，避免发送中途被改。
         * @param {boolean} disabled 是否禁用。
         */
        setDisabled(disabled) {
            if (!editorEl)
                return;
            editorEl.setAttribute('contenteditable', disabled ? 'false' : 'true');
            editorEl.classList.toggle('cii-editor-disabled', Boolean(disabled));
        },

        /**
         * reset(): 清空本次弹窗的编辑器状态(文本、引用、主选择、光标缓存)。
         * 边界：只重置内存与(若存在)DOM;新弹窗 render 后需再次 setPrimary。
         */
        reset() {
            primary = null;
            savedRange = null;
            refSeq = 0;
            selections.clear();
            if (editorEl)
                editorEl.innerHTML = '';
            renderPinned();
            refreshEmptyState();
        },
    };
}
