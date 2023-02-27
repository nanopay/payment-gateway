import { createClient } from '@supabase/supabase-js';
import { waitForPayment } from './nano-ws';
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

		if (body.to === undefined || body.expiresAt === undefined) {
			return BadRequestException('Missing required fields');
		}

		await env.PAYMENT_QUEUE.send({
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

			/*
			 * By separating the processes, in the event of a db failure, the retry does
			 * not generate a new connection to the websocket, but a new write to the db.
			 */
			if (message.payment) {
				const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
				const { error } = await supabase.from(TRANSACTIONS_TABLE).insert([message.payment]);
				if (error) {
					throw new Error(error.message);
				}
				console.info("New Payment Stored:", message.payment.hash)
			} else {
				const timeout = message.expiresAt - Date.now();
				const payment = await waitForPayment(env.NANO_WEBSOCKET_URL, message.to, timeout);
				console.info("New Payment Received:", message.payment);

				// Send the payment to the next worker write to the db
				await env.PAYMENT_QUEUE.send({
					to: message.to,
					payment
				});
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