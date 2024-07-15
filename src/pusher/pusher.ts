import { getMD5, toOrderedArray } from './utils';
import { sign } from './utils';
import { RequestError } from './errors';

interface PusherConfig {
	baseURL?: string;
	timeout?: number;
	appId: string;
	key: string;
	secret: string;
}

const DEFAULT_CONFIG: Partial<PusherConfig> = {
	baseURL: 'https://api-us2.pusher.com',
	timeout: 10000, // 10 seconds,
};

interface RequestParams extends Record<string, any> {
	auth_key: string;
	auth_timestamp: number;
	auth_version: string;
	auth_signature: string;
	body_md5: string;
}

interface PusherSend {
	data: Record<string, any>;
	name: string;
	channel: string;
	config: PusherConfig;
}

export const pusherSend = async ({ data, name, channel, config: _config }: PusherSend) => {
	const config = {
		...DEFAULT_CONFIG,
		..._config,
	};

	const body = JSON.stringify({
		data: JSON.stringify(data),
		name,
		channel,
	});

	const timestamp = Math.floor(Date.now() / 1000);
	const bodyMD5 = await getMD5(body);

	const params: Partial<RequestParams> = {
		auth_version: '1.0',
		auth_key: config.key,
		auth_timestamp: timestamp,
		body_md5: bodyMD5,
	};

	const method = 'POST';
	const path = `/apps/${config.appId}/events`;
	const headers = {
		'Content-Type': 'application/json',
	};

	const sortedKeyVal = toOrderedArray(params);

	let queryString = sortedKeyVal.join('&');

	const signData = [method, path, queryString].join('\n');
	const authSignature = await sign(signData, config.secret);

	queryString += '&auth_signature=' + authSignature;

	const url = `${config.baseURL}${path}?${queryString}`;

	let signal: AbortSignal | undefined;
	let timeout: NodeJS.Timeout | undefined;
	if (config.timeout) {
		const controller = new AbortController();
		timeout = setTimeout(() => controller.abort(), config.timeout);
		signal = controller.signal;
	}

	return fetch(url, {
		method,
		body,
		headers,
		signal,
	}).then(
		(res) => {
			clearTimeout(timeout);
			if (res.status >= 400) {
				return res.text().then((body) => {
					throw new RequestError('Unexpected status code ' + res.status, url, undefined, res.status, body);
				});
			}
			return res;
		},
		(err) => {
			clearTimeout(timeout);
			throw new RequestError('Request failed with an error', url, err);
		},
	);
};
