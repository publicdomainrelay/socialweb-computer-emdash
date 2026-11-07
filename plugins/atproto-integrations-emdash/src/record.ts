import { BASE_SCOPE, type ScopeGroup, scopeList } from "./scopes";

export const COLLECTION = "com.fedfork.exec.oauth.clientMetadata";
export const STUDIO_RKEY = "_studio";
export const RKEY = /^[a-zA-Z0-9._:~-]{1,512}$/;
const PLUGIN_ID = "atproto-integrations";

export interface IntegrationRecord {
	name: string;
	description?: string;
	clientMetadata: Record<string, unknown> & { client_id: string; scope: string };
	scopeGroups: ScopeGroup[];
}

export interface IntegrationRef {
	did: string;
	rkey: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function isUrl(value: string) {
	try {
		return Boolean(new URL(value));
	} catch {
		return false;
	}
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export const recordUri = ({ did, rkey }: IntegrationRef) => `at://${did}/${COLLECTION}/${rkey}`;

export function parseRef(input: { did?: unknown; rkey?: unknown }): IntegrationRef {
	const { did, rkey } = input;
	if (typeof did !== "string" || !/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(did)) throw new Error("Invalid DID");
	if (typeof rkey !== "string" || !RKEY.test(rkey) || rkey === "." || rkey === "..") throw new Error("Invalid record key");
	return { did, rkey };
}

export function parseRecord(value: unknown): IntegrationRecord {
	if (!isObject(value) || typeof value.name !== "string" || !isObject(value.clientMetadata)) {
		throw new Error("Not a clientMetadata record");
	}
	const metadata = value.clientMetadata;
	if (typeof metadata.client_id !== "string" || typeof metadata.scope !== "string") {
		throw new Error("clientMetadata needs client_id and scope");
	}
	if (!scopeList(metadata.scope).includes(BASE_SCOPE)) throw new Error("clientMetadata scope must include atproto");
	if (!isUrl(metadata.client_id)) throw new Error("clientMetadata client_id must be a URL");
	const scopeGroups = Array.isArray(value.scopeGroups)
		? value.scopeGroups.filter(isObject).flatMap((group) =>
				typeof group.key === "string" && typeof group.label === "string"
					? [{ key: group.key, label: group.label, scopes: strings(group.scopes) }]
					: [],
			)
		: [];
	return {
		name: value.name,
		description: typeof value.description === "string" ? value.description : undefined,
		clientMetadata: { ...metadata, client_id: metadata.client_id, scope: metadata.scope },
		scopeGroups,
	};
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function clientConfig(origin: string, ref: IntegrationRef, record: IntegrationRecord) {
	const site = new URL(origin);
	if (site.hostname === "localhost") site.hostname = "127.0.0.1";
	const redirectUri = `${site.origin}/_emdash/api/plugins/${PLUGIN_ID}/oauth/callback`;
	const scope = record.clientMetadata.scope;
	const clientId = loopbackHosts.has(site.hostname)
		? `http://localhost?${new URLSearchParams({ redirect_uri: redirectUri, scope })}`
		: `${site.origin}/integrations/${ref.did}/${ref.rkey}/oauth-client-metadata.json`;
	return { origin: site.origin, clientId, redirectUri, scope };
}

const REBASED_FIELDS = ["client_uri", "logo_uri", "tos_uri", "policy_uri"];

export function clientMetadata(origin: string, ref: IntegrationRef, record: IntegrationRecord) {
	const { clientId, redirectUri, scope } = clientConfig(origin, ref, record);
	const template = new URL(record.clientMetadata.client_id).origin;
	const site = new URL(clientId).origin;
	const rebased = Object.fromEntries(
		REBASED_FIELDS.flatMap((field) => {
			const value = record.clientMetadata[field];
			return typeof value === "string" && value.startsWith(template) ? [[field, `${site}${value.slice(template.length)}`]] : [];
		}),
	);
	return {
		client_name: typeof record.clientMetadata.client_name === "string" ? record.clientMetadata.client_name : record.name,
		...rebased,
		client_id: clientId,
		redirect_uris: [redirectUri],
		scope,
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		application_type: "web",
		token_endpoint_auth_method: "none",
		dpop_bound_access_tokens: true,
	};
}
