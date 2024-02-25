import { createClient } from "@supabase/supabase-js";
import { Environment, MessageBody } from "../types";

export const hookDeliveryWrite = async (
	message: MessageBody,
	env: Environment
) => {

	const { hook_delivery } = message;

	if (!hook_delivery) {
		throw new Error("Missing hook_delivery");
	}

	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

	const { error: writeHookError, data } = await supabase
		.from("hook_deliveries")
		.insert([hook_delivery])
		.select("id")
		.single();
	if (writeHookError) {
		throw new Error(writeHookError.message);
	}

	console.info("New Webhook Delivery Stored:", data.id);
};
