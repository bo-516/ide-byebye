/**
 * Angular template flattening + element matching for intent source context.
 *
 * Purpose: Angular templates get no `data-insp-path`, so the browser describes the picked element (tag, static-looking
 * attributes, text, and the chain of ancestors its component declared). This module flattens an `@angular/compiler`
 * R3 AST into the elements that actually render DOM and scores each candidate against that description.
 *
 * Boundary: pure — works on already-parsed nodes (duck-typed, so minor compiler shape changes degrade instead of
 * throwing). Blocks (`@if`, `@for`, `@switch`, `@defer`), structural `<ng-template>` wrappers, `<ng-container>` and
 * `<ng-content>` render no element of their own and are treated as transparent. Matching is best effort by design: it
 * returns the highest score and prefers document order on ties.
 */

import { ANGULAR_HINT_ATTRS, type AngularHint, type AngularHintStep } from '../../shared/angular-hint.js';

/** One template element that renders a DOM element. */
export interface TemplateElement {
    tag: string;
    /** Static attributes (lower-cased names). */
    attrs: Record<string, string>;
    /** Classes from the static `class` attribute. */
    classes: string[];
    /** Lower-cased static words of direct text children (interpolations removed). */
    words: string[];
    /** Offsets within the template text; `end` is exclusive. */
    start: number;
    end: number;
    /** Index of the nearest rendered ancestor in the flat list, `-1` at the template root. */
    parent: number;
    /** Index among same-tag rendered siblings of the same parent. */
    sameTagIndex: number;
}

/** Child-bearing properties of R3 nodes (elements, templates and every block kind). */
const CHILD_KEYS = ['children', 'branches', 'groups', 'cases', 'empty', 'placeholder', 'loading', 'error'];

/** Elements that never render a DOM node. */
const TRANSPARENT_TAGS = new Set(['ng-container', 'ng-content', 'ng-template']);

/**
 * Whether an R3 node is an element (`name` + `attributes` + `children`), as opposed to templates, blocks or text.
 *
 * @param {any} node R3 node.
 * @returns {boolean} `true` for elements.
 */
function isElementNode(node) {
    return typeof node?.name === 'string' && Array.isArray(node.attributes) && Array.isArray(node.children) && !!node.sourceSpan;
}

/**
 * Child nodes of any R3 node kind.
 *
 * @param {any} node R3 node.
 * @returns {any[]} Direct children (block branches / cases / sub-blocks included).
 */
function childNodes(node) {
    const out = [];
    for (const key of CHILD_KEYS) {
        const value = node?.[key];
        if (Array.isArray(value))
            out.push(...value);
        else if (value && typeof value === 'object')
            out.push(value);
    }
    return out;
}

/**
 * Static words of an element's direct text children.
 *
 * @param {any[]} children Element children.
 * @param {string} template Template source (for bound text spans).
 * @returns {string[]} Up to 12 lower-cased words of 2+ characters.
 */
function staticWords(children, template: string) {
    const parts = [];
    for (const child of children) {
        if (typeof child?.value === 'string' && !child.name)
            parts.push(child.value);
        else if (child?.value && typeof child.value === 'object' && child.sourceSpan && !child.name)
            parts.push(template.slice(child.sourceSpan.start.offset, child.sourceSpan.end.offset).replace(/\{\{[\s\S]*?\}\}/g, ' '));
    }
    return parts.join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2).slice(0, 12);
}

/**
 * Flatten R3 template nodes into rendered elements, in document order.
 *
 * @param {any[]} nodes `parseTemplate(...).nodes`.
 * @param {string} template Template source the nodes were parsed from.
 * @returns {TemplateElement[]} Rendered elements with parent links.
 */
export function flattenTemplate(nodes, template: string): TemplateElement[] {
    const out: TemplateElement[] = [];
    const visit = (node, parent: number) => {
        if (!isElementNode(node) || TRANSPARENT_TAGS.has(node.name)) {
            for (const child of childNodes(node))
                visit(child, parent);
            return;
        }
        const attrs: Record<string, string> = {};
        for (const attr of node.attributes)
            attrs[String(attr.name).toLowerCase()] = String(attr.value ?? '');
        const sameTagIndex = out.filter((el) => el.parent === parent && el.tag === node.name).length;
        out.push({
            tag: node.name.toLowerCase(),
            attrs,
            classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
            words: staticWords(node.children, template),
            start: node.sourceSpan.start.offset,
            end: node.sourceSpan.end.offset,
            parent,
            sameTagIndex,
        });
        const index = out.length - 1;
        for (const child of node.children)
            visit(child, index);
    };
    for (const node of nodes ?? [])
        visit(node, -1);
    return out;
}

/**
 * Attribute agreement between a template element and a hint step.
 *
 * @param {TemplateElement} el Template element.
 * @param {AngularHintStep} step Browser description.
 * @returns {number} Positive for agreement, negative for contradictions (a static class missing from the DOM).
 */
function attributeScore(el: TemplateElement, step: AngularHintStep) {
    let score = 0;
    if (el.attrs.id)
        score += el.attrs.id === step.id ? 6 : -6;
    const domClasses = new Set(step.classes ?? []);
    for (const name of el.classes)
        score += domClasses.has(name) ? 2 : -3;
    for (const name of ANGULAR_HINT_ATTRS) {
        if (el.attrs[name] === undefined)
            continue;
        score += step.attrs?.[name] === el.attrs[name] ? 2 : -2;
    }
    return score;
}

/**
 * Text agreement: all static words present in the element's rendered text is strong evidence.
 *
 * @param {TemplateElement} el Template element.
 * @param {string | undefined} text Rendered text of the picked element.
 * @returns {number} Score contribution.
 */
function textScore(el: TemplateElement, text: string | undefined) {
    if (!el.words.length || !text)
        return 0;
    const hay = text.toLowerCase();
    const hits = el.words.filter((word) => hay.includes(word)).length;
    if (hits === el.words.length)
        return 4;
    return hits > 0 ? 1 : -2;
}

/**
 * Pick the template element that best matches the browser's description.
 *
 * @param {TemplateElement[]} elements From {@link flattenTemplate}.
 * @param {AngularHint} hint Normalized hint (last path step = picked element).
 * @returns {number} Index into `elements`, or `-1` when no element has the picked tag.
 */
export function matchTemplateElement(elements: TemplateElement[], hint: AngularHint) {
    const target = hint.path[hint.path.length - 1];
    const ancestors = hint.path.slice(0, -1).reverse();
    let best = -1;
    let bestScore = -Infinity;
    elements.forEach((el, index) => {
        if (el.tag !== target.tag)
            return;
        let score = attributeScore(el, target) + textScore(el, hint.text);
        if (target.index != null && el.sameTagIndex === target.index)
            score += 1;
        let parent = el.parent;
        for (const step of ancestors) {
            if (parent < 0 || elements[parent].tag !== step.tag) {
                score -= 1;
                break;
            }
            score += 3 + attributeScore(elements[parent], step) / 2;
            parent = elements[parent].parent;
        }
        if (score > bestScore) {
            bestScore = score;
            best = index;
        }
    });
    return best;
}
