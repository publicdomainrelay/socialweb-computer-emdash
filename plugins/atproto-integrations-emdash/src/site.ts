import type { PluginContext } from "emdash/plugin";
import { COLLECTION, type IntegrationRef } from "./record";

export const SITE_INTEGRATIONS_SETTING = "siteIntegrations";

const AT_URI = /^at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+)\/([a-zA-Z0-9.-]+)\/([a-zA-Z0-9._:~-]{1,512})$/;

export function parseSiteIntegrations(value: unknown): IntegrationRef[] {
	return (typeof value === "string" ? value.split(/\s+/) : []).flatMap((uri) => {
		const match = AT_URI.exec(uri);
		return match && match[2] === COLLECTION ? [{ did: match[1], rkey: match[3] }] : [];
	});
}

export async function siteIntegrations(ctx: PluginContext): Promise<IntegrationRef[]> {
	return parseSiteIntegrations(await ctx.settings.get<string>(SITE_INTEGRATIONS_SETTING));
}

export const isSiteIntegration = (refs: IntegrationRef[], ref: IntegrationRef) => refs.some((item) => item.did === ref.did && item.rkey === ref.rkey);
