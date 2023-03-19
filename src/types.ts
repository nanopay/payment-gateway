export interface Queues {
	PAYMENT_LISTENER_QUEUE: Queue;
	PAYMENT_WRITE_QUEUE: Queue;
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
}

export interface MessageBody {
	to: string;
    expiresAt: number;
	payment?: Payment;
}