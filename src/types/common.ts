import { Database } from './supabase';

export type Payment = Omit<Database['public']['Tables']['payments']['Insert'], 'invoice_id'>;

export type Service = Database['public']['Tables']['services']['Row'];

export type Invoice = Database['public']['Tables']['invoices']['Row'];

export type Webhook = Database['public']['Tables']['webhooks']['Row'];

export type WebhookDelivery = Omit<Database['public']['Tables']['webhooks_deliveries']['Insert'], 'request_body'> & {
	request_body: {
		invoice: Invoice;
		payment: Payment;
		service: Service | null;
	};
};

export interface MessageBody {
	invoice: Invoice;
	payment?: Payment;
	service: Service;
	webhooks: Webhook[];
	webhook: Webhook;
	webhook_type: string;
	webhook_delivery?: WebhookDelivery;
	payments?: Payment[];
}
