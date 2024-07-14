import { Database } from "./supabase";

export interface Queues {
	PAYMENT_LISTENER_QUEUE: Queue;
	PAYMENT_WRITE_QUEUE: Queue;
	PAYMENT_PUSHER_QUEUE: Queue;
	WEBHOOK_DELIVERY_QUEUE: Queue;
	WEBHOOK_DELIVERY_WRITE_QUEUE: Queue<{
		invoice: Invoice;
		webhook_delivery: WebhookDelivery;
	}>;
	PAYMENT_RECEIVER_QUEUE: Queue;
	PAYMENT_SENDER_QUEUE: Queue;
}

export interface KVNamespaces {
	WALLET: KVNamespace;
}
export interface Environment extends Queues, KVNamespaces {
	AUTH_TOKEN: string;
	SUPABASE_URL: string;
	SUPABASE_SECRET_KEY: string;
	NANO_WEBSOCKET_URL: string;
	PUSHER_APP_ID: string;
	PUSHER_KEY: string;
	PUSHER_SECRET: string;
	HOT_WALLET_SEED: string;
	REPRESENTATIVE: string;
	RPC_URLS: string;
	WORKER_URLS: string;
}

export type Payment = Omit<
	Database["public"]["Tables"]["payments"]["Insert"],
	"invoice_id"
>;

export type Service = Database["public"]["Tables"]["services"]["Row"];

export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];

export type Webhook = Database["public"]["Tables"]["webhooks"]["Row"];

export type WebhookDelivery = Omit<
	Database["public"]["Tables"]["webhooks_deliveries"]["Insert"],
	"request_body"
> & {
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
