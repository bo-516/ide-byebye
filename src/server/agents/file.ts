import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot } from '../security.js';

/**
 * Filename stamp from an instant, with `:` and the fractional part removed.
 *
 * @param date Instant to format. A non-Date throws on `toISOString`.
 * @returns `YYYY-MM-DDTHH-MM-SS` in UTC.
 */
function fileStamp(date: Date) {
    // 2026-05-24T01-30-00
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/**
 * Markdown file written for a manual handoff.
 *
 * Boundary: `selection` is interpolated without a guard; a request that never went through `buildIntentRequest` throws.
 *
 * @param request Normalized intent request.
 * @param prompt Prompt body already rendered for this agent.
 * @returns Markdown document.
 */
export function renderRequestMarkdown(request: {
    id: string,
    createdAt: string,
    agent: string,
    applyMode: string,
    pageUrl: string,
    selection: { file: string, line: number, column: number },
}, prompt: string) {
    return [
        `# Intent request ${request.id}`,
        '',
        `- Created: ${request.createdAt}`,
        `- Agent: ${request.agent}`,
        `- Apply mode: ${request.applyMode}`,
        `- Page: ${request.pageUrl}`,
        `- Source: ${request.selection.file}:${request.selection.line}:${request.selection.column}`,
        '',
        '## Prompt',
        '',
        prompt.trim(),
        '',
        '## Intent request (JSON)',
        '',
        '```json',
        JSON.stringify(request, null, 2),
        '```',
        '',
    ].join('\n');
}
/**
 * Persist the request + prompt to `.intent-inspector/requests/{stamp}-{id}.md`
 * for manual forwarding, history, and tests. Always available.
 */
export const fileAdapter = {
    name: 'file',
    async isAvailable() {
        return { available: true };
    },
    /**
     * @param request Normalized intent request. `createdAt` must be an ISO string `new Date` accepts.
     * @param context Route context. `outputDir` is the artifact root; `projectRoot` contains it.
     */
    async send(request: {
        id: string,
        createdAt: string,
        agent: string,
        applyMode: string,
        pageUrl: string,
        selection: { file: string, line: number, column: number },
    }, context: {
        emit: (event: { type: string, text?: string }) => void,
        outputDir: string,
        projectRoot: string,
        prompt: string,
    }) {
        context.emit({ type: 'started', text: 'Writing request to disk' });
        const requestsDir = path.join(context.outputDir, 'requests');
        // Defense in depth: the output dir must live under the project root.
        assertPathInsideRoot(requestsDir, context.projectRoot);
        fs.mkdirSync(requestsDir, { recursive: true });
        const fileName = `${fileStamp(new Date(request.createdAt))}-${request.id}.md`;
        const target = path.join(requestsDir, fileName);
        fs.writeFileSync(target, renderRequestMarkdown(request, context.prompt), 'utf8');
        context.emit({ type: 'file-change', text: `Wrote ${target}` });
        context.emit({ type: 'completed', text: 'Request written' });
        return {
            ok: true,
            agent: 'file',
            requestId: request.id,
            output: `Request written to ${target}`,
            writtenPromptPath: target,
        };
    },
};
