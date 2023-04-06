import { createClient } from '@supabase/supabase-js';
import { waitForPayment } from './nano-ws';
import { pusherSend } from './pusher/pusher';
import { BadRequestException, SuccessResponse, UnauthorizedException } from './responses';
import { Environment, MessageBody, Service, RequestBody } from './types';
import { parseTime } from './utils';

const TRANSACTIONS_TABLE = 'transactions';
const INVOICES_TABLE = 'invoices';

export default {
	async fetch(request: Request, env: Environment): Promise<Response> {

		if (request.method !== 'POST') {
			return BadRequestException('Invalid method');
		}

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

		const body: RequestBody = await request.json();

		if (body.invoiceId === undefined) {
			return BadRequestException('Missing required fields');
		}

		const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

		const { data, error } = await supabase
			.from(INVOICES_TABLE)
			.select(`id,created_at,expires_at,price,currency,recipient_address,status,pay_address,status,title,description,metadata,webhook_url,services(name, display_name, avatar_url, description, id, website, contact_email)`)
			.eq('id', body.invoiceId)
			.single();

		if (error) {
			console.error("Supabase error", error)
			return BadRequestException(error.message);
		}

		if (!data) {
			return BadRequestException('Invoice not found');
		}

		if (data.status !== 'pending') {
			return BadRequestException('Invoice already paid');
		}

		const invoice: any = { ...data, service: data.services as Service }

		delete invoice['services'];

		await env.PAYMENT_LISTENER_QUEUE.send({
			invoice,
		});

		return SuccessResponse({
			message: 'Sent to queue'
		});
	},
	async queue(batch: MessageBatch<MessageBody>, env: Environment, ctx: ExecutionContext): Promise<void> {

		// Cannot process more than one message at a time
		if (batch.messages.length > 1) return

		const message: MessageBody = batch.messages[0].body;
		const invoice = message.invoice;

		const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

		try {
			switch (batch.queue) {
				case 'payment-listener-queue':
					// Detect new payments
					const timeout = parseTime(invoice.expires_at) - Date.now();
					const payment = await waitForPayment(env.NANO_WEBSOCKET_URL, invoice.pay_address, timeout);
					console.info("New Payment Received:", payment.hash);

					// Send the payment to the worker write to the db
					await env.PAYMENT_WRITE_QUEUE.send({
						invoice,
						payment
					});

					// Send the payment to the worker to push to the channel
					await env.PAYMENT_PUSHER_QUEUE.send({
						invoice,
						payment
					});
					break;
				case 'payment-write-queue':
					// Write new payments to the db
					if (!message.payment) {
						throw new Error('Missing payment');
					}
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
						channel: invoice.id,
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
				console.info("Payment Timeout for invoice", invoice.id)
			} else {
				// return an error to retry the batch
				console.error(e);
				throw new Error(e.message);
			}
		}
	}
}