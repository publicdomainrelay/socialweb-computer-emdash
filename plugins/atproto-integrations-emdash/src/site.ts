import type { PluginContext } from "emdash/plugin";
import { requireHttp } from "./http";
import { COLLECTION, type IntegrationRef } from "./record";

export const SITE_INTEGRATIONS_PATH = "/integrations/site.json";

const TTL_MS = 5 * 60 * 1000;
const AT_URI = /^at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+)\/([a-zA-Z0-9.-]+)\/([a-zA-Z0-9._:~-]{1,512})$/;
const cache = new Map<string, { at: number; refs: IntegrationRef[] }>();

function parseRefs(value: unknown): IntegrationRef[] {
	const uris = typeof value === "object" && value !== null && Array.isArray((value as { integrations?: unknown }).integrations)
		? ((value as { integrations: unknown[] }).integrations)
		: [];
	return uris.flatMap((uri) => {
		const match = typeof uri === "string" ? AT_URI.exec(uri) : null;
		return match && match[2] === COLLECTION ? [{ did: match[1], rkey: match[3] }] : [];
	});
}

export async function siteIntegrations(ctx: PluginContext, origin: string): Promise<IntegrationRef[]> {
	const hit = cache.get(origin);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.refs;
	const response = await requireHttp(ctx)
		.fetch(new URL(SITE_INTEGRATIONS_PATH, origin).href)
		.catch(() => undefined);
	if (!response?.ok) return [];
	const refs = parseRefs(await response.json().catch(() => undefined));
	cache.set(origin, { at: Date.now(), refs });
	return refs;
}

export const isSiteIntegration = (refs: IntegrationRef[], ref: IntegrationRef) => refs.some((item) => item.did === ref.did && item.rkey === ref.rkey);
