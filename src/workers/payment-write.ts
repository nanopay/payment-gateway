import { createClient } from '@supabase/supabase-js';
import { Database, MessageBody } from '../types';
import { logger } from '../logger';

export const paymentWrite = async (message: MessageBody, env: Env) => {
	// Write new payments to the db

	const { invoice, payment, service, webhooks } = message;

	if (!payment) {
		throw new Error('Missing payment');
	}

	if (!webhooks) {
		throw new Error('Missing webhooks');
	}

	const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

	const { error } = await supabase.from('payments').insert([
		{
			invoice_id: invoice.id,
			...payment,
		},
	]);

	if (error) {
		throw new Error(error.message);
	}
	logger.info(`New Payment Stored: ${payment.hash}`, {
		invoiceId: invoice.id,
		payment,
	});

	for (const webhook of webhooks) {
		if (webhook.active && webhook.event_types.includes('invoice.paid')) {
			await env.WEBHOOK_DELIVERY_QUEUE.send({
				invoice,
				payment,
				service,
				webhook,
				webhook_type: 'invoice.paid',
			});
		}
	}
};
