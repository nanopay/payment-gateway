import { deriveSecretKey } from 'nanocurrency';
import NanoWallet from '../nano/wallet';
import { Environment, MessageBody } from '../types';
import { logger } from '../logger';

export const paymentSender = async (message: MessageBody, env: Environment) => {
	// Send nano transaction to recipient

	const { invoice } = message;

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

	const { hash: paymentSendHash } = await wallet.sendAll(invoice.recipient_address);

	logger.info(`New Payment Sent: ${paymentSendHash}`, {
		invoice,
	});
};
