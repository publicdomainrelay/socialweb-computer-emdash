import type { PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import socialweb from "../../../records/socialweb-computer.json";
import statusphere from "../../../records/statusphere.json";

export const SITE_URL = "https://site.example";
export const ALICE = { did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz", handle: "alice.example", pds: "https://pds.example" };
export const ISSUER = "https://auth.example";
export const RECORDS = { "socialweb-computer": socialweb, statusphere } as const;
export const COLLECTION = "com.fedfork.exec.oauth.clientMetadata";
export const MODULE_COLLECTION = "com.fedfork.exec.wasm.module";

type User = Awaited<ReturnType<PluginRuntimeTestHost["fixtures"]["user"]>>;

export const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "DPoP-Nonce": "nonce" } });

export function useEncryptionKey() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function call(host: PluginRuntimeTestHost, user: User, route: string, body: unknown) {
	const response = await host.actions.routes.request(route, { method: "POST", user, headers: { "X-EmDash-Request": "1" }, body });
	return (await response.json()) as { success: boolean; data: any; error?: { message: string } };
}

const lastBody = (host: PluginRuntimeTestHost, url: string) =>
	new TextDecoder().decode(host.http.requests().findLast((request) => request.url === url)?.body);

export const didDocument = (verificationMethod: unknown[] = []) => ({
	"@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
	id: ALICE.did,
	alsoKnownAs: [`at://${ALICE.handle}`],
	verificationMethod,
	service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: ALICE.pds }],
});

export async function queueIdentity(host: PluginRuntimeTestHost, document: unknown = didDocument(), times = 1) {
	for (let index = 0; index < times; index++) {
		await host.http.respond(`https://plc.directory/${encodeURIComponent(ALICE.did)}`, json(document));
		await host.http.respond(`https://${ALICE.handle}/.well-known/atproto-did`, new Response(ALICE.did));
	}
}

export async function queueListing(host: PluginRuntimeTestHost, modules: Array<{ uri: string; cid: string; value: unknown }> = []) {
	await queueIdentity(host);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(ALICE.did)}&collection=${COLLECTION}&limit=100`,
		json({
			records: Object.entries(RECORDS).map(([rkey, value]) => ({ uri: `at://${ALICE.did}/${COLLECTION}/${rkey}`, cid: "bafy", value })),
		}),
	);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(ALICE.did)}&collection=${MODULE_COLLECTION}&limit=100`,
		json({ records: modules }),
	);
}

export async function queueAuthorizationServer(host: PluginRuntimeTestHost) {
	await host.http.respond(
		`${ALICE.pds}/.well-known/oauth-protected-resource`,
		json({ resource: ALICE.pds, authorization_servers: [ISSUER], scopes_supported: [], bearer_methods_supported: ["header"] }),
	);
	await host.http.respond(
		`${ISSUER}/.well-known/oauth-authorization-server`,
		json({
			issuer: ISSUER,
			scopes_supported: ["atproto"],
			response_types_supported: ["code"],
			response_modes_supported: ["query", "fragment", "form_post"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			authorization_response_iss_parameter_supported: true,
			authorization_endpoint: `${ISSUER}/oauth/authorize`,
			token_endpoint: `${ISSUER}/oauth/token`,
			token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
			revocation_endpoint: `${ISSUER}/oauth/revoke`,
			pushed_authorization_request_endpoint: `${ISSUER}/oauth/par`,
			require_pushed_authorization_requests: true,
			dpop_signing_alg_values_supported: ["ES256"],
			client_id_metadata_document_supported: true,
		}),
	);
}

export async function connect(host: PluginRuntimeTestHost, user: User, rkey: keyof typeof RECORDS, groups: string[], sub = ALICE.did, expiresIn = 3600) {
	await queueIdentity(host, didDocument(), 2);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(ALICE.did)}&collection=${COLLECTION}&rkey=${rkey}`,
		json({ uri: `at://${ALICE.did}/${COLLECTION}/${rkey}`, cid: "bafy", value: RECORDS[rkey] }),
	);
	await queueAuthorizationServer(host);
	await host.http.respond(`${ISSUER}/oauth/par`, json({ error: "use_dpop_nonce" }, 400));
	await host.http.respond(`${ISSUER}/oauth/par`, json({ request_uri: "urn:ietf:params:oauth:request_uri:test", expires_in: 299 }, 201));
	const started = await call(host, user, "connect", { did: ALICE.did, rkey, groups });
	const par = new URLSearchParams(lastBody(host, `${ISSUER}/oauth/par`));
	await host.http.respond(
		`${ISSUER}/oauth/token`,
		json({ access_token: "access-token", refresh_token: "refresh-token", token_type: "DPoP", expires_in: expiresIn, scope: par.get("scope"), sub }),
	);
	await queueIdentity(host, didDocument(), 2);
	await queueAuthorizationServer(host);
	await queueAuthorizationServer(host);
	await host.http.respond(`${ISSUER}/oauth/revoke`, new Response(null, { status: 200 }));
	const query = new URLSearchParams({ code: "code", state: par.get("state") ?? "", iss: ISSUER });
	const callback = await host.actions.routes.request("oauth/callback", {
		method: "GET",
		url: `${SITE_URL}/_emdash/api/plugins/atproto-integrations/oauth/callback?${query}`,
	});
	return { started, par, callback };
}
