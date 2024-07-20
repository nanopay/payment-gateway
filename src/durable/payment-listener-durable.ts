import { DurableObject } from 'cloudflare:workers';
import NanoWebsocket, { SendEvent } from '../nano/websocket';
import { Invoice, MessageBody, Payment, Service, Webhook } from '../types';
import { rawToNano } from '../utils';
import { logger } from '../logger';
import { INVOICE_MIN_AMOUNT } from '../constants';

export class PaymentListenerDurable extends DurableObject<Env> {
	private nanoWebsocket: NanoWebsocket;
	private pendingInvoices: { id: string; expiresAt: string; payAddress: string; payments: Payment[] }[] = [];

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.nanoWebsocket = new NanoWebsocket(env.NANO_WEBSOCKET_URL);
	}

	async listen(message: MessageBody) {
		const { invoice, service, webhooks } = message;

		if (!invoice.pay_address) {
			throw new Error('Missing invoice');
		}

		await this.nanoWebsocket.connect();

		this.nanoWebsocket.subscribe(invoice.pay_address);

		logger.info(`Websocket listening to ${this.nanoWebsocket.listeningAccounts.length} accounts`);

		this.nanoWebsocket.onError((e) => {
			throw new Error(e.message);
		});

		this.nanoWebsocket.onClose((e) => {
			if (e.code !== 1000 || !this.nanoWebsocket.closedByClient) {
				throw new Error(`Websocket connection closed: ${this.env.NANO_WEBSOCKET_URL} ${e.reason ? ', ' + e.reason : ''}`);
			}
		});

		this.nanoWebsocket.onPayment((payment) => {
			if (payment.to !== invoice.pay_address) {
				return;
			}
			this.onPayment(payment, invoice, service, webhooks);
		});

		await this.alarm();

		this.pendingInvoices.push({
			id: invoice.id,
			expiresAt: invoice.expires_at,
			payAddress: invoice.pay_address,
			payments: [],
		});
	}

	private async onPayment(payment: SendEvent, invoice: Invoice, service: Service, webhooks: Webhook[]) {
		if (!invoice.pay_address) {
			throw new Error('Missing invoice');
		}

		if (payment.from === invoice.pay_address) {
			logger.warn(`Payment from the same address: ${payment.amount}`, {
				invoice,
				payment,
			});
			return;
		}

		const newPayment = {
			...payment,
			amount_raws: payment.amount,
			amount: rawToNano(payment.amount),
		};

		if (newPayment.amount < INVOICE_MIN_AMOUNT) {
			logger.warn(`Payment amount too low: ${newPayment.amount}`, {
				invoice,
				payment: newPayment,
			});
			return;
		}

		logger.info(`New Payment: ${payment.hash}`, {
			invoice,
			payment: newPayment,
		});

		const payments = this.pendingInvoices.find((activeInvoice) => activeInvoice.id === invoice.id)?.payments;

		if (!payments) {
			throw new Error('Missing payments');
		}

		payments.push(newPayment);

		this.paymentNotify(payments, invoice);
		this.paymentWrite(newPayment, invoice, service, webhooks);

		const paid_total = payments.reduce((acc, payment) => {
			return acc + payment.amount;
		}, 0);

		if (paid_total >= invoice.price) {
			this.nanoWebsocket.unsubscribe(invoice.pay_address);
			this.removePendingInvoice(invoice.id);

			this.paymentReceiver(payments, invoice);
		}
	}

	private removePendingInvoice(invoiceId: string) {
		this.pendingInvoices = this.pendingInvoices.filter((activeInvoice) => activeInvoice.id !== invoiceId);
	}

	private async paymentWrite(payment: Payment, invoice: Invoice, service: Service, webhooks: Webhook[]) {
		// Send the payment to the worker write to the db
		this.env.PAYMENT_WRITE_QUEUE.send({
			invoice,
			service,
			webhooks,
			payment,
		});
	}

	private async paymentNotify(payments: Payment[], invoice: Invoice) {
		// Send the payment to the worker to push to the channel
		await this.env.PAYMENT_PUSHER_QUEUE.send({
			invoice,
			payments,
		});
	}

	private async paymentReceiver(payments: Payment[], invoice: Invoice) {
		// Send the payment to the worker to receive
		await this.env.PAYMENT_RECEIVER_QUEUE.send({
			invoice,
			payments,
		});
	}

	async alarm() {
		this.pendingInvoices.forEach(async (activeInvoice) => {
			const expired = new Date(activeInvoice.expiresAt).getTime() < Date.now();
			if (expired) {
				logger.info(`Invoice expired: ${activeInvoice.id}`, {
					activeInvoice,
				});
				this.nanoWebsocket.unsubscribe(activeInvoice.payAddress);
				this.removePendingInvoice(activeInvoice.id);
			}
		});
		if (this.nanoWebsocket.listeningAccounts.length > 0) {
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (!currentAlarm) {
				// Call alarm to keep websocket connection alive
				this.ctx.storage.setAlarm(Date.now() + 1000 * 15);
			}
		} else {
			// No more listening accounts, close the websocket connection
			this.nanoWebsocket.close();
		}
	}
}
