import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { ACCOUNT, connect, json, requestJson, SITE_URL, useEncryptionKey } from "atproto-oauth-sandbox/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

const texts = (response: { blocks: unknown[] }) => JSON.stringify(response.blocks);

describe("statusphere", () => {
	it("serves its own client metadata document", async () => {
		const response = await host.actions.routes.request("oauth/client-metadata", { method: "GET" });
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toMatchObject({
			client_id: `${SITE_URL}/_emdash/api/plugins/statusphere/oauth/client-metadata`,
			redirect_uris: [`${SITE_URL}/_emdash/api/plugins/statusphere/oauth/callback`],
			scope: "atproto repo:xyz.statusphere.status rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview",
		});
	});

	it("connects with only the status scope, then upgrades to read the profile", async () => {
		const { response, par, callback } = await connect(host, "/connect", "oauth:connect", {
			identifier: ACCOUNT.handle,
			groups: ["status"],
		});
		expect(texts(response)).toContain(`${ACCOUNT.issuer}/oauth/authorize?`);
		expect(par.get("scope")).toBe("atproto repo:xyz.statusphere.status");
		expect(callback.status).toBe(303);
		expect(callback.headers.get("location")).toBe("/_emdash/admin/plugins/statusphere/connect");
		expect(JSON.stringify(await host.inspect.settings.raw("session"))).not.toContain("access-token");

		const status = await host.admin.loadPage("/status");
		expect(texts(status)).toContain("Show your Bluesky profile");
		expect(texts(status)).toContain("status:set");

		await host.http.respond(
			`${ACCOUNT.pds}/xrpc/com.atproto.repo.createRecord`,
			json({ uri: `at://${ACCOUNT.did}/xyz.statusphere.status/3k`, cid: "bafy" }),
		);
		const posted = await host.admin.act("/status", "status:set", { value: "🦋" });
		expect(posted.toast).toMatchObject({ type: "success" });
		expect(requestJson(host, `${ACCOUNT.pds}/xrpc/com.atproto.repo.createRecord`)).toMatchObject({
			repo: ACCOUNT.did,
			collection: "xyz.statusphere.status",
			record: { $type: "xyz.statusphere.status", status: "🦋" },
		});
		expect(await host.inspect.storage.list("statuses")).toHaveLength(1);

		const upgrade = await connect(host, "/connect", "oauth:upgrade", { groups: ["profile"] });
		expect(upgrade.par.get("scope")).toBe(
			"atproto repo:xyz.statusphere.status rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview",
		);
		await host.http.respond(
			`${ACCOUNT.pds}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(ACCOUNT.did)}`,
			json({ handle: ACCOUNT.handle, displayName: "Alice", followersCount: 7 }),
		);
		expect(texts(await host.admin.loadPage("/status"))).toContain("Alice");
		const proxied = host.http.requests().find((request) => request.url.includes("getProfile"));
		expect(proxied?.headers["atproto-proxy"]).toBe("did:web:api.bsky.app#bsky_appview");
	});

	it("posts the configured status when content is published", async () => {
		await connect(host, "/connect", "oauth:connect", { identifier: ACCOUNT.handle, groups: ["status"] });
		await host.admin.submit("/status", "status:publish", { publishEmoji: "🚀" });
		await host.http.respond(
			`${ACCOUNT.pds}/xrpc/com.atproto.repo.createRecord`,
			json({ uri: `at://${ACCOUNT.did}/xyz.statusphere.status/3p`, cid: "bafy" }),
		);
		await host.transport.invokeHook("content:afterPublish", { collection: "posts", content: { id: "post-1" } });
		expect(requestJson(host, `${ACCOUNT.pds}/xrpc/com.atproto.repo.createRecord`).record.status).toBe("🚀");
	});
});
