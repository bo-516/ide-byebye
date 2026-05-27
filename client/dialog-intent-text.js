/**
 * clampIntentTextIndex(value, max): 把 textarea 光标位置限制在当前文本范围内。
 *
 * 作用：防止隐藏弹窗期间文本变化后继续使用过期 selectionStart/selectionEnd。
 * 边界：value 不是有限数字时回退到文本末尾；max 传错时按 0 处理。
 *
 * @param {number} value 待校验的光标位置。
 * @param {number} max 当前 textarea 文本最大索引。
 * @returns {number} 可安全传给 setSelectionRange 的位置。
 */
function clampIntentTextIndex(value, max) {
    const safeMax = Math.max(0, Number(max) || 0);

    if (!Number.isFinite(value)) {
        return safeMax;
    }

    return Math.min(Math.max(0, value), safeMax);
}

/**
 * readIntentTextRange(textarea, fallback): 读取或回退 textarea 光标范围。
 *
 * 作用：记录用户最后一次在输入框里出现的光标位置，供隐藏选择代码引用后恢复插入点。
 * 边界：textarea 缺失或 selection 字段不可读时使用 fallback；fallback 传错时回到 0。
 *
 * @param {HTMLTextAreaElement | null} textarea 目标输入框。
 * @param {{ start: number, end: number }} fallback 上一次可用光标范围。
 * @returns {{ start: number, end: number }} 规整后的光标范围。
 */
function readIntentTextRange(textarea, fallback = { start: 0, end: 0 }) {
    const max = textarea?.value?.length ?? 0;
    const fallbackStart = clampIntentTextIndex(fallback?.start, max);
    const fallbackEnd = clampIntentTextIndex(fallback?.end, max);

    if (!(textarea instanceof HTMLTextAreaElement)) {
        return { start: fallbackStart, end: fallbackEnd };
    }

    return {
        start: clampIntentTextIndex(textarea.selectionStart, max),
        end: clampIntentTextIndex(textarea.selectionEnd, max),
    };
}

/**
 * createSpacedReferenceInsertText(label, value, start, end): 创建引用标签插入文本。
 *
 * 作用：让 `@src/File.jsx #12-45` 被插入到自然语言句子中时前后有一个语义边界空格。
 * 边界：已有空白不会重复补空格；label 为空时返回空字符串。
 *
 * @param {string} label 展示给用户的引用标签。
 * @param {string} value textarea 当前完整文本。
 * @param {number} start 插入范围起点。
 * @param {number} end 插入范围终点。
 * @returns {string} 可拼进 textarea 的引用文本。
 */
function createSpacedReferenceInsertText(label, value, start, end) {
    const text = String(label || '').trim();

    if (!text) {
        return '';
    }

    const before = String(value || '').slice(0, start);
    const after = String(value || '').slice(end);
    const prefix = /\s$/.test(before) ? '' : ' ';
    const suffix = /^\s/.test(after) ? '' : ' ';

    return `${prefix}${text}${suffix}`;
}

/**
 * createIntentTextController(getTextarea): 创建弹窗意图输入框的光标与引用插入控制器。
 *
 * 作用：在用户点击“添加代码引用”后记录 textarea 光标，并在选中页面元素时把短引用插回原位置。
 * 边界：只修改本地 textarea value，不负责 source payload；payload 仍由 DialogReferenceController 持有。
 *
 * @param {Function} getTextarea 返回当前 textarea；返回空值时 capture/insert 会安全降级。
 * @returns {{ bind: Function, capture: Function, insert: Function, reset: Function }} 输入框控制方法。
 */
export function createIntentTextController(getTextarea) {
    let range = { start: 0, end: 0 };

    const resolveTextarea = () => {
        const textarea = getTextarea?.();

        return textarea instanceof HTMLTextAreaElement ? textarea : null;
    };

    const capture = () => {
        range = readIntentTextRange(resolveTextarea(), range);

        return range;
    };

    return {
        /**
         * bind(textarea): 绑定 textarea 光标追踪事件。
         *
         * 作用：把 click/key/input/select/blur 产生的最后光标同步到 controller。
         * 边界：textarea 传错时不绑定；重复绑定旧节点无副作用，因为每次 render 都会创建新 textarea。
         *
         * @param {HTMLTextAreaElement} textarea 当前弹窗输入框。
         * @returns {void}
         */
        bind(textarea) {
            if (!(textarea instanceof HTMLTextAreaElement)) {
                return;
            }

            const track = () => {
                range = readIntentTextRange(textarea, range);
            };

            ['focus', 'click', 'keyup', 'select', 'input', 'blur'].forEach((eventName) => {
                textarea.addEventListener(eventName, track);
            });
            track();
        },

        capture,

        /**
         * insert(label): 在最后记录的光标处插入一个短代码引用。
         *
         * 作用：把外部 chip 文本改为输入框内部文本，并把光标移动到插入内容之后。
         * 边界：label 为空或 textarea 不存在时不做处理；如果原来选中了一段文本，会用引用替换该范围。
         *
         * @param {string} label 引用标签，例如 `@src/StoryInsightFooterView.jsx #120-150`。
         * @returns {void}
         */
        insert(label) {
            const textarea = resolveTextarea();
            const text = String(label || '').trim();

            if (!textarea || !text) {
                return;
            }

            const value = textarea.value ?? '';
            const currentRange = {
                start: clampIntentTextIndex(range.start, value.length),
                end: clampIntentTextIndex(range.end, value.length),
            };
            const start = Math.min(currentRange.start, currentRange.end);
            const end = Math.max(currentRange.start, currentRange.end);
            const insertText = createSpacedReferenceInsertText(text, value, start, end);
            const cursor = start + insertText.length;

            textarea.value = `${value.slice(0, start)}${insertText}${value.slice(end)}`;
            textarea.setSelectionRange(cursor, cursor);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            range = { start: cursor, end: cursor };
        },

        /**
         * reset(): 清理本次弹窗的光标缓存。
         *
         * 作用：新 intent 打开时避免沿用上一次弹窗中的 textarea 位置。
         * 边界：只重置内存范围，不触碰当前 DOM。
         *
         * @returns {void}
         */
        reset() {
            range = { start: 0, end: 0 };
        },
    };
}
