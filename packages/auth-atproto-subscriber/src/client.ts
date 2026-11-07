import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import type { ActorIdentifier, Did } from "@atcute/lexicons";
import { MemoryStore, OAuthClient, type StoredSession, type StoredState } from "@atcute/oauth-node-client";
import { SCOPE } from "./policy";
import { dbStore, type EmDash, statesCollection } from "./storage";

const actorResolver = new LocalActorResolver({
	handleResolver: new CompositeHandleResolver({
		strategy: "race",
		methods: {
			dns: new DohJsonHandleResolver({ dohUrl: "https://cloudflare-dns.com/dns-query" }),
			http: new WellKnownHandleResolver(),
		},
	}),
	didDocumentResolver: new CompositeDidDocumentResolver({
		methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() },
	}),
});

const loopback = (origin: string) => ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);

export const loopbackSafe = (origin: string) => origin.replace("://localhost", "://127.0.0.1");

export function clientMetadata(origin: string) {
	const base = loopbackSafe(origin);
	return {
		client_id: `${base}/.well-known/atproto-client-metadata.json`,
		redirect_uris: [`${base}/_emdash/api/auth/atproto/callback`],
		scope: SCOPE,
		application_type: "web",
		subject_type: "public",
		response_types: ["code"],
		grant_types: ["authorization_code", "refresh_token"],
		token_endpoint_auth_method: "none",
		dpop_bound_access_tokens: true,
	};
}

export async function oauthClient(emdash: EmDash, origin: string) {
	const base = loopbackSafe(origin);
	const stores = {
		states: dbStore<string, StoredState>(await statesCollection<StoredState>(emdash)),
		sessions: new MemoryStore<Did, StoredSession>(),
	};
	const redirect_uris: [string] = [`${base}/_emdash/api/auth/atproto/callback`];
	return new OAuthClient({
		metadata: loopback(base)
			? { redirect_uris, scope: SCOPE }
			: { client_id: `${base}/.well-known/atproto-client-metadata.json`, redirect_uris, scope: SCOPE },
		stores,
		actorResolver,
	});
}

export const authorizeTarget = (handle: string) => ({ type: "account" as const, identifier: handle as ActorIdentifier });

export async function resolveProfile(did: Did) {
	const actor = await actorResolver.resolve(did).catch(() => undefined);
	const handle = actor && actor.handle !== "handle.invalid" ? actor.handle : undefined;
	let displayName: string | undefined;
	if (actor) {
		const query = new URLSearchParams({ repo: did, collection: "app.bsky.actor.profile", rkey: "self" });
		const response = await fetch(`${actor.pds}/xrpc/com.atproto.repo.getRecord?${query}`).catch(() => undefined);
		const record = response?.ok ? ((await response.json()) as { value?: { displayName?: string } }) : undefined;
		displayName = record?.value?.displayName?.trim() || undefined;
	}
	return { handle, displayName };
}
