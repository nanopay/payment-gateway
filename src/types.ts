export interface Queues {
	PAYMENT_LISTENER_QUEUE: Queue;
	PAYMENT_WRITE_QUEUE: Queue;
	PAYMENT_PUSHER_QUEUE: Queue;
}
export interface Environment extends Queues {
	AUTH_TOKEN: string;
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
	NANO_WEBSOCKET_URL: string;
	PUSHER_APP_ID: string;
	PUSHER_KEY: string;
	PUSHER_SECRET: string;
}

export interface Payment {
    from: string;
    to: string;
    amount: number;
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
	webhook_url: string;
	service: Service;
}

export interface RequestBody {
	invoiceId: string;
}

export interface MessageBody {
	invoice: Invoice;
	payment?: Payment;
}