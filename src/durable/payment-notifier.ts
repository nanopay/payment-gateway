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

export const PAYMENT_NOTIFIER_CLOSE_REASON_CODE = {
	PAID: 1000, // Normal closure: Payment completed
	EXPIRED: 4001, // Custom: Payment expired
	TOO_MANY_PAYMENTS: 4002, // Custom: Too many payment attempts
};

export type PaymentNotifierCloseReason = keyof typeof PAYMENT_NOTIFIER_CLOSE_REASON_CODE;

/*
 * PaymentNotifier implements a Durable Object that coordinates notifications for an individual invoice.
 * Participants connect to the notifier using WebSockets, and the notifier broadcasts the payments for them.
 * The notifier only start to respond websockets connections after started.
 * It auto hibernates when no messages are being sent and resume when notify is called.
 */
export class PaymentNotifier extends DurableObject<Env> {
	sessions = new Set<WebSocket>();
	startPromises = new Set<{ promise: Promise<void>; start: () => void }>();
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
			let start = () => {};
			const promise = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject('timeout');
				}, 10000);
				start = () => {
					resolve();
					clearTimeout(timeout);
				};
			});
			const startPromise = { promise, start };
			this.startPromises.add(startPromise);

			try {
				await promise;
			} catch {
				logger.debug('Timeout: Payment notifier not started');
				return new Response('timeout', { status: 503 });
			} finally {
				this.startPromises.delete(startPromise);
			}
		}

		if (this.sessions.size >= MAX_WEBSOCKET_SESSIONS_PER_PAYMENT_NOTIFIER) {
			logger.debug('Too many sessions');
			return new Response('too many sessions', { status: 503 });
		}

		const [client, server] = Object.values(new WebSocketPair());

		await this.handleSession(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	async start() {
		if (this.startPromises) {
			this.startPromises.forEach((startPromise) => {
				startPromise.start();
			});
		}
		await this.storage.put('started', 'true');
		logger.debug('Started payment notifier');
	}

	async stop(reason: PaymentNotifierCloseReason) {
		const code = PAYMENT_NOTIFIER_CLOSE_REASON_CODE[reason];
		this.sessions.forEach((session) => {
			session.close(code, reason);
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
