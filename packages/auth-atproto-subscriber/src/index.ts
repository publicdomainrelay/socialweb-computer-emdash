import type { AuthProviderDescriptor } from "emdash";
import { type AtprotoSubscriberConfig, PROVIDER_ID, STORAGE } from "./policy";

export type { AtprotoSubscriberConfig } from "./policy";

const PACKAGE = "auth-atproto-subscriber";

export function atprotoSubscriber(config: AtprotoSubscriberConfig = {}): AuthProviderDescriptor {
	return {
		id: PROVIDER_ID,
		label: "Atmosphere",
		config,
		adminEntry: `${PACKAGE}/admin`,
		routes: [
			{ pattern: "/_emdash/api/auth/atproto/login", entrypoint: `${PACKAGE}/routes/login.ts` },
			{ pattern: "/_emdash/api/auth/atproto/callback", entrypoint: `${PACKAGE}/routes/callback.ts` },
			{ pattern: "/_emdash/api/setup/atproto-admin", entrypoint: `${PACKAGE}/routes/setup-admin.ts` },
			{ pattern: "/.well-known/atproto-client-metadata.json", entrypoint: `${PACKAGE}/routes/client-metadata.ts` },
		],
		publicRoutes: ["/_emdash/api/auth/atproto/"],
		storage: STORAGE,
	};
}
