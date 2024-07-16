import { Unit, convert } from 'nanocurrency';
import BigNumber from 'bignumber.js';
import { encodeBase32 } from './base32';

const MAX_DECIMALS = 6;

// Remove decimals without rounding
export const toFixedSafe = (num: number | string, fixed: number) => {
	const re = new RegExp('^-?\\d+(?:.\\d{0,' + (fixed || -1) + '})?');
	const match = num.toString().match(re);
	if (!match) throw new Error('toFixedSafe: invalid number');
	return match[0];
};

export const rawToNano = (raw: string) => {
	const nanoAmount = convert(raw, { from: Unit.raw, to: Unit.NANO });
	const fixedAmount = toFixedSafe(nanoAmount, MAX_DECIMALS);
	return Number(fixedAmount);
};

export const parseTime = (time: string | number) => {
	const date = new Date(time);
	if (isNaN(date.getTime())) {
		throw new Error('Invalid date');
	}
	return date.getTime();
};

export const getHeaders = (headers: Headers) => {
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
		result[key] = value;
	});
	return result;
};

export const TunedBigNumber = BigNumber.clone({
	EXPONENTIAL_AT: 1e9,
	DECIMAL_PLACES: 36,
});

interface FetchWithTimeoutOptions extends Omit<RequestInit<RequestInitCfProperties>, 'signal'> {
	timeout: number;
	body?: any;
}

export const fetchWithTimeout = async (url: string, { timeout, ...options }: FetchWithTimeoutOptions): Promise<Response> => {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	const headers: Record<string, string> = {
		...options.headers,
	};
	if (typeof options.body === 'object') {
		headers['Content-Type'] = 'application/json';
	}
	const body = typeof options.body === 'object' ? JSON.stringify(options.body) : options.body;
	const response = await fetch(url, {
		...options,
		body,
		headers,
		signal: controller.signal,
	});
	clearTimeout(id);
	return response;
};

export const generateInvoiceId = (): string => {
	const random = crypto.getRandomValues(new Uint8Array(5));
	const encoded = encodeBase32(random);
	return encoded.slice(0, 4) + '-' + encoded.slice(4, 8);
};

export const isFalsyLike = (value: unknown): boolean => {
	return value === false || value === 'false' || value === 0 || value === '0' || value === undefined || value === null;
};
