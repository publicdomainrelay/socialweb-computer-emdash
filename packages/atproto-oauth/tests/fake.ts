import type { PluginContext } from "emdash/plugin";
import { sha256 } from "../src/jwt";

const decode = (part: string) =>
	JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));

async function verifyProof(proof: string, method: string, url: URL, nonce: string, accessToken?: string) {
	const [header, payload, signature] = proof.split(".");
	const { jwk, typ, alg } = decode(header);
	const claims = decode(payload);
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
	const valid = await crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
		new TextEncoder().encode(`${header}.${payload}`),
	);
	if (!valid || typ !== "dpop+jwt" || alg !== "ES256") return "invalid_dpop_proof";
	if (claims.htm !== method || claims.htu !== `${url.origin}${url.pathname}`) return "invalid_dpop_proof";
	if (accessToken && claims.ath !== (await sha256(accessToken))) return "invalid_dpop_proof";
	if (claims.nonce !== nonce) return "use_dpop_nonce";
	return undefined;
}

export function fakeNetwork() {
	const did = "did:plc:alice";
	const pds = "https://pds.example";
	const issuer = "https://auth.example";
	const nonce = "server-nonce";
	const requests: Array<{ url: string; method: string; body?: string }> = [];
	const par = new Map<string, URLSearchParams>();
	const codes = new Map<string, URLSearchParams>();
	const records: Array<Record<string, unknown>> = [];
	let accessToken = "";

	const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

	const issueToken = (scope: string) => {
		accessToken = crypto.randomUUID();
		return json({ access_token: accessToken, refresh_token: crypto.randomUUID(), expires_in: 3600, scope, sub: did, token_type: "DPoP" }, 200, { "DPoP-Nonce": nonce });
	};

	const fetch = async (input: string, init: RequestInit = {}) => {
		const url = new URL(input);
		const method = init.method ?? "GET";
		const headers = (init.headers ?? {}) as Record<string, string>;
		requests.push({ url: input, method, body: init.body as string | undefined });
		if (url.href === "https://alice.example/.well-known/atproto-did") return new Response(did);
		if (url.href === `https://plc.directory/${did}`) {
			return json({ alsoKnownAs: ["at://alice.example"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: pds }] });
		}
		if (url.href === `${pds}/.well-known/oauth-protected-resource`) return json({ authorization_servers: [issuer] });
		if (url.href === `${issuer}/.well-known/oauth-authorization-server`) {
			return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, pushed_authorization_request_endpoint: `${issuer}/par` });
		}
		const problem = headers.DPoP ? await verifyProof(headers.DPoP, method, url, nonce, url.origin === pds ? accessToken : undefined) : "invalid_dpop_proof";
		if (problem && url.origin === pds) {
			return new Response("{}", { status: 401, headers: { "WWW-Authenticate": `DPoP error="${problem}"`, "DPoP-Nonce": nonce } });
		}
		if (problem) return json({ error: problem }, 400, { "DPoP-Nonce": nonce });
		const form = new URLSearchParams(init.body as string);
		if (url.href === `${issuer}/par`) {
			const requestUri = `urn:request:${crypto.randomUUID()}`;
			par.set(requestUri, form);
			return json({ request_uri: requestUri }, 201, { "DPoP-Nonce": nonce });
		}
		if (url.href === `${issuer}/token` && form.get("grant_type") === "authorization_code") {
			const request = codes.get(form.get("code") ?? "");
			if (!request || (await sha256(form.get("code_verifier") ?? "")) !== request.get("code_challenge")) return json({ error: "invalid_grant" }, 400);
			return issueToken(request.get("scope") ?? "");
		}
		if (url.href === `${pds}/xrpc/com.atproto.repo.createRecord`) {
			if (headers.Authorization !== `DPoP ${accessToken}`) return json({ error: "AuthRequired" }, 401);
			const body = JSON.parse(init.body as string);
			records.push(body);
			return json({ uri: `at://${did}/${body.collection}/1`, cid: "bafy" }, 200, { "DPoP-Nonce": nonce });
		}
		return json({ error: "NotFound" }, 404);
	};

	const approve = (authorizeUrl: string) => {
		const request = par.get(new URL(authorizeUrl).searchParams.get("request_uri") ?? "");
		if (!request) throw new Error("unknown request_uri");
		const code = crypto.randomUUID();
		codes.set(code, request);
		return { code, state: request.get("state") ?? "", iss: issuer, scope: request.get("scope") ?? "" };
	};

	return { did, pds, issuer, requests, records, fetch, approve };
}

export function fakeContext(fetch: (input: string, init?: RequestInit) => Promise<Response>, siteUrl = "https://site.example") {
	const settings = new Map<string, unknown>();
	const kv = new Map<string, unknown>();
	const store = (map: Map<string, unknown>) => ({
		get: async (key: string) => (map.has(key) ? map.get(key) : null),
		set: async (key: string, value: unknown) => void map.set(key, value),
		delete: async (key: string) => map.delete(key),
	});
	const ctx = {
		plugin: { id: "statusphere", version: "0.1.0" },
		site: { url: siteUrl, name: "Site", locale: "en" },
		settings: store(settings),
		kv: store(kv),
		http: { fetch },
		log: { debug() {}, info() {}, warn() {}, error() {} },
	} as unknown as PluginContext;
	return { ctx, settings, kv };
}
