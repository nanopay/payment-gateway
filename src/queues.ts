import { Environment, MessageBody } from "./types";
import { paymentListener } from "./workers/payment-listener";
import { paymentWrite } from "./workers/payment-write";
import { paymentReceiver } from "./workers/payment-receiver";
import { paymentSender } from "./workers/payment-sender";
import { paymentPusher } from "./workers/payment-pusher";
import { hookDelivery } from "./workers/hook-delivery";
import { hookDeliveryWrite } from "./workers/hook-delivery-write";

export const queue = async (
	batch: MessageBatch<MessageBody>,
	env: Environment,
	ctx: ExecutionContext
): Promise<void> => {
	if (batch.messages.length > 1) {
		console.error("Cannot process more than one message at a time");
		return;
	}

	const message: MessageBody = batch.messages[0].body;
	const invoice = message.invoice;

	try {
		switch (batch.queue) {
			case "payment-listener-queue":
				await paymentListener(message, env);
				break;

			case "payment-write-queue":
				await paymentWrite(message, env);
				break;

			case "payment-receiver-queue":
				await paymentReceiver(message, env);
				break;

			case "payment-sender-queue":
				await paymentSender(message, env);
				break;

			case "payment-pusher-queue":
				await paymentPusher(message, env);
				break;

			case "hook-delivery-queue":
				await hookDelivery(message, env);
				break;

			case "hook-delivery-write-queue":
				await hookDeliveryWrite(message, env);
				break;

			default:
		}
	} catch (e: any) {
		if (e.message === "PaymentTimeout") {
			// only log the timeout
			console.info("Payment Timeout for invoice", invoice.id);
		} else {
			// return an error to retry the batch
			console.error(e);
			throw new Error(e.message);
		}
	}
};
