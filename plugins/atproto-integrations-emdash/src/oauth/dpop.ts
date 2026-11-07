import type { Http } from "./http";
import { generateSigningKey, publicJwk, randomToken, sha256, signJwt } from "./jwt";

export interface DpopKey {
	jwk: JsonWebKey;
	nonces: Record<string, string>;
}

export interface DpopRequest {
	method: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
}

export const createDpopKey = async (): Promise<DpopKey> => ({ jwk: await generateSigningKey(), nonces: {} });

async function proof(key: DpopKey, url: URL, method: string, accessToken?: string) {
	const nonce = key.nonces[url.origin];
	return signJwt(
		key.jwk,
		{ typ: "dpop+jwt", jwk: publicJwk(key.jwk) },
		{
			jti: randomToken(16),
			htm: method,
			htu: `${url.origin}${url.pathname}`,
			iat: Math.floor(Date.now() / 1000),
			...(nonce ? { nonce } : {}),
			...(accessToken ? { ath: await sha256(accessToken) } : {}),
		},
	);
}

async function asksForNonce(response: Response) {
	if (response.status === 401) return /use_dpop_nonce/.test(response.headers.get("www-authenticate") ?? "");
	if (response.status !== 400) return false;
	const body = (await response.clone().json().catch(() => ({}))) as { error?: string };
	return body.error === "use_dpop_nonce";
}

export async function dpopFetch(
	http: Http,
	key: DpopKey,
	target: string,
	request: DpopRequest,
	accessToken?: string,
) {
	const url = new URL(target);
	const send = async () => {
		const headers: Record<string, string> = {
			...request.headers,
			DPoP: await proof(key, url, request.method, accessToken),
			...(accessToken ? { Authorization: `DPoP ${accessToken}` } : {}),
		};
		const response = await http.fetch(url.href, { method: request.method, headers, body: request.body });
		const previous = key.nonces[url.origin];
		const nonce = response.headers.get("dpop-nonce");
		if (nonce) key.nonces[url.origin] = nonce;
		return { response, refreshed: Boolean(nonce && nonce !== previous) };
	};
	const first = await send();
	if (first.refreshed && (await asksForNonce(first.response))) return (await send()).response;
	return first.response;
}
