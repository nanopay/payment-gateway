import { DurableObject } from 'cloudflare:workers';
import { SendEvent } from '../nano/websocket';

type Payment = SendEvent;

/*
 * PaymentNotifier implements a Durable Object that coordinates notifications for an individual invoice.
 * Participants connect to the notifier using WebSockets, and the notifier broadcasts the payments for them.
 * The notifier is created by the PaymentListener when a new invoice is created.
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

		// To accept the WebSocket request, we create a WebSocketPair
		const pair = new WebSocketPair();

		// We're going to take pair[1] as our end, and return pair[0] to the client.
		await this.handleSession(pair[1]);

		// Now we return the other end of the pair to the client.
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	private async handleSession(webSocket: WebSocket) {
		// Accept our end of the WebSocket. This tells the runtime that we'll be terminating the
		// WebSocket in JavaScript, not sending it elsewhere.
		this.state.acceptWebSocket(webSocket);

		this.sessions.add(webSocket);

		// Load the last 10 payments from the history stored on disk, and send them to the
		// client.
		let storage = await this.storage.list<Record<any, any>>({ reverse: true, limit: 10 });
		let backlog = [...storage.values()];
		backlog.reverse();
		backlog.forEach((value) => {
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
	private broadcast(payment: Payment) {
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

	public async notify(payment: Payment) {
		// Store the payment in the history.
		await this.storage.put(payment.hash, payment);

		// Broadcast the payment to all clients.
		this.broadcast(payment);
	}
}
