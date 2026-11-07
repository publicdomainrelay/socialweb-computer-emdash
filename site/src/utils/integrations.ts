const PLUGIN = "atproto-integrations";

interface IntegrationGroup {
	key: string;
	label: string;
	scopes: string[];
	granted: boolean;
}

interface IntegrationModule {
	did: string;
	rkey: string;
	uri: string;
	name: string;
	description?: string;
	source?: string;
	actions: Array<{ entry: string; label: string; description?: string; fields: Array<{ key: string; label: string }> }>;
}

export interface Integration {
	did: string;
	rkey: string;
	uri: string;
	name: string;
	description?: string;
	declaredScope: string;
	groups: IntegrationGroup[];
	site: boolean;
	session: { handle?: string; scope: string; updatedAt: string } | null;
	modules: IntegrationModule[];
}

export async function atprotoDid(locals: App.Locals) {
	if (!locals.user || !locals.emdash) return undefined;
	const row = await locals.emdash.db
		.selectFrom("oauth_accounts")
		.select("provider_account_id")
		.where("user_id", "=", locals.user.id)
		.where("provider", "=", "atproto")
		.executeTakeFirst();
	return row?.provider_account_id;
}

function unwrap<T>(route: string, result: { success: boolean; data?: unknown; error?: { message: string } }) {
	if (!result.success) throw new Error(result.error?.message ?? `${route} failed`);
	return result.data as T;
}

export async function callPlugin<T>(locals: App.Locals, url: URL, route: string, input: unknown): Promise<T> {
	if (!locals.emdash?.handlePluginApiRoute || !locals.user) throw new Error("Sign in first");
	const target = new URL(`/_emdash/api/plugins/${PLUGIN}/${route}`, url);
	const request = new Request(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
	const { id, email, name, role, createdAt } = locals.user;
	return unwrap<T>(route, await locals.emdash.handlePluginApiRoute(PLUGIN, "POST", `/${route}`, request, { id, email, name: name ?? null, role, createdAt }));
}

export async function callPublicPlugin<T>(locals: App.Locals, url: URL, route: string, query: Record<string, string>): Promise<T> {
	const handle = locals.emdash?.handlePublicPluginApiRoute ?? locals.emdash?.handlePluginApiRoute;
	if (!handle) throw new Error("EmDash is not initialized");
	const target = new URL(`/_emdash/api/plugins/${PLUGIN}/${route}?${new URLSearchParams(query)}`, url);
	return unwrap<T>(route, await handle(PLUGIN, "GET", `/${route}`, new Request(target)));
}

export async function postPublicPlugin<T>(locals: App.Locals, url: URL, route: string, input: unknown): Promise<T> {
	const handle = locals.emdash?.handlePublicPluginApiRoute ?? locals.emdash?.handlePluginApiRoute;
	if (!handle) throw new Error("EmDash is not initialized");
	const target = new URL(`/_emdash/api/plugins/${PLUGIN}/${route}`, url);
	const request = new Request(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
	return unwrap<T>(route, await handle(PLUGIN, "POST", `/${route}`, request));
}
