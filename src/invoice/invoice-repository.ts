import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database, Invoice, Service, Webhook } from '../types';
import { NotFoundException, ServerException } from '../responses';
import { invoiceCreateSchema } from './invoices-schema';
import { generateInvoiceId } from '../utils';

type PublicService = Omit<Service, 'api_keys_count' | 'webhooks_count' | 'invoices_count' | 'user_id' | 'created_at'>;

export abstract class InvoiceRepository {
	abstract getById(id: string): Promise<{ invoice: Invoice; service: PublicService }>;

	abstract create(data: z.infer<typeof invoiceCreateSchema>): Promise<{
		service: PublicService & { webhooks: Webhook[] };
		invoice: Invoice;
	}>;
}

export class InvoiceSupabaseRepository implements InvoiceRepository {
	env: Env;
	supabase: SupabaseClient<Database>;

	constructor(env: Env) {
		this.env = env;
		this.supabase = createClient<Database>(this.env.SUPABASE_URL, this.env.SUPABASE_SECRET_KEY);
	}

	async getById(id: string) {
		const { data, error } = await this.supabase
			.from('invoices')
			.select('*, service:services(id, slug, name, avatar_url, website, contact_email)')
			.eq('id', id)
			.single();

		if (error) {
			if (error.code === 'PGRST116') {
				throw NotFoundException();
			}
			throw ServerException(error.message);
		}

		if (!data) {
			throw NotFoundException();
		}

		const { service, ...invoice } = data;

		if (!service) {
			throw NotFoundException();
		}

		return {
			invoice,
			service,
		};
	}

	async create({
		title,
		description,
		metadata,
		price,
		recipient_address,
		service_id,
		redirect_url,
		expires_at,
		pay_address,
		index,
	}: z.infer<typeof invoiceCreateSchema>) {
		invoiceCreateSchema.parse({
			title,
			description,
			metadata,
			price,
			recipient_address,
			service_id,
			redirect_url,
			expires_at,
			pay_address,
			index,
		});

		const id = generateInvoiceId();

		const { data, error } = await this.supabase
			.from('invoices')
			.insert({
				id,
				title,
				description,
				metadata,
				expires_at,
				currency: 'XNO',
				price,
				recipient_address,
				service_id,
				redirect_url,
				pay_address,
				index,
			})
			.select(
				`
				*,
				service:services(slug, name, avatar_url, id, website, contact_email, webhooks(*))
			`
			)
			.single();

		if (error) {
			throw new Error(error.message);
		}

		const { service, ...invoice } = data;

		if (!service) {
			throw NotFoundException();
		}

		return { service, invoice };
	}
}
