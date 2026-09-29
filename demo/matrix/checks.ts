/**
 * HTTP assertions for one matrix case: bootstrap markers and source-location strings.
 *
 * Purpose: pure fetches against `http://127.0.0.1:<port>`. No process spawning.
 * Script following is one static-import level and at most 30 URLs.
 *
 * Boundary: a marker check is `{ includes, path?, crawl?, match? }`. No `path` and no `crawl`
 * reads the document already fetched. `path` is one GET. `crawl` searches that document, its
 * script URLs, then one import level. `{ session: true }` is the Angular JSON contract.
 * Failure messages include the case id, the URL, and the missing marker.
 * Session tokens are never interpolated into those messages.
 */

/** Markers in one body. `path` is a single GET. `crawl` walks scripts one import deep. */
export type MarkerCheck = {
    includes: string[];
    path?: string;
    crawl?: boolean;
    /** `all` requires every marker in one body. `any` requires one. Used by `crawl`. */
    match?: 'all' | 'any';
};

/** Angular session JSON. Not a substring search. */
export type SessionCheck = { session: true };

export type Check = MarkerCheck | SessionCheck;

/** Same-origin script and import fetches per check. The ready document is not counted. */
const MAX_FETCHES = 30;

/**
 * Dispatch one case check.
 *
 * @param {Check} check Injection or source check. A marker check without `includes` cannot name a miss.
 * @param {{ port: number, label: string, html: string, page: string }} ctx Page facts.
 * @returns {Promise<void>}
 */
export async function runCheck(check: Check, ctx: { port: number, label: string, html: string, page: string }) {
    if ('session' in check && check.session)
        return assertSession(ctx.port, ctx.label);
    const marker = check as MarkerCheck;
    if (marker.crawl)
        return crawlScripts(ctx, marker.includes, marker.match ?? 'all');
    if (marker.path) {
        const url = `http://127.0.0.1:${ctx.port}${marker.path}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        const text = await res.text();
        if (res.status !== 200)
            throw new Error(`${ctx.label}: GET ${url} missing ${marker.includes[0]}`);
        return requireIncludes(text, marker.includes, url, ctx.label);
    }
    return requireIncludes(ctx.html, marker.includes, ctx.page, ctx.label);
}

/**
 * Throw when `body` lacks any required string. The message names the first missing marker.
 *
 * @param {string} body Response text.
 * @param {string[]} includes Markers that must all be present.
 * @param {string} url Absolute URL that produced `body`.
 * @param {string} label Case label.
 * @returns {void}
 */
function requireIncludes(body: string, includes: string[], url: string, label: string) {
    const missing = includes.find((item) => !body.includes(item));
    if (missing)
        throw new Error(`${label}: GET ${url} missing ${missing}`);
}

/**
 * Search the HTML, its same-origin `<script src>` URLs, then one level of static imports.
 * Stops at the first body that satisfies `match`. At most {@link MAX_FETCHES} extra GETs.
 *
 * @param {{ port: number, label: string, html: string, page: string }} ctx Page facts.
 * @param {string[]} includes Markers.
 * @param {'all' | 'any'} match `all` requires every marker in one body; `any` requires one marker.
 * @returns {Promise<void>}
 */
async function crawlScripts(ctx, includes: string[], match: 'all' | 'any') {
    const hit = (body: string) => match === 'any'
        ? includes.some((item) => body.includes(item))
        : includes.every((item) => body.includes(item));
    if (hit(ctx.html))
        return;
    const seen = new Set<string>();
    const bodies = [ctx.html];
    let fetches = 0;
    const level0 = scriptSrcs(ctx.html, ctx.page).filter((item) => !seen.has(item));
    const level1: string[] = [];
    for (const rel of level0) {
        if (fetches >= MAX_FETCHES)
            break;
        seen.add(rel);
        fetches += 1;
        const url = `http://127.0.0.1:${ctx.port}${rel}`;
        const text = await readOk(url);
        if (text == null)
            continue;
        bodies.push(text);
        if (hit(text))
            return;
        for (const child of staticImports(text, url, ctx.port)) {
            if (!seen.has(child))
                level1.push(child);
        }
    }
    for (const rel of level1) {
        if (fetches >= MAX_FETCHES)
            break;
        if (seen.has(rel))
            continue;
        seen.add(rel);
        fetches += 1;
        const text = await readOk(`http://127.0.0.1:${ctx.port}${rel}`);
        if (text == null)
            continue;
        bodies.push(text);
        if (hit(text))
            return;
    }
    const missing = includes.find((item) => !bodies.some((body) => body.includes(item))) ?? includes.join(' + ');
    throw new Error(`${ctx.label}: GET ${ctx.page} missing ${missing}`);
}

/**
 * Angular session: no `Origin`, no `Sec-Fetch-Site`. Requires JSON, a non-empty token, and a
 * relative `clientSrc`. The token value is not copied into the error.
 *
 * @param {number} port Test port.
 * @param {string} label Case label.
 * @returns {Promise<void>}
 */
async function assertSession(port: number, label: string) {
    const url = `http://127.0.0.1:${port}/__intent-inspector/session`;
    const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
    });
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || !type.includes('json'))
        throw new Error(`${label}: GET ${url} missing json`);
    let body: { config?: { token?: unknown }, clientSrc?: unknown };
    try {
        body = await res.json();
    }
    catch {
        throw new Error(`${label}: GET ${url} missing json`);
    }
    if (typeof body?.config?.token !== 'string' || body.config.token.length === 0)
        throw new Error(`${label}: GET ${url} missing token`);
    if (typeof body.clientSrc !== 'string' || !/^\/__intent-inspector\/client\.js\?token=/.test(body.clientSrc))
        throw new Error(`${label}: GET ${url} missing clientSrc`);
}

/**
 * Same-origin `<script src>` paths, in document order.
 *
 * @param {string} html Document.
 * @param {string} page Absolute page URL used to resolve relative srcs.
 * @returns {string[]} Paths beginning with `/`, including the query string.
 */
function scriptSrcs(html: string, page: string) {
    const found: string[] = [];
    const re = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
    for (const match of html.matchAll(re)) {
        const rel = sameOriginPath(match[1] || match[2], page);
        if (rel)
            found.push(rel);
    }
    return found;
}

/**
 * One level of static import specifiers that stay on this dev server.
 * Accepts `/...` plus `./` and `../` resolved against the module URL (bundlers emit both).
 *
 * @param {string} code Module source.
 * @param {string} moduleUrl Absolute URL of `code`.
 * @param {number} port Dev server port. Other ports (the inspector loopback) are ignored.
 * @returns {string[]} Paths beginning with `/`.
 */
function staticImports(code: string, moduleUrl: string, port: number) {
    const found: string[] = [];
    const re = /\bimport(?:\s*\(\s*|\s+[^'"\n]*?\sfrom\s+|\s+)['"]([^'"]+)['"]/g;
    for (const match of code.matchAll(re)) {
        const spec = match[1];
        if (!spec.startsWith('/') && !spec.startsWith('./') && !spec.startsWith('../'))
            continue;
        const rel = sameOriginPath(spec, moduleUrl);
        if (rel && new URL(moduleUrl).port === String(port))
            found.push(rel);
    }
    return found;
}

/**
 * @param {string} raw Src or specifier.
 * @param {string} base Absolute URL of the document or module.
 * @returns {string | null} `pathname` + search on `127.0.0.1` and the same port, or null.
 */
function sameOriginPath(raw: string, base: string) {
    try {
        const url = new URL(raw, base);
        const page = new URL(base);
        if (url.hostname !== '127.0.0.1' || url.port !== page.port)
            return null;
        return `${url.pathname}${url.search}`;
    }
    catch {
        return null;
    }
}

/**
 * @param {string} url Absolute URL.
 * @returns {Promise<string | null>} Body when status is 200, otherwise null.
 */
async function readOk(url: string) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (res.status !== 200)
            return null;
        return await res.text();
    }
    catch {
        return null;
    }
}
