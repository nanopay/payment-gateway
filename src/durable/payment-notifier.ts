import { DurableObject } from 'cloudflare:workers';
import { logger } from '../logger';
import { MAX_PAYMENTS_PER_INVOICE, MAX_WEBSOCKET_SESSIONS_PER_PAYMENT_NOTIFIER } from '../constants';

export type PaymentNotification = {
	from: string;
	to: string;
	amount: number;
	hash: string;
	timestamp: number;
};

/*
 * PaymentNotifier implements a Durable Object that coordinates notifications for an individual invoice.
 * Participants connect to the notifier using WebSockets, and the notifier broadcasts the payments for them.
 * The notifier only start to respond websockets connections after started.
 * It auto hibernates when no messages are being sent and resume when notify is called.
 */
export class PaymentNotifier extends DurableObject<Env> {
	sessions = new Set<WebSocket>();
	state: DurableObjectState;
	storage: DurableObjectStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.state = ctx;
		this.storage = ctx.storage;

		this.state.getWebSockets().forEach((webSocket) => {
			this.sessions.add(webSocket);
		});
	}

	async fetch(request: Request) {
		// We only accept WebSocket requests.
		if (request.headers.get('Upgrade') != 'websocket') {
			return new Response('expected websocket', { status: 400 });
		}

		const started = await this.storage.get('started');
		if (started !== 'true') {
			logger.debug('Payment notifier not started');
			return new Response('not started', { status: 503 });
		}

		if (this.sessions.size >= MAX_WEBSOCKET_SESSIONS_PER_PAYMENT_NOTIFIER) {
			logger.debug('Too many sessions');
			return new Response('too many sessions', { status: 503 });
		}

		// To accept the WebSocket request, we create a WebSocketPair
		const pair = new WebSocketPair();

		// We're going to take pair[1] as our end, and return pair[0] to the client.
		await this.handleSession(pair[1]);

		// Now we return the other end of the pair to the client.
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	async start() {
		await this.storage.put('started', 'true');
		logger.debug('Started payment notifier');
	}

	async stop() {
		this.sessions.forEach((session) => {
			session.close();
		});
		await this.clear();
		logger.debug('Stopped payment notifier');
	}

	private async clear() {
		this.sessions.clear();
		await this.storage.deleteAll();
	}

	private async handleSession(webSocket: WebSocket) {
		// Accept our end of the WebSocket. This tells the runtime that we'll be terminating the
		// WebSocket in JavaScript, not sending it elsewhere.
		this.state.acceptWebSocket(webSocket);

		this.sessions.add(webSocket);

		// Load the last 10 payments from the history stored on disk, and send them to the
		// client.
		const payments = await this.storage.list<Record<any, any>>({ reverse: true, limit: MAX_PAYMENTS_PER_INVOICE, prefix: 'payment_' });
		[...payments.values()].forEach((value) => {
			webSocket.send(JSON.stringify(value));
		});
	}

	// On "close" and "error" events, remove the WebSocket from the sessions list and broadcast
	// a quit message.
	private async closeOrErrorHandler(webSocket: WebSocket) {
		this.sessions.delete(webSocket);
	}

	// Implement DurableObject's webSocketClose event.
	async webSocketClose(webSocket: WebSocket, code: number, reason: string, wasClean: boolean) {
		this.closeOrErrorHandler(webSocket);
	}

	// Implement DurableObject's webSocketError event.
	async webSocketError(webSocket: WebSocket, error: unknown) {
		this.closeOrErrorHandler(webSocket);
	}

	// Broadcasts a payment to all clients.
	private async broadcast(payment: PaymentNotification) {
		// Iterate over all the sessions sending them messages.
		this.sessions.forEach((session) => {
			try {
				session.send(JSON.stringify(payment));
			} catch (err) {
				// Whoops, this connection is dead. Remove it from the map
				this.sessions.delete(session);
			}
		});
	}

	public async notify(payment: PaymentNotification) {
		// Store the payment in the history.
		await this.storage.put(`payment_${payment.hash}`, payment);

		// Broadcast the payment to all clients.
		this.broadcast(payment);
	}
}
