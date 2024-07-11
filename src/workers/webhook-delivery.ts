import { v4 as uuid } from "uuid";
import { WEBHOOK_RETRY, WEBHOOK_DELIVERY_TIMEOUT } from "../constants";
import { Environment, MessageBody } from "../types";
import { fetchWithTimeout, getHeaders } from "../utils";
import { sign } from "../utils/sign";

export const webhookDelivery = async (message: MessageBody, env: Environment) => {
	// Send new payments to the webhook making a POST with json data

	const { invoice, payment, service, webhook, webhook_type } = message;

	if (!payment) {
		throw new Error("Missing payment");
	}

	if (!webhook) {
		throw new Error("Missing webhook");
	}

	if (!webhook_type) {
		throw new Error("Missing webhook_type");
	}

	try {
		const started_at = new Date().toISOString();

		const deliveryId = uuid();

		const requestBody = {
			type: webhook_type,
			invoice,
			service,
			payment
		};

		const requestHeaders: HeadersInit = {
			"Content-Type": "application/json"
		};

		if (webhook.secret) {
			const signature = await sign(JSON.stringify(requestBody), webhook.secret);			
			requestHeaders["X-Signature"] = signature;
		}

		const response = await fetchWithTimeout(webhook.url, {
			method: "POST",
			headers: requestHeaders,
			body: requestBody,
			timeout: WEBHOOK_DELIVERY_TIMEOUT
		});

		const response_body = await response.text();

		const completed_at = new Date().toISOString();

		const response_headers = getHeaders(response.headers);

		// Send the payment to the worker write to the db
		await env.WEBHOOK_DELIVERY_WRITE_QUEUE.send({
			invoice,
			webhook_delivery: {
				id: deliveryId,
				webhook_id: webhook.id,
				type: webhook_type,
				success: response.ok,
				url: webhook.url,
				status_code: response.status,
				request_headers: requestHeaders,
				request_body: requestBody,
				response_headers,
				response_body,
				started_at,
				completed_at,
				redelivery: false
			}
		});
	} catch (e: any) {
		console.error("Webhook Error", e);
		if (WEBHOOK_RETRY) {
			// Throw so queue automatically retries
			throw new Error(e.message);
		}
	}
};
