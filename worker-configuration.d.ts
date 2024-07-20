// Generated by Wrangler on Sat Jul 20 2024 14:31:30 GMT-0300 (Brasilia Standard Time)
// by running `wrangler types`

interface Env {
	WALLET: KVNamespace;
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
	IS_LOCAL_MODE: string;
	PAYMENT_LISTENER_DURABLE: DurableObjectNamespace<import("./src/index").PaymentListenerDurable>;
	PAYMENT_LISTENER_QUEUE: Queue;
	PAYMENT_RECEIVER_QUEUE: Queue;
	PAYMENT_WRITE_QUEUE: Queue;
	PAYMENT_PUSHER_QUEUE: Queue;
	PAYMENT_SENDER_QUEUE: Queue;
	WEBHOOK_DELIVERY_QUEUE: Queue;
	WEBHOOK_DELIVERY_WRITE_QUEUE: Queue;
}
