import { CLIENT_COLLECTION, listRecords, MODULE_COLLECTION, pdsOf, rkeyOf, STUDIO_RKEY } from "./atproto";
import { atprotoDid, callPlugin } from "./integrations";

export interface StudioStatus {
	connected: boolean;
	requested: string;
	scope?: string;
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

export const missingScopes = (status: StudioStatus) => {
	const granted = new Set((status.scope ?? "").split(" "));
	return status.requested.split(" ").filter((scope) => scope && !granted.has(scope));
};

export async function studioContext(locals: App.Locals, url: URL) {
	const did = await atprotoDid(locals);
	if (!did) return { did: undefined, status: undefined, integrations: [], modules: [], error: undefined };
	try {
		const pds = await pdsOf(did);
		const [status, integrations, modules] = await Promise.all([
			callPlugin<StudioStatus>(locals, url, "studio/status", { did }),
			listRecords<IntegrationValue>(did, CLIENT_COLLECTION, pds),
			listRecords<ModuleValue>(did, MODULE_COLLECTION, pds),
		]);
		return {
			did,
			status,
			integrations: integrations.filter((record) => rkeyOf(record.uri) !== STUDIO_RKEY),
			modules,
			error: undefined,
		};
	} catch (cause) {
		return { did, status: undefined, integrations: [], modules: [], error: cause instanceof Error ? cause.message : String(cause) };
	}
}
