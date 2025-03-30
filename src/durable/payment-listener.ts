import { DurableObject } from 'cloudflare:workers';
import NanoWebsocket, { SendEvent } from '../nano/websocket';
import { Invoice, MessageBody, Payment, Service, Webhook } from '../types';
import { rawToNano } from '../utils';
import { logger } from '../logger';
import { INVOICE_MIN_AMOUNT, MAX_PAYMENTS_PER_INVOICE } from '../constants';
import { PaymentNotifier, PaymentNotifierCloseReason } from './payment-notifier';
import BigNumber from 'bignumber.js';

export class PaymentListener extends DurableObject<Env> {
	private nanoWebsocket: NanoWebsocket;
	private pendingInvoices = new Map<string, { expiresAt: string; payAddress: string; payments: Map<string, Payment> }>();
	private notifierNamespace: DurableObjectNamespace<PaymentNotifier>;

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
		this.notifierNamespace = env.PAYMENT_NOTIFIER;
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

		this.nanoWebsocket.onClose((e, closedByClient) => {
			if (e.code !== 1000 || !closedByClient) {
				throw new Error(`Websocket connection closed: ${this.env.NANO_WEBSOCKET_URL} ${e.reason ? ', ' + e.reason : ''}`);
			}
		});

		this.nanoWebsocket.onPayment((payment) => {
			if (payment.to !== invoice.pay_address) {
				return;
			}
			this.onPayment(payment, invoice, service, webhooks);
		});

		this.pendingInvoices.set(invoice.id, {
			expiresAt: invoice.expires_at,
			payAddress: invoice.pay_address,
			payments: new Map(),
		});

		await this.startPaymentNotifier(invoice.id);

		await this.alarm();
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

		const payments = this.pendingInvoices.get(invoice.id)?.payments;

		if (!payments) {
			throw new Error('Missing payments');
		}

		payments.set(newPayment.hash, newPayment);

		await this.paymentNotify(newPayment, invoice.id);
		await this.paymentWrite(newPayment, invoice, service, webhooks);

		const paid_total = Array.from(payments.values()).reduce((acc, payment) => {
			return BigNumber(acc).plus(payment.amount).toNumber();
		}, 0);

		if (paid_total >= invoice.price) {
			await this.removePendingInvoice(invoice.id, 'PAID');
			await this.paymentReceiver(Array.from(payments.values()), invoice);
		} else if (payments.size >= MAX_PAYMENTS_PER_INVOICE) {
			await this.removePendingInvoice(invoice.id, 'TOO_MANY_PAYMENTS');
			logger.warn(`Max payments reached for invoice: ${invoice.id}`, {
				invoice,
				payments,
			});
		}
	}

	private async removePendingInvoice(invoiceId: string, reason: PaymentNotifierCloseReason) {
		const invoice = this.pendingInvoices.get(invoiceId);
		if (!invoice) return;
		this.nanoWebsocket.unsubscribe(invoice.payAddress);
		this.pendingInvoices.delete(invoiceId);
		await this.stopPaymentNotifier(invoiceId, reason);
	}

	private async paymentWrite(payment: Payment, invoice: Invoice, service: Service, webhooks: Webhook[]) {
		// Send the payment to the worker write to the db
		await this.env.PAYMENT_WRITE_QUEUE.send({
			invoice,
			service,
			webhooks,
			payment,
		});
	}

	private async startPaymentNotifier(invoiceId: string) {
		const notifierId = this.notifierNamespace.idFromName(invoiceId);
		const paymentNotifier = this.notifierNamespace.get(notifierId);
		await paymentNotifier.start();
	}

	private async stopPaymentNotifier(invoiceId: string, reason: PaymentNotifierCloseReason) {
		const notifierId = this.notifierNamespace.idFromName(invoiceId);
		const paymentNotifier = this.notifierNamespace.get(notifierId);
		await paymentNotifier.stop(reason);
	}

	private async paymentNotify(payment: Payment, invoiceId: string) {
		// Send the payment to the PaymentNotifier
		const notifierId = this.notifierNamespace.idFromName(invoiceId);
		const paymentNotifier = this.notifierNamespace.get(notifierId);
		await paymentNotifier.notify({
			from: payment.from,
			to: payment.to,
			amount: payment.amount,
			hash: payment.hash,
			timestamp: payment.timestamp,
		});
	}

	private async paymentReceiver(payments: Payment[], invoice: Invoice) {
		// Send the payment to the worker to receive
		await this.env.PAYMENT_RECEIVER_QUEUE.send({
			invoice,
			payments,
		});
	}

	private async removeExpiredInvoices() {
		let promises = [];
		for (const [id, invoice] of this.pendingInvoices) {
			const expired = new Date(invoice.expiresAt).getTime() <= Date.now();
			if (expired) {
				logger.info(`Invoice expired: ${id}`, {
					invoice,
				});
				promises.push(this.removePendingInvoice(id, 'EXPIRED'));
			}
		}
		await Promise.all(promises);
	}

	private async keepAlive() {
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (!currentAlarm) {
			const nearestExpiresAt = Math.min(
				...Array.from(this.pendingInvoices.values()).map((invoice) => new Date(invoice.expiresAt).getTime())
			);
			const defaultScheduledTime = Date.now() + 1000 * 30; // 30 seconds
			const scheduledTime = nearestExpiresAt < defaultScheduledTime ? nearestExpiresAt : defaultScheduledTime;

			await this.ctx.storage.setAlarm(scheduledTime);
		}
	}

	async alarm() {
		await this.removeExpiredInvoices().catch((e) => {
			logger.error('Error removing expired invoices', e);
		});

		if (this.pendingInvoices.size > 0) {
			await this.keepAlive();
			return;
		}

		this.nanoWebsocket.close();
	}
}
