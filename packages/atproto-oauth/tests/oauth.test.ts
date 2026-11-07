import { describe, expect, it } from "vitest";
import {
	beginAuthorization,
	clientConfig,
	clientMetadata,
	completeAuthorization,
	connectedAgent,
	declaredScope,
	grantedGroupIds,
	type Integration,
	MissingScopeError,
	requestedScope,
} from "../src";
import { fakeContext, fakeNetwork } from "./fake";

const integration: Integration = {
	name: "Statusphere",
	groups: [
		{ id: "status", label: "Post statuses", scopes: ["repo:xyz.statusphere.status"] },
		{ id: "profile", label: "Read profile", scopes: ["rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview"] },
	],
};

describe("scopes", () => {
	it("declares every group and requests a subset", () => {
		expect(declaredScope(integration.groups)).toBe(
			"atproto repo:xyz.statusphere.status rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview",
		);
		expect(requestedScope(integration.groups, ["status"])).toBe("atproto repo:xyz.statusphere.status");
		expect(grantedGroupIds(integration.groups, "atproto repo:xyz.statusphere.status")).toEqual(["status"]);
	});
});

describe("client metadata", () => {
	it("serves a CIMD on public sites", () => {
		const { ctx } = fakeContext(fetch);
		expect(clientMetadata(ctx, integration)).toMatchObject({
			client_id: "https://site.example/_emdash/api/plugins/statusphere/oauth-client-metadata.json",
			redirect_uris: ["https://site.example/_emdash/api/plugins/statusphere/oauth/callback"],
			dpop_bound_access_tokens: true,
			token_endpoint_auth_method: "none",
		});
	});

	it("uses a loopback client_id during local development", () => {
		const { ctx } = fakeContext(fetch, "http://localhost:4321");
		const { clientId, redirectUri } = clientConfig(ctx, integration);
		const url = new URL(clientId);
		expect(url.origin).toBe("http://localhost");
		expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
		expect(redirectUri).toBe("http://127.0.0.1:4321/_emdash/api/plugins/statusphere/oauth/callback");
		expect(url.searchParams.get("scope")).toBe(declaredScope(integration.groups));
	});
});

describe("authorization flow", () => {
	it("connects with a subset, writes records and upgrades progressively", async () => {
		const network = fakeNetwork();
		const { ctx } = fakeContext(network.fetch);
		const first = await beginAuthorization(ctx, integration, "@Alice.example", ["status"]);
		const approval = network.approve(first);
		expect(approval.scope).toBe("atproto repo:xyz.statusphere.status");
		const session = await completeAuthorization(ctx, integration, approval);
		expect(session).toMatchObject({ did: network.did, handle: "alice.example", issuer: network.issuer });

		const agent = await connectedAgent(ctx, integration);
		agent?.requireGroup("status");
		expect(() => agent?.requireGroup("profile")).toThrow(MissingScopeError);
		await expect(agent?.createRecord("xyz.statusphere.status", { status: "🦋" })).resolves.toMatchObject({ cid: "bafy" });
		expect(network.records[0]).toMatchObject({ repo: network.did, record: { $type: "xyz.statusphere.status", status: "🦋" } });

		const upgrade = network.approve(await beginAuthorization(ctx, integration, network.did, ["status", "profile"]));
		await completeAuthorization(ctx, integration, upgrade);
		(await connectedAgent(ctx, integration))?.requireGroup("profile");
	});

	it("rejects a callback with a mismatched issuer", async () => {
		const network = fakeNetwork();
		const { ctx } = fakeContext(network.fetch);
		const approval = network.approve(await beginAuthorization(ctx, integration, "alice.example", ["status"]));
		await expect(completeAuthorization(ctx, integration, { ...approval, iss: "https://evil.example" })).rejects.toThrow("issuer");
	});

	it("rejects unknown state", async () => {
		const network = fakeNetwork();
		const { ctx } = fakeContext(network.fetch);
		await expect(completeAuthorization(ctx, integration, { state: "nope" })).rejects.toThrow("Unknown");
	});
});
