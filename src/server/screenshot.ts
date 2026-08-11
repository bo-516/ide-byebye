import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { assertPathInsideRoot } from './security.js';
const SUPPORTED_MIME_TYPES = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
]);
const SCREENSHOT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const SCREENSHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
/** Subdirectory and file extensions for persisted rrweb recordings (event stream + rasterized still). */
const RECORDINGS_SUBDIR = 'recordings';
const RECORDING_EXTENSIONS = new Set(['.json', '.png', '.jpg', '.jpeg', '.webp']);
const SCREENSHOT_FILE_ID_LENGTH = 7;
const SCREENSHOT_FILE_ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Parse a browser screenshot data URL into bytes and file metadata.
 *
 * Boundary: only png, jpeg, and webp image data URLs are accepted. Passing a non-image data URL, unsupported MIME type,
 * or non-base64 payload throws so callers do not write invalid files under the screenshot directory.
 *
 * @param {string} dataUrl Screenshot payload encoded as a browser data URL.
 * @returns {{ mimeType: string, ext: string, bytes: Buffer }} Parsed MIME type, target extension, and binary bytes.
 */
function parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/);
    if (!match)
        throw new Error('Screenshot must be a png, jpeg, or webp data URL');
    const mimeType = match[1];
    const ext = SUPPORTED_MIME_TYPES.get(mimeType);
    if (!ext)
        throw new Error(`Unsupported screenshot MIME type: ${mimeType}`);
    return { mimeType, ext, bytes: Buffer.from(match[2], 'base64') };
}

/**
 * Resolve the screenshot storage directory for one inspector output root.
 *
 * Boundary: this function only joins path segments; callers must still validate the result against `projectRoot`.
 * Passing an absolute `outputDir` keeps the result absolute, while a relative one remains relative to the process cwd.
 *
 * @param {string} outputDir Inspector output directory.
 * @returns {string} Path to the screenshots subdirectory.
 */
function screenshotsDir(outputDir) {
    return path.join(outputDir, 'screenshots');
}

/**
 * Generate a compact random id for screenshot filenames.
 *
 * Boundary: ids are lowercase alpha-numeric and intentionally not stable across requests. Passing a non-positive length
 * would return an empty string and create unusable filenames, so callers rely on the module constant length.
 *
 * @param {number} length Number of characters to generate.
 * @returns {string} Random filename id such as `a1b2c3d`.
 */
function randomScreenshotFileId(length = SCREENSHOT_FILE_ID_LENGTH) {
    return Array.from({ length }, () => SCREENSHOT_FILE_ID_CHARS[randomInt(SCREENSHOT_FILE_ID_CHARS.length)]).join('');
}

/**
 * Write screenshot bytes to a new short random filename.
 *
 * Boundary: files are created with `wx` so an unlikely random-name collision cannot overwrite an existing screenshot.
 * If all attempts collide, the function throws and the send request fails instead of silently reusing a file.
 *
 * @param {string} dir Validated screenshots directory.
 * @param {string} ext File extension without a leading dot.
 * @param {Buffer} bytes Screenshot bytes to persist.
 * @returns {string} Absolute path of the newly written screenshot file.
 */
function writeRandomNamedScreenshot(dir, ext, bytes) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const target = path.join(dir, `${randomScreenshotFileId()}.${ext}`);
        try {
            fs.writeFileSync(target, bytes, { flag: 'wx' });
            return target;
        }
        catch (err) {
            if (err?.code === 'EEXIST')
                continue;
            throw err;
        }
    }
    throw new Error('Unable to create a unique screenshot filename');
}

/**
 * Remove expired screenshot files from the inspector output directory.
 *
 * Boundary: cleanup is best-effort and ignores individual stat/remove failures. Passing the wrong `projectRoot` causes
 * path validation to throw before any files are touched.
 *
 * @param {string} outputDir Inspector output directory.
 * @param {string} projectRoot Vite project root that must contain the screenshot directory.
 * @param {number} nowMs Current timestamp in milliseconds, injectable for tests.
 * @returns {number} Number of expired screenshot files removed.
 */
export function cleanupExpiredScreenshots(outputDir, projectRoot, nowMs = Date.now()) {
    const dir = screenshotsDir(outputDir);
    assertPathInsideRoot(dir, projectRoot);
    if (!fs.existsSync(dir))
        return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile())
            continue;
        if (!SCREENSHOT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            continue;
        const file = path.join(dir, entry.name);
        try {
            const stat = fs.statSync(file);
            if (nowMs - stat.mtimeMs <= SCREENSHOT_MAX_AGE_MS)
                continue;
            fs.rmSync(file, { force: true });
            removed += 1;
        }
        catch {
            // Best-effort cleanup: screenshot retention should not block a send.
        }
    }
    return removed;
}

/**
 * Persist one validated screenshot payload and return metadata used by prompt builders and adapters.
 *
 * Boundary: this writes only under the validated screenshots directory. Missing or malformed payload fields can throw
 * during data URL parsing, while invalid dimensions/timestamps are passed through for consumers that merely display
 * metadata.
 *
 * @param {{ dataUrl: string, scope: string, width?: number, height?: number, capturedAt?: string }} payload Browser screenshot payload.
 * @param {{ projectRoot: string }} request Intent request carrying the trusted project root.
 * @param {string} outputDir Inspector output directory.
 * @returns {{ scope: string, filePath: string, mimeType: string, width?: number, height?: number, capturedAt?: string }} Persisted screenshot metadata.
 */
function writeScreenshotPayload(payload, request, outputDir) {
    const { mimeType, ext, bytes } = parseDataUrl(payload.dataUrl);
    const dir = screenshotsDir(outputDir);
    assertPathInsideRoot(dir, request.projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    const target = writeRandomNamedScreenshot(dir, ext, bytes);
    return {
        scope: payload.scope,
        filePath: target,
        mimeType,
        width: payload.width,
        height: payload.height,
        capturedAt: payload.capturedAt,
    };
}

/**
 * Save a single screenshot payload when present.
 *
 * Boundary: undefined payloads return undefined after cleanup. Passing a malformed payload propagates the parse/write
 * error so the caller can report a failed send instead of building a prompt with a missing image.
 *
 * @param {Record<string, unknown> | undefined} payload Optional browser screenshot payload.
 * @param {{ projectRoot: string }} request Intent request carrying the trusted project root.
 * @param {string} outputDir Inspector output directory.
 * @returns {Record<string, unknown> | undefined} Persisted screenshot metadata, if a payload was supplied.
 */
export function saveScreenshotPayload(payload, request, outputDir) {
    cleanupExpiredScreenshots(outputDir, request.projectRoot);
    if (!payload)
        return undefined;
    return writeScreenshotPayload(payload, request, outputDir);
}

/**
 * Save all screenshot payloads for a request.
 *
 * Boundary: empty or missing arrays return undefined after cleanup. Each payload is written independently with a short
 * random filename, so multiple scopes from one request no longer share the long request id in their names.
 *
 * @param {Array<Record<string, unknown>> | undefined} payloads Optional screenshot payload list.
 * @param {{ projectRoot: string }} request Intent request carrying the trusted project root.
 * @param {string} outputDir Inspector output directory.
 * @returns {Array<Record<string, unknown>> | undefined} Persisted screenshot metadata list, if any payloads were supplied.
 */
export function saveScreenshotPayloads(payloads, request, outputDir) {
    cleanupExpiredScreenshots(outputDir, request.projectRoot);
    if (!payloads?.length)
        return undefined;
    return payloads.map((payload) => writeScreenshotPayload(payload, request, outputDir));
}

/**
 * Resolve the recordings storage directory for one inspector output root.
 *
 * Boundary: only joins path segments; callers must still validate the result against `projectRoot` before writing.
 *
 * @param {string} outputDir Inspector output directory.
 * @returns {string} Path to the recordings subdirectory.
 */
function recordingsDir(outputDir) {
    return path.join(outputDir, RECORDINGS_SUBDIR);
}

/**
 * Remove expired recording artifacts (event JSON + still frames) from the inspector output directory.
 *
 * Boundary: cleanup is best-effort and shares the screenshot max-age window. Passing the wrong `projectRoot` makes path
 * validation throw before any files are touched.
 *
 * @param {string} outputDir Inspector output directory.
 * @param {string} projectRoot Vite project root that must contain the recordings directory.
 * @param {number} nowMs Current timestamp in milliseconds, injectable for tests.
 * @returns {number} Number of expired recording files removed.
 */
export function cleanupExpiredRecordings(outputDir, projectRoot, nowMs = Date.now()) {
    const dir = recordingsDir(outputDir);
    assertPathInsideRoot(dir, projectRoot);
    if (!fs.existsSync(dir))
        return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile())
            continue;
        if (!RECORDING_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            continue;
        const file = path.join(dir, entry.name);
        try {
            const stat = fs.statSync(file);
            if (nowMs - stat.mtimeMs <= SCREENSHOT_MAX_AGE_MS)
                continue;
            fs.rmSync(file, { force: true });
            removed += 1;
        }
        catch {
            // Best-effort cleanup: recording retention should not block a send.
        }
    }
    return removed;
}

/**
 * Persist one recording payload: the rrweb event stream as JSON plus the rasterized still frame.
 *
 * Boundary: only the still frame is later referenced in prompts; the `.rrweb.json` stream is for in-browser human review
 * and is never shown to an agent. The events file and still share one random id for easy on-disk correlation. A missing
 * or malformed still data URL throws during parsing so a failed send is reported rather than persisting a half-recording.
 *
 * @param {{ scope?: string, events?: unknown[], clip?: Record<string, unknown>, durationMs?: number, stillFrame?: { dataUrl: string }, capturedAt?: string }} payload Browser recording payload.
 * @param {{ projectRoot: string }} request Intent request carrying the trusted project root.
 * @param {string} outputDir Inspector output directory.
 * @returns {{ scope: string, eventsPath: string, stillFramePath?: string, clip?: Record<string, unknown>, durationMs?: number, capturedAt?: string }} Persisted recording metadata.
 */
function writeRecordingPayload(payload, request, outputDir) {
    const dir = recordingsDir(outputDir);
    assertPathInsideRoot(dir, request.projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    let id = randomScreenshotFileId();
    let eventsPath = path.join(dir, `${id}.rrweb.json`);
    for (let attempt = 0; attempt < 20 && fs.existsSync(eventsPath); attempt += 1) {
        id = randomScreenshotFileId();
        eventsPath = path.join(dir, `${id}.rrweb.json`);
    }
    fs.writeFileSync(eventsPath, JSON.stringify(payload.events ?? []), 'utf8');
    let stillFramePath;
    if (payload.stillFrame?.dataUrl) {
        const { ext, bytes } = parseDataUrl(payload.stillFrame.dataUrl);
        stillFramePath = path.join(dir, `${id}.${ext}`);
        fs.writeFileSync(stillFramePath, bytes);
    }
    return {
        scope: payload.scope ?? 'recording',
        eventsPath,
        stillFramePath,
        clip: payload.clip,
        durationMs: payload.durationMs,
        capturedAt: payload.capturedAt,
    };
}

/**
 * Save all recording payloads for a request.
 *
 * Boundary: empty or missing arrays return undefined after cleanup. Each recording is written independently. Throws on a
 * malformed still data URL so the caller can report a failed send instead of building a prompt with a missing frame.
 *
 * @param {Array<Record<string, unknown>> | undefined} payloads Optional recording payload list.
 * @param {{ projectRoot: string }} request Intent request carrying the trusted project root.
 * @param {string} outputDir Inspector output directory.
 * @returns {Array<Record<string, unknown>> | undefined} Persisted recording metadata list, if any payloads were supplied.
 */
export function saveRecordingPayloads(payloads, request, outputDir) {
    cleanupExpiredRecordings(outputDir, request.projectRoot);
    if (!payloads?.length)
        return undefined;
    return payloads.map((payload) => writeRecordingPayload(payload, request, outputDir));
}
