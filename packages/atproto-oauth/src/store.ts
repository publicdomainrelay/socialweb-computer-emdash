import type { PluginContext } from "emdash/plugin";
import type { DpopKey } from "./dpop";

export interface Endpoints {
	issuer: string;
	tokenEndpoint: string;
	revocationEndpoint?: string;
}

export interface Session extends Endpoints {
	did: string;
	handle?: string;
	pds: string;
	scope: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	dpop: DpopKey;
}

export interface PendingAuthorization extends Endpoints {
	state: string;
	verifier: string;
	did: string;
	handle?: string;
	pds: string;
	dpop: DpopKey;
	createdAt: number;
}

type SecretKey = "session" | "pending";

async function read<T>(ctx: PluginContext, key: SecretKey): Promise<T | undefined> {
	const value = await ctx.settings.get<string>(key);
	return value ? (JSON.parse(value) as T) : undefined;
}

const write = (ctx: PluginContext, key: SecretKey, value: object) => ctx.settings.set(key, JSON.stringify(value));

export const loadSession = (ctx: PluginContext) => read<Session>(ctx, "session");
export const saveSession = (ctx: PluginContext, session: Session) => write(ctx, "session", session);
export const clearSession = (ctx: PluginContext) => ctx.settings.delete("session");

export const loadPending = (ctx: PluginContext) => read<PendingAuthorization>(ctx, "pending");
export const savePending = (ctx: PluginContext, pending: PendingAuthorization) => write(ctx, "pending", pending);
export const clearPending = (ctx: PluginContext) => ctx.settings.delete("pending");

export const setNotice = (ctx: PluginContext, message: string) => ctx.kv.set("state:notice", message);

export async function takeNotice(ctx: PluginContext) {
	const notice = await ctx.kv.get<string>("state:notice");
	if (notice) await ctx.kv.delete("state:notice");
	return notice ?? undefined;
}
