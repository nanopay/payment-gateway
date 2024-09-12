import { invoiceRouter } from './invoice/invoice-router';
import { logger } from './logger';
import { queue } from './queues';
import { isFalsyLike } from './utils';
import { Router } from './utils/router';
/*
 * Export our Durable Object classes here.
 */
export { PaymentListener } from './durable/payment-listener';
export { PaymentNotifier } from './durable/payment-notifier';

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
		const localMode = !isFalsyLike(env.IS_LOCAL_MODE);
		logger.setLocalDev(localMode);

		return router.fetch(request, env, ctx);
	},
	queue,
};
