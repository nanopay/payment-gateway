import { INVOICE_MIN_AMOUNT } from "../constants";
import NanoWebsocket from "../nano/websocket";
import { Environment, MessageBody, Payment } from "../types";
import { parseTime, rawToNano } from "../utils";

export const paymentListener = async (message: MessageBody, env: Environment) => {

	const { invoice, service, hooks } = message;

	if (!invoice.pay_address) {
		throw new Error("Missing invoice");
	}

	// Detect new payments
	const timeout = parseTime(invoice.expires_at) - Date.now();
	let timeoutId: NodeJS.Timeout;
	let payments: Payment[] = [];

	const nanoWS = new NanoWebsocket(env.NANO_WEBSOCKET_URL);

	await nanoWS.connect();

	nanoWS.subscribe(invoice.pay_address);

	nanoWS.onError((e) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		throw new Error(e.message);
	});

	nanoWS.onClose((e) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		if (e.code !== 1000 || !nanoWS.closedByClient) {
			throw new Error(
				`Websocket connection closed: ${env.NANO_WEBSOCKET_URL} ${
					e.reason ? ", " + e.reason : ""
				}`
			);
		}
	});

	nanoWS.onPayment(async (payment) => {

		console.log("Payment received", payment);

		if (!invoice.pay_address) {
			throw new Error("Missing invoice");
		}

		if (payment.from === invoice.pay_address) {
			return;
		}

		const newPayment = {
			...payment,
			amount_raws: payment.amount,
			amount: rawToNano(payment.amount)
		};

		if (newPayment.amount < INVOICE_MIN_AMOUNT) {
			console.info("Payment amount too low:", newPayment.amount);
			return;
		}

		console.info("New Payment:", payment.hash);

		payments.push(newPayment);

		const paid_total = payments.reduce((acc, payment) => {
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
			payments: payments
		});

		if (paid_total >= invoice.price) {
			nanoWS.unsubscribe(invoice.pay_address);

			await env.PAYMENT_RECEIVER_QUEUE.send({
				invoice,
				payments: payments
			});

			nanoWS.close();
		}
	});

	const sleepTimeout = () =>
		new Promise((resolve) => {
			timeoutId = setTimeout(() => {
				nanoWS.close();
				console.info(`Invoice ${invoice.id} timeout`);
				resolve(true);
			}, timeout);
		});

	const isClosed = () =>
		new Promise((resolve) => {
			if (nanoWS.closedByClient) {
				resolve(true);
			} else {
				setTimeout(() => {
					resolve(isClosed());
				}, 100);
			}
		});

	await Promise.race([sleepTimeout(), isClosed()]);

};
