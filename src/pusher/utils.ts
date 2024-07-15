import CryptoJS from 'crypto-js';

export const getMD5 = async (message: string) => {
	const hash = CryptoJS.MD5(CryptoJS.enc.Latin1.parse(message));
	const md5 = hash.toString(CryptoJS.enc.Hex);
	return md5;
};

export const sign = async (data: string, secret: string) => {
	const enc = new TextEncoder();

	// edge compatible version to create hmac signature

	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{
			name: 'HMAC',
			hash: { name: 'SHA-256' },
		},
		false,
		['sign', 'verify'],
	);

	const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));

	const hashArray = Array.from(new Uint8Array(signature));

	const digest = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

	return digest;
};

export const toOrderedArray = (obj: Record<string, any>) => {
	return Object.keys(obj)
		.map(function (key) {
			return [key, obj[key]];
		})
		.sort(function (a, b) {
			if (a[0] < b[0]) {
				return -1;
			}
			if (a[0] > b[0]) {
				return 1;
			}
			return 0;
		})
		.map(function (pair) {
			return pair[0] + '=' + pair[1];
		});
};
