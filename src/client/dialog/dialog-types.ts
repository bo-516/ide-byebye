/**
 * Shared type surface for the intent dialog and its layers.
 *
 * Purpose: keep the shapes the dialog exchanges with the injected page config and the loopback
 * inspector server in one place so every dialog layer (`dialog-layout`, `dialog-clipboard`,
 * `dialog-send`, `dialog-pins`, `dialog-shell`, `dialog`) type-checks against the same contracts.
 *
 * Boundary: types only — no runtime code. Payload fields the dialog does not read are passed
 * through untouched; each interface documents exactly which keys this side relies on.
 */

/**
 * Fields this dialog reads from the injected page config.
 *
 * Boundary: the live config object has more keys (`token`, `apiOrigin`, …). This class only indexes `enabledAgents`;
 * omitting it makes `send` throw when it checks whether the chosen agent is allowed. Other keys are forwarded as-is
 * to controllers that own them.
 */
export interface BrowserClientConfig {
    /** Agent ids the server will accept. An id outside this list is never offered and is rejected on send. */
    enabledAgents: string[];
}

/** One row of `GET /agents`: whether that adapter can take a prompt right now. */
export interface AgentAvailability {
    name: string;
    available?: boolean;
    /** Server explanation when `available` is false; the dialog shows it verbatim. */
    reason?: string;
}

/** `POST /resolve` JSON. `reference` is whatever the server sends until the dialog checks it is a string. */
export interface ResolveResult {
    ok: boolean;
    error?: string;
    reference?: unknown;
    source?: { astError?: string } | null;
}

/** `deliver` instruction a custom client asks the page to post to its embedding window. */
export interface SendDeliver {
    label?: string;
    windowTarget?: string;
    targetOrigin?: string;
    payload?: Record<string, unknown>;
}

/** `POST /send` JSON. App agents and the clipboard agent share this shape; `output` is prompt text only for clipboard. */
export interface SendResult {
    ok: boolean;
    agent?: string;
    output?: unknown;
    error?: string;
    deliver?: SendDeliver;
}

/**
 * Inspector routes the dialog calls.
 *
 * Boundary: payloads are JSON objects the server validates. A wrong origin or token fails inside these methods; this
 * type only names the three calls the dialog makes and the fields it reads back.
 */
export interface InspectorApi {
    resolve(payload: object): Promise<ResolveResult>;
    send(payload: object): Promise<SendResult>;
    agents(): Promise<{ agents: AgentAvailability[] }>;
}

/**
 * DOM summary collected from the picked element.
 *
 * Boundary: the picker adds tag, text, and path fields the server understands. This class only reads `inspPath`
 * (to re-find the node after a reload); everything else is round-tripped untouched. A missing `inspPath` means the
 * dialog cannot restore the element and degrades to text-only capture.
 */
export interface ElementSelection {
    inspPath?: string;
    [key: string]: unknown;
}

/** Viewport point the dialog opens beside. Missing anchor centers the dialog. */
export interface DialogAnchor {
    x: number;
    y: number;
}

/**
 * The box `positionDialog` and `keepDialogInView` measure and move.
 *
 * Boundary: a real dialog element satisfies this. Only the rect and the inline `left`/`top` are read, so a stand-in
 * with those two fields is enough; anything else on `HTMLElement` is ignored.
 */
export interface DialogBox {
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
    style: { left: string; top: string };
}

/** Inline `@` mention the reference picker asks the editor to insert at the captured caret. */
export interface ReferenceInsert {
    label: string;
    selection: ElementSelection;
    /** Caret captured when the user clicked “add reference”; omitted inserts at the editor’s saved caret. */
    range?: Range | null;
}

/** Light pin draft. Attachments are intentionally absent so it fits in sessionStorage. */
export interface PinnedDraft {
    selection?: ElementSelection | null;
    selector?: string | null;
    anchor?: DialogAnchor | null;
    lastAgent?: string;
    primary?: { label?: string | null; selection?: ElementSelection } | null;
    content?: unknown;
}

/** Dialog lifecycle states the footer lock and send guards key off. */
export type DialogState = 'idle' | 'resolving' | 'sending' | 'failed' | 'completed';

/**
 * Clipboard write started inside the click so the browser still counts it as a user gesture.
 *
 * Boundary: `written` never rejects. `resolveText` / `rejectText` must be called exactly once; leaving them pending
 * waits out the browser’s own gesture timeout.
 */
export interface EagerClipboardWrite {
    resolveText: (value: string) => void;
    rejectText: (reason: Error) => void;
    written: Promise<boolean>;
}
