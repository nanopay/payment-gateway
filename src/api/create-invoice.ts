import {
	BadRequestException,
	ServerException,
	SuccessResponse
} from "../responses";
import { Database, Environment } from "../types";
import { generateInvoiceId } from "../utils";
import { INVOICE_EXPIRATION, INVOICE_MIN_AMOUNT } from "../constants";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { deriveAddress, derivePublicKey, deriveSecretKey } from "nanocurrency";

export const invoiceCreateSchema = z
	.object({
		title: z.string().min(2).max(40),
		description: z.string().max(512).nullable().optional(),
		price: z.number().min(INVOICE_MIN_AMOUNT).max(1000000),
		recipient_address: z
			.string()
			.regex(/^nano_[13456789abcdefghijkmnopqrstuwxyz]{60}$/),
		metadata: z.object({}).nullable().optional(),
		redirect_url: z.string().url().max(512).nullable().optional(),
		service_id: z.string()
	})
	.strict();

export const createInvoice = async (request: Request, env: Environment) => {
	const body = await request.json();

	const {
		title,
		description,
		metadata,
		price,
		recipient_address,
		service_id,
		redirect_url
	} = invoiceCreateSchema.parse(body);

	const currency = "XNO";
	const expires_at = new Date(Date.now() + INVOICE_EXPIRATION).toISOString();

	const supabase = createClient<Database>(
		env.SUPABASE_URL,
		env.SUPABASE_SECRET_KEY
	);

	const id = generateInvoiceId();

	const { data, error } = await supabase
		.from("invoices")
		.insert({
			id,
			title,
			description,
			metadata,
			expires_at,
			currency,
			price,
			recipient_address,
			service_id,
			redirect_url
		})
		.select(
			`
				id,
				created_at,
				expires_at,
				index,
				price,
				currency,
				recipient_address,
				status,
				title,
				description,
				metadata,
				service:services(name, display_name, avatar_url, description, id, website, contact_email, webhooks(*))
			`
		)
		.single();

	if (error) {
		console.error("Supabase error", error);
		return BadRequestException(error.message);
	}

	const { service, ...invoice } = data;

	// Derive new pay address from HOT_WALLET
	const secretKey = deriveSecretKey(env.HOT_WALLET_SEED, invoice.index);
	const publicKey = derivePublicKey(secretKey);
	const pay_address = deriveAddress(publicKey, {
		useNanoPrefix: true
	});

	const { error: updateError } = await supabase
		.from("invoices")
		.update({
			pay_address
		})
		.eq("id", id);

	if (updateError) {
		return ServerException(updateError.message);
	}

	await env.PAYMENT_LISTENER_QUEUE.send({
		invoice: {
			pay_address,
			...invoice,
			service: undefined
		},
		service: service
			? {
					...service,
					webhooks: undefined
			  }
			: null,
		webhooks: (service as any)?.webhooks || []
	});

	return SuccessResponse({
		id,
		pay_address,
		expires_at
	});
};
