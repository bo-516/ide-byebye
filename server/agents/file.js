import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot } from '../security.js';
function fileStamp(date) {
    // 2026-05-24T01-30-00
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}
export function renderRequestMarkdown(request, prompt) {
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
    async send(request, context) {
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
