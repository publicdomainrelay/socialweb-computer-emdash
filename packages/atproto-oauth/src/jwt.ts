const encoder = new TextEncoder();
const curve = { name: "ECDSA", namedCurve: "P-256" } as const;

export const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

const encodeJson = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

export const randomToken = (size = 32) => base64url(crypto.getRandomValues(new Uint8Array(size)));

export const sha256 = async (value: string) =>
	base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

export const publicJwk = ({ kty, crv, x, y }: JsonWebKey): JsonWebKey => ({ kty, crv, x, y });

export async function generateSigningKey(): Promise<JsonWebKey> {
	const pair = await crypto.subtle.generateKey(curve, true, ["sign", "verify"]);
	return crypto.subtle.exportKey("jwk", pair.privateKey);
}

export async function signJwt(jwk: JsonWebKey, header: object, payload: object) {
	const key = await crypto.subtle.importKey("jwk", jwk, curve, false, ["sign"]);
	const input = `${encodeJson({ alg: "ES256", ...header })}.${encodeJson(payload)}`;
	const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(input));
	return `${input}.${base64url(new Uint8Array(signature))}`;
}
