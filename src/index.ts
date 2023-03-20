import { createClient } from '@supabase/supabase-js';
import { waitForPayment } from './nano-ws';
import { pusherSend } from './pusher/pusher';
import { BadRequestException, SuccessResponse, UnauthorizedException } from './responses';
import { Environment, MessageBody } from './types';
import { parseNanoAddress, parseTime } from './utils';

const TRANSACTIONS_TABLE = 'transactions';

export default {
	async fetch(request: Request, env: Environment): Promise<Response> {
		const Authorization = request.headers.get('Authorization');

		if (!Authorization) {
			return BadRequestException('Missing authorization header');
		}

		const [scheme, token] = Authorization.split(' ');

		if (!token || scheme !== 'Bearer') {
			return BadRequestException('Malformed authorization header');
		}

		if (token !== env.AUTH_TOKEN) {
			return UnauthorizedException('Invalid credentials');
		}

		const body: MessageBody = await request.json();

		if (body.invoiceId === undefined || body.to === undefined || body.expiresAt === undefined) {
			return BadRequestException('Missing required fields');
		}

		await env.PAYMENT_LISTENER_QUEUE.send({
			invoiceId: body.invoiceId.toString(),
			to: parseNanoAddress(body.to),
			expiresAt: parseTime(body.expiresAt)
		});

		return SuccessResponse({
			message: 'Sent to queue'
		});
	},
	async queue(batch: MessageBatch<MessageBody>, env: Environment, ctx: ExecutionContext): Promise<void> {

		// Cannot process more than one message at a time
		if (batch.messages.length > 1) return

		const message: MessageBody = batch.messages[0].body;

		try {
			switch (batch.queue) {
				case 'payment-listener-queue':
					// Detect new payments
					const timeout = message.expiresAt - Date.now();
					const payment = await waitForPayment(env.NANO_WEBSOCKET_URL, message.to, timeout);
					console.info("New Payment Received:", message.payment);

					// Send the payment to the worker write to the db
					await env.PAYMENT_WRITE_QUEUE.send({
						to: message.to,
						payment
					});

					// Send the payment to the worker to push to the channel
					await env.PAYMENT_PUSHER_QUEUE.send({
						invoiceId: message.invoiceId,
						to: message.to,
						payment
					});
					break;
				case 'payment-write-queue':
					// Write new payments to the db
					if (!message.payment) {
						throw new Error('Missing payment');
					}
					const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
					const { error } = await supabase.from(TRANSACTIONS_TABLE).insert([message.payment]);
					if (error) {
						throw new Error(error.message);
					}
					console.info("New Payment Stored:", message.payment.hash)
					break;
				case 'payment-pusher-queue':
					// Send new payments to the pusher channel
					if (!message.payment) {
						throw new Error('Missing payment');
					}
					await pusherSend({
						data: message.payment,
						name: 'payment',
						channel: message.invoiceId,
						config: {
							appId: env.PUSHER_APP_ID,
							key: env.PUSHER_KEY,
							secret: env.PUSHER_SECRET
						}
					});
					break;
				default:
			}
		} catch (e: any) {
			if (e.message === 'PaymentTimeout') {
				// only log the timeout
				console.info("Payment Timeout for:", message.to)
			} else {
				// return an error to retry the batch
				console.error(e);
				throw new Error(e.message);
			}
		}
	}
}