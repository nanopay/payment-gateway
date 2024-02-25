import { pusherSend } from "../pusher/pusher";
import { Environment, MessageBody } from "../types";

export const paymentPusher = async (message: MessageBody, env: Environment) => {
	// Send new payments to the pusher channel

	const { payments, invoice } = message;

	if (!payments) {
		throw new Error("Missing payments");
	}
	if (!invoice) {
		throw new Error("Missing invoice");
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
			remaining
		},
		name: remaining > 0 ? "invoice.partially_paid" : "invoice.paid",
		channel: invoice.id,
		config: {
			appId: env.PUSHER_APP_ID,
			key: env.PUSHER_KEY,
			secret: env.PUSHER_SECRET
		}
	});
};
