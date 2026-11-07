import { findOrCreateOAuthUser, OAuthError, type OAuthProfile, Role, type RoleLevel, toRoleLevel } from "@emdash-cms/auth";
import { type AuthTables, createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIRoute } from "astro";
import { finalizeSetup, getPublicOrigin, OptionsRepository } from "emdash/api/route-utils";
import type { Kysely } from "kysely";
import { oauthClient, resolveProfile } from "../client";
import { type AtprotoSubscriberConfig, allowsSignup, isAllowed, RETURN_TO_KEY, safeReturnTo, withError } from "../policy";
import { providerConfig } from "../storage";

export const prerender = false;

const MESSAGES: Record<string, string> = {
	signup_not_allowed: "Self-signup is not allowed. Please contact an administrator.",
	user_not_found: "Your account was not found. It may have been deleted.",
};

function roleFor(config: AtprotoSubscriberConfig): RoleLevel {
	try {
		return config.defaultRole == null ? Role.SUBSCRIBER : toRoleLevel(config.defaultRole);
	} catch {
		return Role.SUBSCRIBER;
	}
}

export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
	const returnTo = safeReturnTo(await session?.get(RETURN_TO_KEY));
	session?.delete(RETURN_TO_KEY);
	const fail = (code: string, message: string) =>
		redirect(returnTo ? withError(returnTo, message) : `/_emdash/admin/login?error=${code}&message=${encodeURIComponent(message)}`);

	const { emdash } = locals;
	if (!emdash?.db) return fail("server_error", "Database not configured");
	const url = new URL(request.url);
	const denied = url.searchParams.get("error");
	if (denied) return fail("atproto_denied", url.searchParams.get("error_description") || denied);

	try {
		const client = await oauthClient(emdash, getPublicOrigin(url, emdash.config));
		const { session: oauthSession } = await client.callback(url.searchParams);
		const did = oauthSession.did;
		await oauthSession.signOut().catch(() => undefined);

		const config = (providerConfig(emdash)?.config ?? {}) as AtprotoSubscriberConfig;
		const { handle, displayName } = await resolveProfile(did);
		const options = new OptionsRepository(emdash.db);
		const setupComplete = await options.get("emdash:setup_complete");
		const isFirstUser = setupComplete !== true && setupComplete !== "true";
		const allowed = isAllowed(config, { did, handle });
		if (!isFirstUser && allowsSignup(config) && !allowed) return fail("not_allowed", "Your account is not in the allowlist");

		const setupState = isFirstUser ? await options.get<Record<string, unknown>>("emdash:setup_state") : undefined;
		const name = displayName ?? handle ?? did;
		const profile: OAuthProfile = {
			id: did,
			email: (typeof setupState?.email === "string" && setupState.email) || `${did.replaceAll(":", "-")}@atproto.invalid`,
			name,
			avatarUrl: null,
			emailVerified: isFirstUser,
		};
		const adapter = createKyselyAdapter(emdash.db as unknown as Kysely<AuthTables>);
		const user = await findOrCreateOAuthUser(adapter, "atproto", profile, async () => {
			if (isFirstUser) return { allowed: true, role: Role.ADMIN };
			return allowed ? { allowed: true, role: roleFor(config) } : null;
		});
		if (isFirstUser) await finalizeSetup(emdash.db);
		if (user.name !== name) await adapter.updateUser(user.id, { name });
		if (user.disabled) return fail("account_disabled", "Account disabled");

		session?.set("user", { id: user.id });
		return redirect(returnTo ?? "/_emdash/admin");
	} catch (error) {
		console.error("[auth-atproto-subscriber] Callback error:", error);
		if (error instanceof OAuthError) return fail(error.code, MESSAGES[error.code] ?? "Atmosphere sign-in failed");
		return fail("atproto_error", "Atmosphere sign-in failed. Please try again.");
	}
};
