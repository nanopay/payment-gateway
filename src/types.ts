export interface Environment {
	PAYMENT_LISTENER_QUEUE: Queue;
	PAYMENT_WRITE_QUEUE: Queue;
	AUTH_TOKEN: string;
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
	NANO_WEBSOCKET_URL: string;
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