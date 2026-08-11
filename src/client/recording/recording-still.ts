import { PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { loadRrwebReplay } from '../lib/vendor-loader.js';
import { rasterizeNode } from '../screenshot/screenshot.js';
import { t } from '../lib/i18n.js';

/** rrweb `EventType.Meta` numeric tag; carries the recorded viewport size. */
const RRWEB_META_EVENT = 4;

/**
 * Read the recorded viewport size from an rrweb event stream.
 * Boundary: scans for the first Meta event (`type === 4`) with a positive width; recordings always emit one before the
 * full snapshot. Returns null when absent so callers fall back to a default box.
 * @param {Array<Record<string, unknown>>} events rrweb event stream.
 * @returns {{ width: number, height: number } | null} Recorded viewport size, or null when not found.
 */
function recordedViewport(events) {
    for (const event of events) {
        const data = event && typeof event === 'object' ? event.data : null;
        if (event?.type === RRWEB_META_EVENT && data && Number(data.width) > 0) {
            return { width: Math.ceil(Number(data.width)), height: Math.ceil(Number(data.height)) };
        }
    }
    return null;
}

/** Wait ~two animation frames (with a hidden-tab `setTimeout` fallback) so the rebuilt DOM/layout settles. */
function twoFrames() {
    return new Promise<any>((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            resolve(undefined);
        };
        window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
        window.setTimeout(finish, 150);
    });
}

/**
 * Resolve the solid background color behind a recorded frame from the replayed document body.
 * Boundary: transparent/missing backgrounds fall back to white so the still is never rendered on a transparent canvas.
 * @param {Document} doc Replay iframe document.
 * @returns {string} Opaque CSS color.
 */
function replayBackground(doc) {
    const win = doc.defaultView;
    const value = win && doc.body ? win.getComputedStyle(doc.body).backgroundColor : '';
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') {
        return '#ffffff';
    }
    return value;
}

/**
 * Find the scope target node inside the replay document.
 * Boundary: an empty/unmatched selector falls back to `body` (whole page). The selector is the one produced by
 * `uniqueSelector` against the live page; rrweb rebuilds the same structure/attributes so it matches in the replay.
 * @param {Document} doc Replay iframe document.
 * @param {string | undefined} scopeSelector Selector locating the recorded scope's node.
 * @returns {Element} The scope node, or the document body.
 */
function findScopeNode(doc, scopeSelector) {
    if (scopeSelector) {
        try {
            const found = doc.querySelector(scopeSelector);
            if (found)
                return found;
        }
        catch {
            // malformed selector -> fall back to body
        }
    }
    return doc.body;
}

/**
 * Build a serializable XHTML wrapper for one replayed node (the scope subtree) for `<foreignObject>` rasterization.
 *
 * Boundary: reuses rrweb's already-inlined `<style>`/images (recorded with `inlineStylesheet`/`inlineImages`) instead of
 * per-node computed styles, which is both faithful and fast. For the whole-page fallback (`node === body`) the body is
 * re-hosted in a `div` carrying its class/style so class-based rules still match; for a specific element the node is
 * cloned directly and its positioning is normalized to the wrapper origin. Scripts and any inspector-owned nodes are
 * stripped.
 *
 * @param {Document} doc Replay iframe document (source of the `<style>` rules).
 * @param {Element} node Scope node to render.
 * @param {number} width Wrapper width in CSS pixels.
 * @param {number} height Wrapper height in CSS pixels.
 * @returns {HTMLDivElement} XHTML-namespaced wrapper ready for `rasterizeNode`.
 */
function buildReplayWrapper(doc, node, width, height) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = `width:${width}px;height:${height}px;overflow:hidden;position:relative;`;
    for (const styleEl of doc.querySelectorAll('style')) {
        wrapper.append(styleEl.cloneNode(true));
    }
    let content;
    if (node === doc.body) {
        content = document.createElement('div');
        content.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        const bodyClass = doc.body.getAttribute('class');
        if (bodyClass)
            content.setAttribute('class', bodyClass);
        content.setAttribute('style', `${doc.body.getAttribute('style') || ''};margin:0;position:relative`);
        const bodyClone = doc.body.cloneNode(true);
        while (bodyClone.firstChild)
            content.append(bodyClone.firstChild);
    }
    else {
        content = node.cloneNode(true);
        if (content instanceof HTMLElement) {
            content.style.position = 'static';
            content.style.left = 'auto';
            content.style.top = 'auto';
            content.style.right = 'auto';
            content.style.bottom = 'auto';
            content.style.margin = '0';
            content.style.transform = 'none';
        }
    }
    if (content.querySelectorAll) {
        content.querySelectorAll('script').forEach((scriptNode) => scriptNode.remove());
        content.querySelectorAll(`[${PLUGIN_NODE_ATTR}]`).forEach((pluginNode) => pluginNode.remove());
    }
    wrapper.append(content);
    return wrapper;
}

/**
 * Rebuild an rrweb recording offscreen, freeze it at one moment, and rasterize the scoped subtree into a still image.
 *
 * This is the bridge that makes a recording legible to an AI agent: rrweb has no native "frame to image" API, so the
 * events are replayed into a detached, offscreen iframe sized to the recorded viewport, paused at `tOffsetMs`, the scope
 * node is measured and its subtree serialized (reusing rrweb's inlined `<style>`/images), then handed to the shared
 * `rasterizeNode` SVG-foreignObject rasterizer. Sizing the iframe explicitly is required because the bare `@rrweb/replay`
 * engine leaves it at 0×0 until playback advances, which would make every measured rect zero.
 *
 * Boundary: requires `@rrweb/replay` (lazy-loaded). Cross-origin assets rrweb could not inline, and `canvas`/WebGL pixels
 * (recording them is off in v1), are blank in the still — same limit as DOM screenshots. The inspector's own UI is never
 * in the recording (blocked at record time). The offscreen host is always removed, even on failure. `tOffsetMs` is
 * clamped into the recording timeline.
 *
 * @param {Record<string, unknown>} config Browser config injected by the plugin (token/apiOrigin for lazy load).
 * @param {Array<Record<string, unknown>>} events rrweb event stream for the (already clipped) segment.
 * @param {number} tOffsetMs Millisecond offset from the segment start to freeze and capture.
 * @param {{ blockClass?: string, scopeSelector?: string }} [options] Replay block class and the scope node selector.
 * @returns {Promise<{ dataUrl: string, width: number, height: number }>} Encoded still-frame image payload.
 */
export async function captureRecordingStill(config, events, tOffsetMs, options: any = {}) {
    if (!Array.isArray(events) || events.length === 0) {
        throw new Error(t('recording.still.empty'));
    }
    const { Replayer } = await loadRrwebReplay(config);
    const host = document.createElement('div');
    host.setAttribute(PLUGIN_NODE_ATTR, '');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(host);
    try {
        const replayer = new Replayer(events, {
            root: host,
            speed: 1,
            mouseTail: false,
            showWarning: false,
            showDebug: false,
            useVirtualDom: false,
            blockClass: options.blockClass || 'rr-block',
        });
        const viewport = recordedViewport(events) || { width: 1280, height: 800 };
        const iframe = replayer.iframe;
        if (iframe) {
            iframe.setAttribute('width', String(viewport.width));
            iframe.setAttribute('height', String(viewport.height));
            iframe.style.width = `${viewport.width}px`;
            iframe.style.height = `${viewport.height}px`;
        }
        const total = typeof replayer.getMetaData === 'function' ? Number(replayer.getMetaData().totalTime) : NaN;
        const requested = Number(tOffsetMs);
        const target = Number.isFinite(requested) ? Math.max(0, requested) : 0;
        const clamped = Number.isFinite(total) && total > 0 ? Math.min(target, total) : target;
        replayer.pause(clamped);
        await twoFrames();
        const doc = iframe?.contentDocument;
        if (!doc || !doc.body) {
            throw new Error(t('recording.still.replayUnavailable'));
        }
        const node = findScopeNode(doc, options.scopeSelector);
        let width = viewport.width;
        let height = viewport.height;
        if (node !== doc.body) {
            const rect = node.getBoundingClientRect();
            if (rect.width >= 1 && rect.height >= 1) {
                width = Math.ceil(rect.width);
                height = Math.ceil(rect.height);
            }
        }
        const background = replayBackground(doc);
        const wrapper = buildReplayWrapper(doc, node, width, height);
        return await rasterizeNode(wrapper, width, height, background);
    }
    finally {
        host.remove();
    }
}
