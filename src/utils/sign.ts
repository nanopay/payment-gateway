/*
 * Use Web Crypto API to create HMAC-SHA256 signature
 * Returns the signature as a hex string
 */
export const sign = async (data: string, secret: string) => {
	const algorithm = { name: "HMAC", hash: "SHA-256" };

	const enc = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		algorithm,
		false,
		["sign", "verify"]
	);

	const signature = await crypto.subtle.sign(
		algorithm.name,
		key,
		enc.encode(data)
	);

	const digestHex = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return digestHex;
};
