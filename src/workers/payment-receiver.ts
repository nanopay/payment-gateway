import { deriveSecretKey } from 'nanocurrency';
import NanoWallet from '../nano/wallet';
import { MessageBody } from '../types';
import { logger } from '../logger';

export const paymentReceiver = async (message: MessageBody, env: Env) => {
	const { invoice, payments } = message;

	// Receive nano transaction
	if (!payments) {
		throw new Error('Missing payments');
	}
	if (!invoice) {
		throw new Error('Missing invoice');
	}

	const privateKey = deriveSecretKey(env.HOT_WALLET_SEED, invoice.index);

	const wallet = new NanoWallet({
		privateKey,
		rpcURLs: env.RPC_URLS.split(','),
		workerURLs: env.WORKER_URLS.split(','),
		representative: env.REPRESENTATIVE,
		kvStore: env.WALLET,
	});

	await wallet.init();

	for (const payment of payments) {
		const { hash: paymentReceiveHash } = await wallet.receive(payment.hash, payment.amount_raws);

		logger.info(`New Payment Received: ${paymentReceiveHash}`, {
			...payment,
		});
	}

	await env.PAYMENT_SENDER_QUEUE.send({
		invoice,
	});
};
