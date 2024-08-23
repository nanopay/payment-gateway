import { NotFoundException, UnauthorizedException } from './responses';
import { queue } from './queues';
import { createInvoice } from './api/create-invoice';
import { getInvoice } from './api/get-invoice';
import { logger } from './logger';
import { isFalsyLike } from './utils';

/*
 * Export our Durable Object classes here.
 */
export { PaymentListener } from './durable/payment-listener';

/*
 * This is the main entry point for your Worker.
 * This code is executed once per request.
 * You can use this to define your request and response handling.
 * Learn more about writing workers at https://developers.cloudflare.com/workers
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Check authorization
		const authorizationHeader = request.headers.get('Authorization');
		const bearerToken = authorizationHeader?.split(' ')[1];
		const authorized = bearerToken === env.AUTH_TOKEN;
		if (!authorized) {
			return UnauthorizedException();
		}

		const localMode = !isFalsyLike(env.IS_LOCAL_MODE);
		logger.setLocalDev(localMode);

		// POST /invoices
		if (request.method === 'POST' && new URL(request.url).pathname === '/invoices') {
			return createInvoice(request, env);
		}

		// GET /invoices/[id]
		if (request.method === 'GET' && new URL(request.url).pathname.startsWith('/invoices/')) {
			return getInvoice(request, env);
		}

		return NotFoundException();
	},
	queue,
};
