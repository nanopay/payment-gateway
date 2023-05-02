export interface Queues {
	PAYMENT_LISTENER_QUEUE: Queue;
	PAYMENT_WRITE_QUEUE: Queue;
	PAYMENT_PUSHER_QUEUE: Queue;
	HOOK_DELIVERY_QUEUE: Queue;
	HOOK_DELIVERY_WRITE_QUEUE: Queue;
	PAYMENT_RECEIVER_QUEUE: Queue;
}
export interface Environment extends Queues {
	AUTH_TOKEN: string;
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
	NANO_WEBSOCKET_URL: string;
	PUSHER_APP_ID: string;
	PUSHER_KEY: string;
	PUSHER_SECRET: string;
	SEED: string;
	REPRESENTATIVE: string;
	RPC_URLS: string;
	WORKER_URLS: string;
}

export interface Payment {
    from: string;
    to: string;
    amount: number;
	amountRaws: string;
    hash: string;
	timestamp: number;
}

export interface Service {
	id: string;
	name: string;
	display_name: string;
	description: string;
	avatar_url: string;
	website: string | null;
	contact_email: string | null;
}

export interface Invoice {
	id: string;
	created_at: string;
	expires_at: string;
	price: number;
	currency: string;
	recipient_address: string;
	pay_address: string;
	status: string;
	title: string;
	description: string;
	metadata: string;
	index: number;
}

export interface RequestBody {
	invoiceId: string;
}

export interface Hook {
	id: string;
	name: string;
	url: string;
	method: string;
	headers: Record<string, string>;
	event_types: string[];
	description: string | null;
	active: boolean
	created_at: string
}

export interface WebhookDelivery {
	hook_id: string;
	type: string;
	url: string;
	success: boolean;
	status_code: number;
	started_at: string;
	completed_at: string;
	request_headers: Record<string, string>,
	response_headers: Record<string, string>,
	response_body: string | null;
	redelivery: boolean;
	request_body: {
		invoice: Invoice;
		payment: Payment;
		service: Service | null;
	},
}

export interface MessageBody {
	invoice: Invoice;
	payment?: Payment;
	service: Service;
	hooks: Hook[];
	hook: Hook;
	hook_type: string;
	hook_delivery?: WebhookDelivery;
}