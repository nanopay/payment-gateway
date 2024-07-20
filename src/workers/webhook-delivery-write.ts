import { createClient } from '@supabase/supabase-js';
import { Database, MessageBody } from '../types';
import { logger } from '../logger';

export const webhookDeliveryWrite = async (message: MessageBody, env: Env) => {
	const { webhook_delivery } = message;

	if (!webhook_delivery) {
		throw new Error('Missing webhook_delivery');
	}

	const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

	const { error: writeWebhookError, data } = await supabase.from('webhooks_deliveries').insert([webhook_delivery]).select('id').single();
	if (writeWebhookError) {
		throw new Error(writeWebhookError.message);
	}

	logger.info(`New Webhook Delivery Stored: ${data.id}`, {
		webhook_delivery,
	});
};
