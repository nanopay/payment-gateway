import { authMiddleware } from '../middlewares/authMiddleware';
import { Router } from '../utils/router';
import { InvoiceService } from './invoice-service';

const router = new Router<Env>();

router.get('/:id', authMiddleware, ({ env, params }) => {
	const invoices = new InvoiceService(env);
	return invoices.getById(params.id);
});

router.post('/', authMiddleware, async ({ req, env }) => {
	const invoices = new InvoiceService(env);
	return invoices.create(await req.json());
});

router.get('/:id/payments', ({ req, env, params }) => {
	const notifierId = env.PAYMENT_NOTIFIER.idFromName(params.id);
	const paymentNotifier = env.PAYMENT_NOTIFIER.get(notifierId);
	return paymentNotifier.fetch(req.url, req);
});

export const invoiceRouter = router;
