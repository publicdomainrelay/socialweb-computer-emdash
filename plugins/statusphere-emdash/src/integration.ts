import type { Integration } from "atproto-oauth-sandbox";

export const STATUS_COLLECTION = "xyz.statusphere.status";
export const BSKY_APPVIEW = "did:web:api.bsky.app#bsky_appview";

export const integration: Integration = {
	name: "Statusphere",
	groups: [
		{ id: "status", label: "Set your Statusphere status", scopes: [`repo:${STATUS_COLLECTION}`] },
		{ id: "profile", label: "Show your Bluesky profile", scopes: [`rpc:app.bsky.actor.getProfile?aud=${BSKY_APPVIEW}`] },
	],
};

export const EMOJIS = ["👍", "👎", "💙", "😎", "🦋", "🚀"];
