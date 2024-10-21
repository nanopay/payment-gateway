import { z } from 'zod';
import { INVOICE_MIN_AMOUNT } from '../constants';

export const invoiceCreateSchema = z
	.object({
		title: z.string().min(2).max(40),
		description: z.string().max(512).nullable().optional(),
		price: z.number().min(INVOICE_MIN_AMOUNT).max(1000000),
		recipient_address: z.string().regex(/^nano_[13456789abcdefghijkmnopqrstuwxyz]{60}$/),
		metadata: z.object({}).nullable().optional(),
		redirect_url: z.string().url().max(512).nullable().optional(),
		service_id: z.string(),
		expires_at: z.string(),
		pay_address: z.string().regex(/^nano_[13456789abcdefghijkmnopqrstuwxyz]{60}$/),
	})
	.strict();

export const invoiceUpdateSchema = z.object({
	pay_address: z
		.string()
		.regex(/^nano_[13456789abcdefghijkmnopqrstuwxyz]{60}$/)
		.nullable()
		.optional(),
});
