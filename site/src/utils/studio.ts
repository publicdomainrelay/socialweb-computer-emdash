import { CLIENT_COLLECTION, listRecords, MODULE_COLLECTION, pdsOf } from "./atproto";
import { atprotoDid, callPlugin } from "./integrations";

export interface StudioGroup {
	key: string;
	label: string;
	scopes: string[];
	granted: boolean;
}

export interface StudioStatus {
	uri: string;
	name: string;
	description?: string;
	connected: boolean;
	account?: string;
	scope?: string;
	groups: StudioGroup[];
}

export interface IntegrationValue {
	name: string;
	description?: string;
	clientMetadata: Record<string, unknown> & { scope: string; client_id: string };
	scopeGroups?: Array<{ key: string; label: string; scopes: string[] }>;
	createdAt?: string;
}

export interface ModuleValue {
	name: string;
	description?: string;
	session: { uri: string };
	source?: { uri: string };
	actions: Array<{ entry: string; label: string; fields: Array<{ key: string; label: string }> }>;
	calls?: string[];
}

export const STUDIO_GROUPS = { integrations: ["integrations"], modules: ["modules"], examples: ["integrations", "modules"] } as const;

export const missingGroups = (status: StudioStatus | undefined, needs: readonly string[]) =>
	needs.filter((key) => !status?.groups.some((group) => group.key === key && group.granted));

export const studioReady = (status: StudioStatus | undefined, needs: readonly string[]) =>
	Boolean(status?.connected) && missingGroups(status, needs).length === 0;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export async function studioContext(locals: App.Locals, url: URL) {
	const did = await atprotoDid(locals);
	if (!did) return { did: undefined, status: undefined, integrations: [], modules: [], error: undefined };
	try {
		const pds = await pdsOf(did);
		const [status, integrations, modules] = await Promise.all([
			callPlugin<StudioStatus>(locals, url, "studio/status", {}).catch((cause: unknown) => message(cause)),
			listRecords<IntegrationValue>(did, CLIENT_COLLECTION, pds),
			listRecords<ModuleValue>(did, MODULE_COLLECTION, pds),
		]);
		return {
			did,
			status: typeof status === "string" ? undefined : status,
			integrations,
			modules,
			error: typeof status === "string" ? status : undefined,
		};
	} catch (cause) {
		return { did, status: undefined, integrations: [], modules: [], error: message(cause) };
	}
}
