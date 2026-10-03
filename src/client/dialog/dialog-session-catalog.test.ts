import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSessionCatalog, SESSION_CATALOG_FRESH_MS, SessionCatalogCache } from './dialog-session-catalog.js';
import { DialogSessionController } from './dialog-session-picker.js';
import type { SessionCatalog, SessionMenuView } from './dialog-session-model.js';

/** Catalog with `count` rows. */
function catalog(count: number): SessionCatalog {
    return { sessions: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, title: `Session ${index}` })), delivery: 'prefill' };
}

/**
 * Loader whose answers the test releases by hand, recording every call.
 *
 * @returns {{ load: (agent: string) => Promise<SessionCatalog>, calls: string[], resolve: (res: SessionCatalog) => void,
 *          reject: (err: Error) => void }} The loader and its controls (they settle the latest call).
 */
function manualLoader() {
    const calls: string[] = [];
    const pending: Array<{ resolve: (res: SessionCatalog) => void, reject: (err: Error) => void }> = [];
    return {
        calls,
        load: (agent: string) => {
            calls.push(agent);
            return new Promise<SessionCatalog>((resolve, reject) => pending.push({ resolve, reject }));
        },
        resolve: (res: SessionCatalog) => pending.pop()?.resolve(res),
        reject: (err: Error) => pending.pop()?.reject(err),
    };
}

/** Let queued promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What the paint hook received, with the loading flag and row count only. */
function summarize(views: SessionMenuView[]) {
    return views.map((view) => ({ loading: view.loading === true, rows: view.res?.sessions?.length ?? 0, error: view.error ?? null }));
}

test('a prefetch and an opening menu share one request, and a fresh answer is not fetched again', async () => {
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load);
    cache.prefetch(['codex-app']);
    const joined = cache.fetch('codex-app');
    assert.deepEqual(loader.calls, ['codex-app']);
    loader.resolve(catalog(3));
    assert.equal((await joined).sessions?.length, 3);
    assert.equal(cache.isFresh('codex-app'), true);
    cache.prefetch(['codex-app']);
    assert.deepEqual(loader.calls, ['codex-app']);
});

test('prefetch refetches a stale answer and swallows failures', async () => {
    let clock = 1000;
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load, () => clock);
    cache.prefetch(['grok-build']);
    loader.resolve(catalog(1));
    await flush();
    clock += SESSION_CATALOG_FRESH_MS;
    assert.equal(cache.isFresh('grok-build'), false);
    cache.prefetch(['grok-build']);
    assert.deepEqual(loader.calls, ['grok-build', 'grok-build']);
    loader.reject(new Error('offline'));
    await flush();
    // The failure is not cached; the previous answer stays.
    assert.equal(cache.latest('grok-build')?.sessions?.length, 1);
    assert.equal(cache.inflight.size, 0);
});

test('a fresh prefetched catalog opens at full size with one paint and no request', async () => {
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load);
    cache.prefetch(['codex-app']);
    loader.resolve(catalog(5));
    await flush();
    const views: SessionMenuView[] = [];
    await loadSessionCatalog(cache, 'codex-app', { paint: (view) => views.push(view), isCurrent: () => true });
    assert.deepEqual(summarize(views), [{ loading: false, rows: 5, error: null }]);
    assert.equal(loader.calls.length, 1);
});

test('with nothing cached, an answer that lands quickly is painted without the loading note first', async () => {
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load);
    const views: SessionMenuView[] = [];
    const done = loadSessionCatalog(cache, 'codex-app', { paint: (view) => views.push(view), isCurrent: () => true, waitMs: 200 });
    setTimeout(() => loader.resolve(catalog(4)), 10);
    await done;
    assert.deepEqual(summarize(views), [{ loading: false, rows: 4, error: null }]);
});

test('a slow first answer shows the loading note, then the list', async () => {
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load);
    const views: SessionMenuView[] = [];
    const done = loadSessionCatalog(cache, 'codex-app', { paint: (view) => views.push(view), isCurrent: () => true, waitMs: 5 });
    setTimeout(() => loader.resolve(catalog(2)), 30);
    await done;
    assert.deepEqual(summarize(views), [{ loading: true, rows: 0, error: null }, { loading: false, rows: 2, error: null }]);
});

test('⟳ refetches a fresh catalog under the loading cover, and keeps the rows when it fails', async () => {
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load);
    cache.prefetch(['codex-app']);
    loader.resolve(catalog(3));
    await flush();
    const views: SessionMenuView[] = [];
    const done = loadSessionCatalog(cache, 'codex-app', { refresh: true, paint: (view) => views.push(view), isCurrent: () => true });
    loader.reject(new Error('boom'));
    await done;
    assert.deepEqual(summarize(views), [{ loading: true, rows: 3, error: null }, { loading: false, rows: 3, error: 'boom' }]);
    assert.equal(views[0].overlay, true);
});

test('nothing paints after the menu closes or switches agent', async () => {
    const loader = manualLoader();
    const cache = new SessionCatalogCache(loader.load);
    const views: SessionMenuView[] = [];
    let open = true;
    const done = loadSessionCatalog(cache, 'codex-app', { paint: (view) => views.push(view), isCurrent: () => open, waitMs: 5 });
    open = false;
    const answered = new Promise((resolve) => setTimeout(() => resolve(loader.resolve(catalog(2))), 20));
    await done;
    await answered;
    await flush();
    assert.deepEqual(views, []);
    // The answer is still cached for the next open.
    assert.equal(cache.latest('codex-app')?.sessions?.length, 2);
});

test('the dialog prefetches only the agents GET /agents lists with sessions', async () => {
    const calls: string[] = [];
    const controller = new DialogSessionController({
        api: { sessions: async (agent: string) => (calls.push(agent), catalog(1)) },
        getLastAgent: () => 'codex-app',
        rememberAgent: () => {},
        showError: () => {},
    });
    controller.applyAgentList([
        { name: 'codex-app', sessions: true },
        { name: 'claude-cli', sessions: false },
        { name: 'grok-build', sessions: true },
    ]);
    await flush();
    assert.deepEqual(calls, ['codex-app', 'grok-build']);
    // A second dialog open within the freshness window reuses the answers.
    controller.applyAgentList([{ name: 'codex-app', sessions: true }, { name: 'grok-build', sessions: true }]);
    await flush();
    assert.deepEqual(calls, ['codex-app', 'grok-build']);
    // Without a sessions endpoint (older api doubles) nothing is fetched and nothing throws.
    const bare = new DialogSessionController({ api: {}, getLastAgent: () => '', rememberAgent: () => {}, showError: () => {} });
    bare.applyAgentList([{ name: 'codex-app', sessions: true }]);
});
