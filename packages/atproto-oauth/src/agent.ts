import type { PluginContext } from "emdash/plugin";
import type { Integration } from "./client";
import { dpopFetch } from "./dpop";
import { requireHttp } from "./http";
import { refreshSession } from "./oauth";
import { grantedGroupIds } from "./scopes";
import { loadSession, type Session, saveSession } from "./store";

const REFRESH_MARGIN_MS = 60 * 1000;

export interface XrpcCall {
	method?: "GET" | "POST";
	params?: Record<string, string>;
	input?: unknown;
	proxy?: string;
}

export class XrpcError extends Error {
	constructor(
		readonly nsid: string,
		readonly status: number,
		readonly error?: string,
	) {
		super(`${nsid} failed with ${error ?? status}`);
	}
}

export class MissingScopeError extends Error {
	constructor(readonly groupId: string) {
		super(`Connect with the ${groupId} permission group first`);
	}
}

export async function connectedAgent(ctx: PluginContext, integration: Integration) {
	const stored = await loadSession(ctx);
	return stored ? createAgent(ctx, integration, stored) : undefined;
}

function createAgent(ctx: PluginContext, integration: Integration, initial: Session) {
	const http = requireHttp(ctx);
	let session = initial;

	const send = async (nsid: string, call: XrpcCall) => {
		const method = call.method ?? (call.input === undefined ? "GET" : "POST");
		const query = call.params ? `?${new URLSearchParams(call.params)}` : "";
		const nonces = JSON.stringify(session.dpop.nonces);
		const response = await dpopFetch(
			http,
			session.dpop,
			`${session.pds}/xrpc/${nsid}${query}`,
			{
				method,
				headers: {
					...(call.input === undefined ? {} : { "Content-Type": "application/json" }),
					...(call.proxy ? { "atproto-proxy": call.proxy } : {}),
				},
				body: call.input === undefined ? undefined : JSON.stringify(call.input),
			},
			session.accessToken,
		);
		if (JSON.stringify(session.dpop.nonces) !== nonces) await saveSession(ctx, session);
		return response;
	};

	const call = async <T = unknown>(nsid: string, options: XrpcCall = {}): Promise<T> => {
		if (session.expiresAt - REFRESH_MARGIN_MS < Date.now()) session = await refreshSession(ctx, integration, session);
		let response = await send(nsid, options);
		if (response.status === 401 && /invalid_token/.test(response.headers.get("www-authenticate") ?? "")) {
			session = await refreshSession(ctx, integration, session);
			response = await send(nsid, options);
		}
		const body = (await response.json().catch(() => ({}))) as T & { error?: string };
		if (!response.ok) throw new XrpcError(nsid, response.status, body.error);
		return body;
	};

	const requireGroup = (groupId: string) => {
		if (!grantedGroupIds(integration.groups, session.scope).includes(groupId)) throw new MissingScopeError(groupId);
	};

	return {
		get session() {
			return session;
		},
		call,
		requireGroup,
		createRecord: (collection: string, record: Record<string, unknown>) =>
			call<{ uri: string; cid: string }>("com.atproto.repo.createRecord", {
				input: { repo: session.did, collection, record: { $type: collection, ...record } },
			}),
		deleteRecord: (collection: string, rkey: string) =>
			call("com.atproto.repo.deleteRecord", { input: { repo: session.did, collection, rkey } }),
	};
}

export type Agent = NonNullable<Awaited<ReturnType<typeof connectedAgent>>>;
