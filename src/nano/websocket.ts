interface SendEvent {
	from: string;
	to: string;
	amount: string;
	hash: string;
	timestamp: number;
}

export default class NanoWebsocket {
	wsURL: string;
	private ws: WebSocket | null = null;
	private listeners: ((data: SendEvent) => void)[] = [];
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

		// keep alive
		const keepAliveInterval = setInterval(() => {
			if (this.ws?.readyState === WebSocket.READY_STATE_OPEN) {
				this.ws?.send(JSON.stringify({ ping: 'pong' }));
			} else {
				clearInterval(keepAliveInterval);
			}
		}, 15000);

		this.ws.addEventListener('message', (msg) => {
			const data = JSON.parse(msg.data as string);
			if (data.message?.block?.subtype === 'send') {
				this.listeners.forEach((listener) => {
					listener({
						from: data.message.block.account,
						amount: data.message.amount,
						hash: data.message.hash,
						to: data.message.block.link_as_account,
						timestamp: Number(data.time),
					});
				});
			}
		});

		return this.ws;
	}

	subscribe(account: string) {
		this.check();

		const confirmation_subscription = {
			action: 'subscribe',
			topic: 'confirmation',
			options: {
				accounts: [account],
			},
		};

		this.ws?.send(JSON.stringify(confirmation_subscription));
	}

	unsubscribe(account: string) {
		this.check();

		const confirmation_subscription = {
			action: 'unsubscribe',
			topic: 'confirmation',
			options: {
				accounts: [account],
			},
		};

		this.ws?.send(JSON.stringify(confirmation_subscription));
	}

	onError(handler: EventListenerOrEventListenerObject<ErrorEvent>) {
		this.check();
		this.ws?.addEventListener('error', handler);
	}

	onClose(handler: EventListenerOrEventListenerObject<CloseEvent>) {
		this.check();
		this.ws?.addEventListener('close', handler);
	}

	onPayment(handler: (data: SendEvent) => void) {
		this.listeners.push(handler);
	}

	close() {
		this.check();
		this.closedByClient = true;
		this.ws?.close();
	}

	check() {
		if (!this.ws) {
			throw new Error('WebSocket is not initialized');
		}
	}
}
