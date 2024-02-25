import { createClient } from "@supabase/supabase-js";
import { Environment, MessageBody } from "../types";

export const paymentWrite = async (
	message: MessageBody,
	env: Environment
) => {
	// Write new payments to the db

	const { invoice, payment, service, hooks } = message;

	if (!payment) {
		throw new Error("Missing payment");
	}

	if (!hooks) {
		throw new Error("Missing hooks");
	}

	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

	const { error } = await supabase.from("payments").insert([
		{
			invoice_id: invoice.id,
			...payment
		}
	]);

	if (error) {
		throw new Error(error.message);
	}
	console.info("New Payment Stored:", payment.hash);

	for (const hook of hooks) {
		if (hook.active && hook.event_types.includes("invoice.paid")) {
			await env.HOOK_DELIVERY_QUEUE.send({
				invoice,
				payment,
				service,
				hook,
				hook_type: "invoice.paid"
			});
		}
	}
};
