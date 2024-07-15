import { createClient } from "@supabase/supabase-js";
import { Database, Environment, MessageBody } from "../types";

export const webhookDeliveryWrite = async (
	message: MessageBody,
	env: Environment
) => {
	const { webhook_delivery } = message;

	if (!webhook_delivery) {
		throw new Error("Missing webhook_delivery");
	}

	const supabase = createClient<Database>(
		env.SUPABASE_URL,
		env.SUPABASE_SECRET_KEY
	);

	const { error: writeWebhookError, data } = await supabase
		.from("webhooks_deliveries")
		.insert([webhook_delivery])
		.select("id")
		.single();
	if (writeWebhookError) {
		throw new Error(writeWebhookError.message);
	}

	console.info(`New Webhook Delivery Stored: ${data.id}`);
};
