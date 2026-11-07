import type { PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import socialweb from "../../../records/socialweb-computer.json";
import statusphere from "../../../records/statusphere.json";

export const SITE_URL = "https://site.example";
export const ALICE = { did: "did:plc:alice", handle: "alice.example", pds: "https://pds.example" };
export const ISSUER = "https://auth.example";
export const RECORDS = { "socialweb-computer": socialweb, statusphere } as const;
export const COLLECTION = "com.publicdomainrelay.temp.oauth.clientMetadata";

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

export async function queueIdentity(host: PluginRuntimeTestHost) {
	await host.http.respond(
		`https://plc.directory/${ALICE.did}`,
		json({ alsoKnownAs: [`at://${ALICE.handle}`], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: ALICE.pds }] }),
	);
}

export async function queueListing(host: PluginRuntimeTestHost) {
	await queueIdentity(host);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(ALICE.did)}&collection=${COLLECTION}&limit=100`,
		json({
			records: Object.entries(RECORDS).map(([rkey, value]) => ({ uri: `at://${ALICE.did}/${COLLECTION}/${rkey}`, cid: "bafy", value })),
		}),
	);
}

export async function connect(host: PluginRuntimeTestHost, user: User, rkey: keyof typeof RECORDS, groups: string[], sub = ALICE.did) {
	await queueIdentity(host);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(ALICE.did)}&collection=${COLLECTION}&rkey=${rkey}`,
		json({ uri: `at://${ALICE.did}/${COLLECTION}/${rkey}`, cid: "bafy", value: RECORDS[rkey] }),
	);
	await host.http.respond(`${ALICE.pds}/.well-known/oauth-protected-resource`, json({ authorization_servers: [ISSUER] }));
	await host.http.respond(
		`${ISSUER}/.well-known/oauth-authorization-server`,
		json({
			issuer: ISSUER,
			authorization_endpoint: `${ISSUER}/oauth/authorize`,
			token_endpoint: `${ISSUER}/oauth/token`,
			pushed_authorization_request_endpoint: `${ISSUER}/oauth/par`,
			revocation_endpoint: `${ISSUER}/oauth/revoke`,
		}),
	);
	await host.http.respond(`${ISSUER}/oauth/par`, json({ error: "use_dpop_nonce" }, 400));
	await host.http.respond(`${ISSUER}/oauth/par`, json({ request_uri: "urn:ietf:params:oauth:request_uri:test" }, 201));
	const started = await call(host, user, "connect", { did: ALICE.did, rkey, groups });
	const par = new URLSearchParams(lastBody(host, `${ISSUER}/oauth/par`));
	await host.http.respond(
		`${ISSUER}/oauth/token`,
		json({ access_token: "access-token", refresh_token: "refresh-token", token_type: "DPoP", expires_in: 3600, scope: par.get("scope"), sub }),
	);
	await queueIdentity(host);
	const query = new URLSearchParams({ code: "code", state: par.get("state") ?? "", iss: ISSUER });
	const callback = await host.actions.routes.request("oauth/callback", {
		method: "GET",
		url: `${SITE_URL}/_emdash/api/plugins/atproto-integrations/oauth/callback?${query}`,
	});
	return { started, par, callback };
}
