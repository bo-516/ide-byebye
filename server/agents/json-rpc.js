/**
 * Minimal JSON-RPC 2.0 client with a pluggable transport. Used by the Codex
 * App Server adapter. Transports deliver/accept already-parsed framing; for
 * stdio that's newline-delimited JSON, for WebSocket it's one JSON object per
 * message.
 */
export class JsonRpcClient {
    transport;
    nextId = 1;
    pending = new Map();
    notificationHandlers = [];
    closed = false;
    constructor(transport) {
        this.transport = transport;
        transport.onMessage((text) => this.handleMessage(text));
        transport.onClose(() => {
            this.closed = true;
            for (const [, p] of this.pending)
                p.reject(new Error('JSON-RPC transport closed'));
            this.pending.clear();
        });
    }
    handleMessage(text) {
        let message;
        try {
            message = JSON.parse(text);
        }
        catch {
            return;
        }
        if (Array.isArray(message)) {
            for (const m of message)
                this.dispatch(m);
        }
        else {
            this.dispatch(message);
        }
    }
    dispatch(message) {
        if (message == null || typeof message !== 'object')
            return;
        if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new Error(typeof message.error?.message === 'string'
                    ? message.error.message
                    : JSON.stringify(message.error)));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        // Notification or server-initiated request.
        if (typeof message.method === 'string') {
            for (const handler of this.notificationHandlers) {
                handler({ method: message.method, params: message.params });
            }
        }
    }
    request(method, params) {
        if (this.closed)
            return Promise.reject(new Error('JSON-RPC client is closed'));
        const id = this.nextId++;
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                this.transport.send(payload);
            }
            catch (err) {
                this.pending.delete(id);
                reject(err);
            }
        });
    }
    notify(method, params) {
        if (this.closed)
            return;
        this.transport.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }
    onNotification(handler) {
        this.notificationHandlers.push(handler);
    }
    close() {
        this.transport.close();
    }
}
/** WebSocket transport using the global `WebSocket` (Node 22+) or the `ws` pkg. */
export async function createWebSocketTransport(url) {
    let WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
        try {
            const mod = await import(/* @vite-ignore */ 'ws');
            WebSocketCtor = mod.default ?? mod.WebSocket ?? mod;
        }
        catch {
            throw new Error('No WebSocket implementation available. Install the "ws" package.');
        }
    }
    const socket = new WebSocketCtor(url);
    const messageHandlers = [];
    const closeHandlers = [];
    await new Promise((resolve, reject) => {
        const onOpen = () => resolve();
        const onErr = (event) => reject(new Error(`Failed to connect to ${url}: ${event?.message ?? 'connection error'}`));
        if (typeof socket.addEventListener === 'function') {
            socket.addEventListener('open', onOpen, { once: true });
            socket.addEventListener('error', onErr, { once: true });
        }
        else {
            socket.once('open', onOpen);
            socket.once('error', onErr);
        }
    });
    const onMessageRaw = (data) => {
        const text = typeof data === 'string' ? data : data?.data ?? String(data);
        for (const handler of messageHandlers)
            handler(String(text));
    };
    const onCloseRaw = () => {
        for (const handler of closeHandlers)
            handler();
    };
    if (typeof socket.addEventListener === 'function') {
        socket.addEventListener('message', (event) => onMessageRaw(event.data));
        socket.addEventListener('close', onCloseRaw);
    }
    else {
        socket.on('message', (data) => onMessageRaw(data.toString()));
        socket.on('close', onCloseRaw);
    }
    return {
        send: (text) => socket.send(text),
        onMessage: (handler) => messageHandlers.push(handler),
        onClose: (handler) => closeHandlers.push(handler),
        close: () => {
            try {
                socket.close();
            }
            catch {
                // ignore
            }
        },
    };
}
