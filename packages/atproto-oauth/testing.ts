import type { PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

export const ACCOUNT = {
	did: "did:plc:alice",
	handle: "alice.example",
	pds: "https://pds.example",
	issuer: "https://auth.example",
};

export const SITE_URL = "https://site.example";

const NONCE = "test-nonce";

export const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "DPoP-Nonce": NONCE },
	});

export function useEncryptionKey() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${key}`;
}

const lastBody = (host: PluginRuntimeTestHost, url: string) => {
	const request = host.http.requests().findLast((item) => item.url === url);
	return new TextDecoder().decode(request?.body);
};

export const requestJson = (host: PluginRuntimeTestHost, url: string) => JSON.parse(lastBody(host, url));

async function queueDiscovery(host: PluginRuntimeTestHost) {
	await host.http.respond(`https://${ACCOUNT.handle}/.well-known/atproto-did`, new Response(ACCOUNT.did));
	await host.http.respond(
		`https://plc.directory/${ACCOUNT.did}`,
		json({
			alsoKnownAs: [`at://${ACCOUNT.handle}`],
			service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: ACCOUNT.pds }],
		}),
	);
	await host.http.respond(`${ACCOUNT.pds}/.well-known/oauth-protected-resource`, json({ authorization_servers: [ACCOUNT.issuer] }));
	await host.http.respond(
		`${ACCOUNT.issuer}/.well-known/oauth-authorization-server`,
		json({
			issuer: ACCOUNT.issuer,
			authorization_endpoint: `${ACCOUNT.issuer}/oauth/authorize`,
			token_endpoint: `${ACCOUNT.issuer}/oauth/token`,
			pushed_authorization_request_endpoint: `${ACCOUNT.issuer}/oauth/par`,
		}),
	);
	await host.http.respond(`${ACCOUNT.issuer}/oauth/par`, json({ error: "use_dpop_nonce" }, 400));
	await host.http.respond(`${ACCOUNT.issuer}/oauth/par`, json({ request_uri: "urn:ietf:params:oauth:request_uri:test" }, 201));
}

export async function connect(host: PluginRuntimeTestHost, page: string, actionId: string, values: Record<string, unknown>) {
	await queueDiscovery(host);
	const response = await host.admin.submit(page, actionId, values);
	const par = new URLSearchParams(lastBody(host, `${ACCOUNT.issuer}/oauth/par`));
	await host.http.respond(
		`${ACCOUNT.issuer}/oauth/token`,
		json({
			access_token: "access-token",
			refresh_token: "refresh-token",
			token_type: "DPoP",
			expires_in: 3600,
			scope: par.get("scope"),
			sub: ACCOUNT.did,
		}),
	);
	const slug = host.manifest.id;
	const query = new URLSearchParams({ code: "code", state: par.get("state") ?? "", iss: ACCOUNT.issuer });
	const callback = await host.actions.routes.request("oauth/callback", {
		method: "GET",
		url: `${SITE_URL}/_emdash/api/plugins/${slug}/oauth/callback?${query}`,
	});
	return { response, par, callback };
}
