import { SuccessResponse } from '../responses';
import { INVOICE_EXPIRATION } from '../constants';
import { z } from 'zod';
import { deriveAddress, derivePublicKey, deriveSecretKey } from 'nanocurrency';
import { logger } from '../logger';
import { InvoiceRepository, InvoiceSupabaseRepository } from './invoice-repository';
import { invoiceCreateSchema } from './invoices-schema';

export class InvoiceService {
	env: Env;
	repository: InvoiceRepository;

	constructor(env: Env) {
		this.env = env;
		this.repository = new InvoiceSupabaseRepository(env);
	}

	async getById(id: string): Promise<Response> {
		const data = await this.repository.getById(id);
		return SuccessResponse(data);
	}

	async create({
		title,
		description,
		metadata,
		price,
		recipient_address,
		service_id,
		redirect_url,
	}: z.infer<typeof invoiceCreateSchema>): Promise<Response> {
		const expires_at = new Date(Date.now() + INVOICE_EXPIRATION).toISOString();

		invoiceCreateSchema
			.omit({ pay_address: true })
			.parse({ title, description, metadata, price, recipient_address, service_id, redirect_url, expires_at });

		const minIndex = 1000; // Initially we used a sequential index in the first 1000 invoices, feel free to change this value
		const maxIndex = Math.pow(2, 32) - 1; // The index value is a unsigned 32-bit integer
		const randomIndex = Math.floor(Math.random() * (maxIndex - minIndex + 1)) + minIndex;

		// Derive new pay address from HOT_WALLET
		const secretKey = deriveSecretKey(this.env.HOT_WALLET_SEED, randomIndex);
		const publicKey = derivePublicKey(secretKey);
		const pay_address = deriveAddress(publicKey, {
			useNanoPrefix: true,
		});

		const { invoice, service } = await this.repository.create({
			title,
			description,
			metadata,
			price,
			expires_at,
			recipient_address,
			service_id,
			redirect_url,
			pay_address,
		});

		logger.info(`New Invoice Created: ${invoice.id}`, {
			invoice,
			service,
		});

		await this.env.PAYMENT_LISTENER_QUEUE.send({
			invoice: {
				...invoice,
				service: undefined,
				pay_address,
			},
			service: {
				...service,
				webhooks: undefined,
			},
			webhooks: service.webhooks || [],
		});

		return SuccessResponse({
			id: invoice.id,
			pay_address,
			expires_at,
		});
	}
}
