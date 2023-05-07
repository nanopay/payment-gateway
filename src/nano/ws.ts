interface SendEvent {
    from: string;
    to: string;
    amount: string;
    hash: string;
    timestamp: number;
}

export default class NanoWebsocket {

    wsURL: string;
    ws: WebSocket | null = null;
    listeners: ((data: SendEvent) => void)[] = []
    closedByClient = false;

    constructor(wsUrl: string) {
        // Using HTTP instead WS to work with fetch 
        this.wsURL = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    }

    async connect() {

        if (this.ws) {
            return this.ws;
        }

        // Make a fetch request including `Upgrade: websocket` header.
        // The Workers Runtime will automatically handle other requirements
        // of the WebSocket protocol, like the Sec-WebSocket-Key header.
        let resp = await fetch(this.wsURL, {
            headers: {
                Upgrade: 'websocket',
            },
        });

        if (!resp.webSocket) {
            throw new Error("server didn't accept WebSocket");
        }

        // If the WebSocket handshake completed successfully, then the
        // response has a `webSocket` property.
        this.ws = resp.webSocket;

        // Call accept() to indicate that you'll be handling the socket here
        // in JavaScript, as opposed to returning it on to a client.
        this.ws.accept();

        this.ws.addEventListener('message', (msg) => {
            const data = JSON.parse(msg.data as string);
            if (data.message?.block?.subtype === 'send') {
                this.listeners.forEach((listener) => {
                    listener({
                        from: data.message.block.account,
                        amount: data.message.amount,
                        hash: data.message.hash,
                        to: data.message.block.link_as_account,
                        timestamp: Number(data.time)
                    });
                })

            }
        })

        return this.ws;
    }

    async subscribe(account: string) {

        this.check();

        const confirmation_subscription = {
            "action": "subscribe",
            "topic": "confirmation",
            "options": {
                "accounts": [account]
            }
        }

        // Now you can send and receive messages like before.
        this.ws?.send(JSON.stringify(confirmation_subscription));
    }

    onError(handler: EventListenerOrEventListenerObject<ErrorEvent>) {
        this.check();
        this.ws?.addEventListener('error', handler)
    }

    onClose(handler: EventListenerOrEventListenerObject<CloseEvent>) {
        this.check();
        this.ws?.addEventListener('close', (handler))
    }

    onPayment(handler: (data: SendEvent) => void) {
        this.listeners.push(handler)
    }

    close() {
        this.check();
        this.closedByClient = true;
        this.ws?.close();
    }

    check() {
        if (!this.ws) {
            throw new Error("WebSocket is not initialized");
        }
    }

}