import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { deriveAddress, derivePublicKey, deriveSecretKey } from "nanocurrency";
import {
	BadRequestException,
	ServerException,
	SuccessResponse,
	UnauthorizedException
} from "./responses";
import { Environment, InvoiceCreate } from "./types";
import { generateInvoiceId } from "./utils";
import { INVOICE_EXPIRATION, INVOICE_MIN_AMOUNT } from "./constants";

import { queue } from "./queues";

const InvoiceSchema: z.ZodType<InvoiceCreate> = z
	.object({
		title: z.string(),
		description: z.string().max(512).optional(),
		price: z.number().min(INVOICE_MIN_AMOUNT),
		recipient_address: z
			.string()
			.refine((value) =>
				/^nano_[13456789abcdefghijkmnopqrstuwxyz]{60}$/.test(value)
			),
		metadata: z.record(z.unknown()).optional(),
		redirect_url: z.string().url().max(512).nullable().optional(),
		user_id: z.string().uuid().nullable().optional(),
		service_id: z.string().nullable().optional()
	})
	.refine(
		(data) =>
			!!data.title &&
			!!data.price &&
			!!data.recipient_address &&
			(data.service_id || data.user_id)
	);

export default {
	async fetch(request: Request, env: Environment): Promise<Response> {
		if (request.method !== "POST") {
			return BadRequestException("Invalid method");
		}

		const Authorization = request.headers.get("Authorization");

		if (!Authorization) {
			return BadRequestException("Missing authorization header");
		}

		const [scheme, token] = Authorization.split(" ");

		if (!token || scheme !== "Bearer") {
			return BadRequestException("Malformed authorization header");
		}

		if (token !== env.AUTH_TOKEN) {
			return UnauthorizedException("Invalid credentials");
		}

		const body = await request.json();

		const {
			title,
			description,
			metadata,
			price,
			recipient_address,
			service_id,
			user_id,
			redirect_url
		} = InvoiceSchema.parse(body);

		const currency = "XNO";
		const expires_at = new Date(Date.now() + INVOICE_EXPIRATION).toISOString();

		const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

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
				user_id: service_id ? null : user_id,
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
				service:services(name, display_name, avatar_url, description, id, website, contact_email, hooks(*))
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
						hooks: undefined
				  }
				: null,
			hooks: (service as any)?.hooks || []
		});

		return SuccessResponse({
			id,
			pay_address,
			expires_at
		});
	},
	queue
};
