import { ENDPOINTS } from '../../shared/constants.js';
import { t } from './i18n.js';

/**
 * Cached module promises so each rrweb bundle is fetched/parsed at most once per page.
 * Boundary: a rejected load resets its slot to null so a later retry can re-request after the user installs rrweb or
 * the dev server recovers; concurrent callers before settlement still share the single in-flight promise.
 */
/**
 * rrweb's `record` export, narrowed to the one call the recorder makes.
 * Boundary: options stay an open record because the recorder passes rrweb options the client types do not name. The
 * return is rrweb's stop handle, or `undefined` when rrweb fails to start; the recorder maps that to `null`.
 */
interface RrwebRecordModule {
    record: (options: Record<string, unknown>) => (() => void) | undefined;
}

/**
 * Replayer instance members the still-frame bridge and the viewer call.
 * Boundary: a structural subset of `@rrweb/replay`'s `Replayer` (rrweb is an optional peer, so its types are not
 * imported). `getMetaData` is optional because the still bridge feature-checks it before calling.
 */
interface RrwebReplayer {
    iframe?: HTMLIFrameElement | null;
    pause(timeOffset?: number): void;
    play(timeOffset?: number): void;
    getCurrentTime?(): number;
    getMetaData?(): { totalTime?: number };
}

/**
 * rrweb's `Replayer` constructor.
 * Boundary: events are passed through as recorded; the config stays an open record of rrweb replay options.
 */
interface RrwebReplayModule {
    Replayer: new (events: readonly unknown[], config: Record<string, unknown>) => RrwebReplayer;
}

let recordPromise: Promise<RrwebRecordModule> | null = null;
let replayPromise: Promise<RrwebReplayModule> | null = null;

/**
 * Build the token-authenticated vendor URL for one rrweb bundle.
 *
 * Boundary: `config.apiOrigin` must be the absolute inspector origin so a page served from a business dev domain still
 * imports rrweb from the local inspector server; when it is missing a relative URL is used and follows the page origin.
 * The token is carried in the query string because dynamic `import()` cannot set request headers, and the server needs
 * it to emit cross-origin CORS headers.
 *
 * @param {object} config Browser config injected by the plugin. `object` so the dialog's config (no index signature) assigns.
 * @param {string} name Vendor route name (`record` | `replay`).
 * @returns {string} Absolute or relative ESM URL for the requested bundle.
 */
function vendorUrl(config: object, name: string): string {
    // Cast erases. `apiOrigin` is still read three times, and a missing `token` still becomes the string "undefined".
    const vendor = config as { apiOrigin?: unknown; token?: unknown };
    const base = typeof vendor.apiOrigin === 'string' && vendor.apiOrigin ? vendor.apiOrigin : '';
    return `${base}${ENDPOINTS.vendor}/${name}?token=${encodeURIComponent(vendor.token as string)}`;
}

/**
 * Lazily import the `@rrweb/record` ESM bundle from the inspector vendor route.
 *
 * Boundary: only call this when recording is enabled and actually used; it triggers a network import of a ~160KB module
 * the first time. Rejects with a localized, human-readable error when the host project has not installed rrweb so the
 * dialog can surface it. Returns the module namespace whose `record` export starts a recording.
 *
 * @param {object} config Browser config injected by the plugin.
 * @returns {Promise<RrwebRecordModule>} The `@rrweb/record` module namespace. Never null.
 */
export function loadRrwebRecord(config: object): Promise<RrwebRecordModule> {
    if (!recordPromise) {
        recordPromise = import(/* @vite-ignore */ vendorUrl(config, 'record')).catch((err: unknown) => {
            recordPromise = null;
            throw new Error(t('vendor.record.loadFail', { detail: err instanceof Error ? err.message : String(err) }));
        });
    }
    // The slot is assigned above. `!` erases; the catch only clears it after this return has already captured the promise.
    return recordPromise!;
}

/**
 * Lazily import the `@rrweb/replay` ESM bundle from the inspector vendor route.
 *
 * Boundary: this is the heavier (~410KB) bundle and is needed only for the still-frame bridge and in-dialog playback.
 * Rejects with a human-readable error when rrweb is not installed. Returns the module namespace whose `Replayer` export
 * rebuilds recorded events into a live DOM.
 *
 * @param {object} config Browser config injected by the plugin.
 * @returns {Promise<RrwebReplayModule>} The `@rrweb/replay` module namespace. Never null.
 */
export function loadRrwebReplay(config: object): Promise<RrwebReplayModule> {
    if (!replayPromise) {
        replayPromise = import(/* @vite-ignore */ vendorUrl(config, 'replay')).catch((err: unknown) => {
            replayPromise = null;
            throw new Error(t('vendor.replay.loadFail', { detail: err instanceof Error ? err.message : String(err) }));
        });
    }
    return replayPromise!;
}
