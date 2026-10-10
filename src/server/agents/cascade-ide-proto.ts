/**
 * Minimal protobuf wire encoder for the Devin / Windsurf "Cascade" chat-panel protocol.
 *
 * The IDE chat panel consumes `SendActionToChatPanelRequest` (exa.chat_client_server_pb) whose `payload`
 * entries are serialized `AddCascadeInputRequest` / `SendCascadeInputRequest` messages holding
 * `TextOrScopeItem` (exa.codeium_common_pb) items. Only the fields this bridge uses are encoded:
 *
 *   SendActionToChatPanelRequest: 1 action_type (string), 2 payload (repeated bytes)
 *   Add/SendCascadeInputRequest:  1 items (repeated TextOrScopeItem), 2 images (repeated, unused)
 *   TextOrScopeItem:              1 text (string, oneof chunk), 2 item (ScopeItem, unused)
 *
 * Boundary: pure encoding — no I/O, no page data outside the caller's message string.
 */

/**
 * Unsigned varint bytes.
 *
 * @param {number} value Non-negative integer (safe range).
 * @returns {number[]} Varint octets.
 */
function varint(value: number) {
    const out: number[] = [];
    let v = Math.max(0, Math.floor(value));
    while (v > 0x7f) {
        out.push((v & 0x7f) | 0x80);
        v = Math.floor(v / 128);
    }
    out.push(v & 0x7f);
    return out;
}

/**
 * One length-delimited field: `<tag><len><bytes>`.
 *
 * Boundary: only wire type 2 (LEN) is emitted — every field this bridge writes is a string, bytes, or
 * an embedded message.
 *
 * @param {number} fieldNo Protobuf field number.
 * @param {Uint8Array} body Field payload.
 * @returns {Uint8Array} Encoded field.
 */
function lenField(fieldNo: number, body: Uint8Array) {
    const tag = varint((fieldNo << 3) | 2);
    const len = varint(body.length);
    const out = new Uint8Array(tag.length + len.length + body.length);
    out.set(tag, 0);
    out.set(len, tag.length);
    out.set(body, tag.length + len.length);
    return out;
}

/**
 * `TextOrScopeItem` with only the `text` oneof member set.
 *
 * @param {string} text Prompt fragment.
 * @returns {Uint8Array} Serialized item.
 */
export function encodeCascadeTextItem(text: string) {
    return lenField(1, new TextEncoder().encode(text));
}

/**
 * `AddCascadeInputRequest` / `SendCascadeInputRequest` (identical field lists) holding text items only.
 *
 * Boundary: each text entry becomes one `items` element. `images` is left empty — field 2 is never emitted.
 *
 * @param {string[]} texts Item texts (normally a single full prompt).
 * @returns {Uint8Array} Serialized request.
 */
export function encodeCascadeInputRequest(texts: string[]) {
    const parts = (texts ?? [])
        .filter((text) => typeof text === 'string' && text.length > 0)
        .map((text) => lenField(1, encodeCascadeTextItem(text)));
    const size = parts.reduce((total, part) => total + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/**
 * JSON argument for `<prefix>.sendChatActionMessage`: the request with one payload entry per inner message.
 *
 * Boundary: `payload` items are base64 because the workbench parses `SendActionToChatPanelRequest` with
 * protobuf-es `fromJsonString`, which encodes `bytes` fields as base64 strings.
 *
 * @param {string} actionType Chat-panel action (`addCascadeInput`, `sendCascadeInputNewConversation`, …).
 * @param {Uint8Array[]} payloads Serialized inner request(s).
 * @returns {string} JSON string suitable as the command's single argument.
 */
export function buildChatActionJson(actionType: string, payloads: Uint8Array[]) {
    return JSON.stringify({
        actionType,
        payload: (payloads ?? []).map((body) => Buffer.from(body).toString('base64')),
    });
}

/** Chat-panel action that inserts items into the composer's draft input (no submit). */
export const CASCADE_ACTION_INSERT = 'addCascadeInput';
/** Chat-panel action that submits the items as a user message in a new conversation. */
export const CASCADE_ACTION_SUBMIT_NEW = 'sendCascadeInputNewConversation';

/**
 * Command argument that places `message` in the cascade input without submitting.
 *
 * @param {string} message Prompt text.
 * @returns {string} `SendActionToChatPanelRequest` JSON for `sendChatActionMessage`.
 */
export function buildInsertMessageArgument(message: string) {
    return buildChatActionJson(CASCADE_ACTION_INSERT, [encodeCascadeInputRequest([message])]);
}

/**
 * Command argument that submits `message` as a new conversation.
 *
 * @param {string} message Prompt text.
 * @returns {string} `SendActionToChatPanelRequest` JSON for `sendChatActionMessage`.
 */
export function buildSubmitMessageArgument(message: string) {
    return buildChatActionJson(CASCADE_ACTION_SUBMIT_NEW, [encodeCascadeInputRequest([message])]);
}
