import { Environment, MessageBody } from './types';
import { paymentListener } from './workers/payment-listener';
import { paymentWrite } from './workers/payment-write';
import { paymentReceiver } from './workers/payment-receiver';
import { paymentSender } from './workers/payment-sender';
import { paymentPusher } from './workers/payment-pusher';
import { webhookDelivery } from './workers/webhook-delivery';
import { webhookDeliveryWrite } from './workers/webhook-delivery-write';
import { logger } from './logger';

export const queue = async (batch: MessageBatch<MessageBody>, env: Environment, ctx: ExecutionContext): Promise<void> => {
	if (batch.messages.length > 1) {
		logger.error('Cannot process more than one message at a time', {
			queueName: batch.queue,
			queueMessage: batch.messages,
		});
		return;
	}

	const message: MessageBody = batch.messages[0].body;

	try {
		switch (batch.queue) {
			case 'payment-listener-queue':
				await paymentListener(message, env);
				break;

			case 'payment-write-queue':
				await paymentWrite(message, env);
				break;

			case 'payment-receiver-queue':
				await paymentReceiver(message, env);
				break;

			case 'payment-sender-queue':
				await paymentSender(message, env);
				break;

			case 'payment-pusher-queue':
				await paymentPusher(message, env);
				break;

			case 'webhook-delivery-queue':
				await webhookDelivery(message, env);
				break;

			case 'webhook-delivery-write-queue':
				await webhookDeliveryWrite(message, env);
				break;

			default:
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
		if (errorMessage === 'PaymentTimeout') {
			logger.info(`Payment Timeout for invoice: ${message.invoice.id}`);
		} else {
			logger.error('Error processing message in queue.', {
				queueName: batch.queue,
				queueMessage: message,
				error: errorMessage,
			});
			// return an error to retry the batch
			throw error;
		}
	}
};
