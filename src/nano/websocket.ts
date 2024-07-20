// Implements Nanocurrency Node Websocket
// Documentation: https://docs.nano.org/integration-guides/websockets

export interface SendEvent {
	from: string;
	to: string;
	amount: string;
	hash: string;
	timestamp: number;
}

export default class NanoWebsocket {
	websocketUrl: string;
	private websocket: WebSocket | null = null;
	private listeners: ((data: SendEvent) => void)[] = [];
	listeningAccounts: string[] = [];
	closedByClient = false;

	constructor(websocketUrl: string) {
		// Using HTTP instead WS to work with fetch
		this.websocketUrl = websocketUrl.replace('ws://', 'http://').replace('wss://', 'https://');
	}

	async connect() {
		if (this.websocket) {
			return this.websocket;
		}

		// Make a fetch request including `Upgrade: websocket` header.
		// The Workers Runtime will automatically handle other requirements
		// of the WebSocket protocol, like the Sec-WebSocket-Key header.
		const resp = await fetch(this.websocketUrl, {
			headers: {
				Upgrade: 'websocket',
			},
		});

		if (!resp.webSocket) {
			throw new Error("server didn't accept WebSocket");
		}

		// If the WebSocket handshake completed successfully, then the
		// response has a `webSocket` property.
		this.websocket = resp.webSocket as WebSocket;

		// Call accept() to indicate that you'll be handling the socket here
		// in JavaScript, as opposed to returning it on to a client.
		this.websocket.accept();

		// keep alive
		const keepAliveInterval = setInterval(() => {
			if (this.websocket?.readyState === WebSocket.READY_STATE_OPEN) {
				this.websocket?.send(JSON.stringify({ ping: 'pong' }));
			} else {
				clearInterval(keepAliveInterval);
			}
		}, 15000);

		this.websocket.addEventListener('message', (msg) => {
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

		// on error clear accounts
		this.websocket.addEventListener('error', () => {
			this.listeningAccounts = [];
		});

		// on close clear accounts
		this.websocket.addEventListener('close', () => {
			this.listeningAccounts = [];
		});

		return this.websocket;
	}

	subscribe(account: string) {
		this.check();

		if (this.listeningAccounts.includes(account)) {
			return;
		}

		const message =
			this.listeningAccounts.length > 0
				? {
						action: 'update',
						topic: 'confirmation',
						options: {
							accounts_add: [account],
						},
				  }
				: {
						action: 'subscribe',
						topic: 'confirmation',
						options: {
							accounts: [account],
						},
				  };

		if (this.websocket) {
			this.websocket.send(JSON.stringify(message));
			this.listeningAccounts.push(account);
		} else {
			throw new Error('WebSocket is not initialized');
		}
	}

	unsubscribe(account: string) {
		this.check();

		if (!this.listeningAccounts.includes(account)) {
			return;
		}

		const message =
			this.listeningAccounts.length > 1
				? {
						action: 'update',
						topic: 'confirmation',
						options: {
							accounts_del: [account],
						},
				  }
				: {
						action: 'unsubscribe',
						topic: 'confirmation',
				  };

		if (this.websocket) {
			this.websocket.send(JSON.stringify(message));
			this.listeningAccounts = this.listeningAccounts.filter((acc) => acc !== account);
		} else {
			throw new Error('WebSocket is not initialized');
		}
	}

	onError(handler: EventListenerOrEventListenerObject<ErrorEvent>) {
		this.check();
		this.websocket?.addEventListener('error', handler);
	}

	onClose(handler: EventListenerOrEventListenerObject<CloseEvent>) {
		this.check();
		this.websocket?.addEventListener('close', handler);
	}

	onPayment(handler: (data: SendEvent) => void) {
		this.listeners.push(handler);
	}

	close() {
		this.check();
		this.closedByClient = true;
		this.websocket?.close();
	}

	check() {
		if (!this.websocket) {
			throw new Error('WebSocket is not initialized');
		}
	}
}
