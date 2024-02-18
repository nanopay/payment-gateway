import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { deriveAddress, derivePublicKey, deriveSecretKey } from 'nanocurrency';
import { pusherSend } from './pusher/pusher';
import { BadRequestException, ServerException, SuccessResponse, UnauthorizedException } from './responses';
import { Environment, InvoiceCreate, MessageBody, Payment, WebhookDelivery } from './types';
import { fetchWithTimeout, getHeaders, parseTime, rawToNano, generateInvoiceId } from './utils';
import NanoWebsocket from './nano/ws';
import NanoWallet from './nano/wallet';
import { HOOK_RETRY, INVOICE_EXPIRATION, INVOICE_MIN_AMOUNT, WEBHOOK_DELIVERY_TIMEOUT } from './constants';

const InvoiceSchema: z.ZodType<InvoiceCreate>= z.object({
	title: z.string(),
	description: z.string().max(512).optional(),
	price: z.number().min(INVOICE_MIN_AMOUNT),
	recipient_address: z.string().refine(value =>
	  /^nano_[13456789abcdefghijkmnopqrstuwxyz]{60}$/.test(value)
	),
	metadata: z.record(z.unknown()).optional(),
	redirect_url: z.string().url().max(512).nullable().optional(),
	user_id: z.string().uuid().nullable().optional(),
	service_id: z.string().nullable().optional(),
  })
  .refine(data => !!data.title && !!data.price && !!data.recipient_address && (data.service_id || data.user_id));

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

		const body = await request.json();

		const {
			title,
			description,
			metadata,
			price,
			recipient_address,
			service_id,
			user_id,
			redirect_url,
		} = InvoiceSchema.parse(body)

		const currency = 'XNO'
		const expires_at = new Date(Date.now() + INVOICE_EXPIRATION).toISOString()

		const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

		const id = generateInvoiceId()

		const { data, error } = await supabase
			.from('invoices')
			.insert({
				id,
				title,
				description,
				metadata,
				expires_at,
				currency,
				price,
				recipient_address,
				service_id,
				user_id: service_id ? null : user_id,
				redirect_url,
			})
			.select(`id,created_at,expires_at,index,price,currency,recipient_address,status,status,title,description,metadata,service:services(name, display_name, avatar_url, description, id, website, contact_email, hooks(*))`)
			.single()

		const { service, ...invoice} = data!

		if (error) {
			console.error("Supabase error", error)
			return BadRequestException(error.message);
		}

		// Derive new pay address from HOT_WALLET
		const secretKey = deriveSecretKey(env.HOT_WALLET_SEED, invoice.index)
		const publicKey = derivePublicKey(secretKey)
		const pay_address = deriveAddress(publicKey, {
			useNanoPrefix: true,
		})

		const { error: updateError } = await supabase
		.from('invoices')
		.update({
			pay_address,
		})
		.eq('id', id)

		if (updateError) {
			return ServerException(updateError.message);
		}

		await env.PAYMENT_LISTENER_QUEUE.send({
			invoice: {
				pay_address,
				...invoice,
				service: undefined
			},
			service: service ? {
				...service,
				hooks: undefined
			} : null,
			hooks: (service as any)?.hooks || []
		});

		return SuccessResponse({
			id,
			pay_address,
			expires_at
		});
	},
	async queue(batch: MessageBatch<MessageBody>, env: Environment, ctx: ExecutionContext): Promise<void> {

		if (batch.messages.length > 1) {
			console.error("Cannot process more than one message at a time");
			return
		}

		const message: MessageBody = batch.messages[0].body;
		const invoice = message.invoice;
		const service = message.service;
		const hooks = message.hooks;
		const payment = message.payment;
		const payments = message.payments;

		const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

		const privateKey = deriveSecretKey(env.HOT_WALLET_SEED, invoice.index);

		const wallet = new NanoWallet({
			privateKey,
			rpcURLs: env.RPC_URLS.split(','),
			workerURLs: env.WORKER_URLS.split(','),
			representative: env.REPRESENTATIVE,
			kvStore: env.WALLET
		});

		try {
			switch (batch.queue) {
				case 'payment-listener-queue':
					// Detect new payments
					const timeout = parseTime(invoice.expires_at) - Date.now();
					let timeoutId: any;
					let _payments: Payment[] = [];

					const nanoWS = new NanoWebsocket(env.NANO_WEBSOCKET_URL);

					await nanoWS.connect();

					nanoWS.subscribe(invoice.pay_address);

					nanoWS.onError((e) => {
						if (timeoutId) {
							clearTimeout(timeoutId)
						}
						throw new Error(e.message)
					})

					nanoWS.onClose((e) => {
						if (timeoutId) {
							clearTimeout(timeoutId)
						}

						if (e.code !== 1000 || !nanoWS.closedByClient) {
							throw new Error(`Websocket connection closed: ${env.NANO_WEBSOCKET_URL} ${e.reason ? ', ' + e.reason : ''}`)
						}
					})

					nanoWS.onPayment(async (payment) => {

						if (payment.from === invoice.pay_address) {
							return
						}

						const newPayment = {
							...payment,
							amountRaws: payment.amount,
							amount: rawToNano(payment.amount)
						}

						if (newPayment.amount < INVOICE_MIN_AMOUNT) {
							console.info("Payment amount too low:", newPayment.amount);
							return
						}

						console.info("New Payment:", payment.hash);

						_payments.push(newPayment);

						const paid_total = _payments.reduce((acc, payment) => {
							return acc + payment.amount;
						}, 0);


						// Send the payment to the worker write to the db
						await env.PAYMENT_WRITE_QUEUE.send({
							invoice,
							service,
							hooks,
							payment: newPayment
						});

						// Send the payment to the worker to push to the channel
						await env.PAYMENT_PUSHER_QUEUE.send({
							invoice,
							payments: _payments
						});

						if (paid_total >= invoice.price) {

							nanoWS.unsubscribe(invoice.pay_address);

							await env.PAYMENT_RECEIVER_QUEUE.send({
								invoice,
								payments: _payments
							});

							nanoWS.close();

						}

					})

					const sleepTimeout = () => new Promise(resolve => {
						timeoutId = setTimeout(() => {
							nanoWS.close();
							console.info(`Invoice ${invoice.id} timeout`)
							resolve(true);
						}, timeout);
					})

					const isClosed = () => new Promise(resolve => {
						if (nanoWS.closedByClient) {
							resolve(true);
						} else {
							setTimeout(() => {
								resolve(isClosed());
							}, 100);
						}
					})

					await Promise.race([sleepTimeout(), isClosed()]);

					break;

				case 'payment-write-queue':
					// Write new payments to the db

					if (!payment) {
						throw new Error('Missing payment');
					}

					if (!hooks) {
						throw new Error('Missing hooks');
					}

					const { error } = await supabase.from('payments').insert([{
						invoice_id: invoice.id,
						...payment
					}]);
					if (error) {
						throw new Error(error.message);
					}
					console.info("New Payment Stored:", payment.hash);

					for (const hook of hooks) {
						if (hook.active && hook.event_types.includes('invoice.paid')) {
							// Send the payment to the worker to delivery the webhook
							await env.HOOK_DELIVERY_QUEUE.send({
								invoice,
								payment,
								service,
								hook,
								hook_type: 'invoice.paid'
							})
						}
					}

					break;
				case 'payment-receiver-queue':
					// Receive nano transaction
					if (!payments) {
						throw new Error('Missing payments');
					}
					if (!invoice) {
						throw new Error('Missing invoice');
					}

					await wallet.init();

					for (const payment of payments) {

						const { hash: paymentReceiveHash } = await wallet.receive(payment.hash, payment.amountRaws);

						console.info("New Payment Received:", paymentReceiveHash);
					}

					await env.PAYMENT_SENDER_QUEUE.send({
						invoice,
					})

					break;
				case 'payment-sender-queue':
					// Send nano transaction to recipient

					if (!invoice) {
						throw new Error('Missing invoice');
					}

					await wallet.init();

					const { hash: paymentSendHash } = await wallet.sendAll(invoice.recipient_address);

					console.info("New Payment Sent:", paymentSendHash);

					break;

				case 'payment-pusher-queue':
					// Send new payments to the pusher channel
					if (!payments) {
						throw new Error('Missing payments');
					}
					if (!invoice) {
						throw new Error('Missing invoice');
					}

					const paid_total = payments.reduce((acc, payment) => {
						return acc + payment.amount;
					}, 0);

					const remaining = invoice.price - paid_total;

					await pusherSend({
						data: {
							payments,
							price: invoice.price,
							paid_total,
							remaining,
						},
						name: remaining > 0 ? 'invoice.partially_paid' : 'invoice.paid',
						channel: invoice.id,
						config: {
							appId: env.PUSHER_APP_ID,
							key: env.PUSHER_KEY,
							secret: env.PUSHER_SECRET
						}
					});
					break;
				case 'hook-delivery-queue':
					// Send new payments to the webhook making a POST with json data

					if (!payment) {
						throw new Error('Missing payment');
					}

					if (!message.hook) {
						throw new Error('Missing hook');
					}

					if (!message.hook_type) {
						throw new Error('Missing hook_type');
					}

					try {

						const started_at = new Date().toISOString();

						const requestHeaders = {
							'Content-Type': 'application/json',
							...message.hook.headers
						}

						const requestBody = {
							type: message.hook_type,
							invoice,
							service,
							payment,
						}

						const response = await fetchWithTimeout(message.hook.url, {
							method: 'POST',
							headers: requestHeaders,
							body: requestBody,
							timeout: WEBHOOK_DELIVERY_TIMEOUT
						})

						const response_body = await response.text();

						const completed_at = new Date().toISOString();

						const response_headers = getHeaders(response.headers)

						// Send the payment to the worker write to the db
						await env.HOOK_DELIVERY_WRITE_QUEUE.send({
							invoice,
							hook_delivery: {
								hook_id: message.hook.id,
								type: message.hook_type,
								success: response.ok,
								url: message.hook.url,
								status_code: response.status,
								request_headers: requestHeaders,
								request_body: requestBody,
								response_headers,
								response_body,
								started_at,
								completed_at,
								redelivery: false,
							} as WebhookDelivery
						})
					} catch (e: any) {
						console.error("Webhook Error", e)
						if (HOOK_RETRY) {
							// Throw so queue automatically retries
							throw new Error(e.message);
						}
					}
					break;
				case 'hook-delivery-write-queue':
					// Write new payments to the db
					if (!message.hook_delivery) {
						throw new Error('Missing hook_delivery');
					}
					const { error: writeHookError, data } = await supabase.from('hook_deliveries').insert([message.hook_delivery]).select('id').single();
					if (writeHookError) {
						throw new Error(writeHookError.message);
					}
					console.info("New Webhook Delivery Stored:", data.id)
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