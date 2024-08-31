import { invoiceRouter } from './invoice/invoice-router';
import { logger } from './logger';
import { queue } from './queues';
import { UnauthorizedException } from './responses';
import { isFalsyLike } from './utils';
import { Router } from './utils/router';
/*
 * Export our Durable Object classes here.
 */
export { PaymentListener } from './durable/payment-listener';

/*
 * Our API router.
 */
const router = new Router<Env>();
router.route('/invoices', invoiceRouter);

/*
 * This is the main entry point for your Worker.
 * This code is executed once per request.
 * You can use this to define your request and response handling.
 * Learn more about writing workers at https://developers.cloudflare.com/workers
 */
export default {
	async fetch(request: Request<unknown, IncomingRequestCfProperties<unknown>>, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Check authorization
		const authorizationHeader = request.headers.get('Authorization');
		const bearerToken = authorizationHeader?.split(' ')[1];
		const authorized = bearerToken === env.AUTH_TOKEN;
		if (!authorized) {
			return UnauthorizedException();
		}

		const localMode = !isFalsyLike(env.IS_LOCAL_MODE);
		logger.setLocalDev(localMode);

		return router.fetch(request, env, ctx);
	},
	queue,
};
