import { buildPromptReferenceLines } from '../prompt.js';
import { buildPromptMarkdownReferenceLines } from '../prompt-markdown.js';
import { buildStyleContextLines } from '../styles.js';

/**
 * Build Codex App prompt parts while de-duplicating inline code references.
 *
 * Boundary: replacements are derived from server-resolved references, so user-written text that merely resembles a
 * reference is left alone unless it exactly matches a known label. References already present in the intent are removed
 * from the top context block so Codex App does not receive the same file link twice.
 *
 * @param {Record<string, unknown>} request Normalized intent request containing `intent` and resolved references.
 * @returns {{ refs: string[], intent: string }} Top context refs and intent text safe for a Codex App deeplink.
 */
function codexAppPromptParts(request) {
    let intent = String(request.intent ?? '').trim();
    // Codex App rewrites plain `@path` chips into Markdown links. Matching must use project-relative forms so they
    // line up with what the mention editor serializes and with `buildPromptMarkdownReferenceLines` (which is always
    // relative). Global `artifactPathStyle: 'absolute'` only affects plain `@` agents (clipboard / file / Grok).
    const sourceRefs = buildPromptReferenceLines(request, {
        pathStyle: 'relative',
        artifactPathStyle: 'relative',
    });
    const markdownRefs = buildPromptMarkdownReferenceLines(request);
    const inlineRefs = new Set();

    sourceRefs.forEach((sourceRef, index) => {
        const markdownRef = markdownRefs[index];
        if (!sourceRef || !markdownRef)
            return;
        if (intent.includes(sourceRef) || intent.includes(markdownRef)) {
            inlineRefs.add(index);
        }
        if (!sourceRef.startsWith('@') || !markdownRef.startsWith('[') || !intent.includes(sourceRef))
            return;
        intent = intent.split(sourceRef).join(markdownRef);
    });

    return {
        refs: markdownRefs.filter((ref, index) => ref && !inlineRefs.has(index)),
        intent,
    };
}

/**
 * Build the prompt text sent directly into Codex App.
 *
 * Boundary: Codex App rewrites `@file #range` text in its editor, so this prompt uses Markdown file links for code
 * references while preserving the user's intent verbatim after trimming. Missing intent still returns a trailing
 * newline so deeplink decoding behaves consistently.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @returns {string} Codex App prompt ending with a newline.
 */
export function buildCodexAppPrompt(request) {
    const { refs, intent } = codexAppPromptParts(request);
    const styleLines = buildStyleContextLines(request);
    const top = refs.length && styleLines.length ? [...refs, '', ...styleLines] : [...refs, ...styleLines];
    return [...top, ...(top.length ? [''] : []), intent].join('\n').trim() + '\n';
}

/**
 * Build the short Codex App prompt used when full context is written to disk.
 *
 * Boundary: code references use the same Markdown link syntax as direct deeplinks, then point at the written prompt
 * file. Passing an empty prompt path makes the app prompt omit the handoff file, so callers should only use a path
 * returned by the adapter's prompt writer.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {string} promptPath Absolute prompt file path written under the inspector output directory.
 * @returns {string} Codex App handoff prompt ending with a newline.
 */
export function buildCodexAppFilePrompt(request, promptPath) {
    // The full request context (including any captured styles) is written to the handoff file, so this short prompt
    // stays compact and does not inline the style block.
    const { refs, intent } = codexAppPromptParts(request);
    return [...refs, promptPath, '', intent].join('\n').trim() + '\n';
}
