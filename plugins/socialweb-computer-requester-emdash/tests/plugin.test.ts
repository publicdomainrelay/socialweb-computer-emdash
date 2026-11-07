import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { declaredScope } from "atproto-oauth-sandbox";
import { ACCOUNT, connect, json, requestJson, SITE_URL, useEncryptionKey } from "atproto-oauth-sandbox/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { integration } from "../src/integration";
import { writableCollections } from "../src/requester";
import qr from "./fixtures/qr.fedfork.com-oauth-client-metadata.json";

const scopes = (scope: string) => scope.split(" ").sort();

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

describe("scope groups", () => {
	it("partition exactly the scopes declared by qr.fedfork.com", () => {
		const all = integration.groups.flatMap((group) => group.scopes);
		expect(new Set(all).size).toBe(all.length);
		expect(scopes(declaredScope(integration.groups))).toEqual(scopes(qr.scope));
	});

	it("derive writable collections from repo scopes", () => {
		expect(writableCollections("atproto repo:a.b.c?action=update repo:a.b.d?action=create&action=update repo:a.b.e")).toEqual([
			"a.b.d",
			"a.b.e",
		]);
	});
});

describe("socialweb.computer requester", () => {
	it("serves a CIMD that declares the qr.fedfork.com scope set", async () => {
		const response = await host.actions.routes.request("oauth/client-metadata", { method: "GET" });
		const metadata = await response.json();
		expect(metadata.client_id).toBe(`${SITE_URL}/_emdash/api/plugins/socialweb-computer-requester/oauth/client-metadata`);
		expect(scopes(metadata.scope)).toEqual(scopes(qr.scope));
	});

	it("starts with association only and upgrades to request compute", async () => {
		const { par } = await connect(host, "/connect", "oauth:connect", { identifier: ACCOUNT.handle, groups: ["associate"] });
		expect(par.get("scope")).toBe("atproto rpc:com.publicdomainrelay.temp.requester.associateConfirm?aud=*");

		const page = JSON.stringify((await host.admin.loadPage("/requester")).blocks);
		expect(page).toContain("requester:associate");
		expect(page).toContain('Needs the \\"Describe compute to request\\" permission.');

		await host.http.respond(
			`${ACCOUNT.pds}/xrpc/com.publicdomainrelay.temp.requester.associateConfirm`,
			json({ ok: true, requesterDid: "did:plc:requester" }),
		);
		const associated = await host.admin.submit("/requester", "requester:associate", { requesterDid: "did:plc:requester" });
		expect(associated.toast).toMatchObject({ type: "success", message: "Associated with did:plc:requester" });
		const proxied = host.http.requests().find((request) => request.url.endsWith("associateConfirm"));
		expect(proxied?.headers["atproto-proxy"]).toBe("did:plc:requester#requester_associate");

		const denied = await host.admin.submit("/requester", "requester:compute", { cpus: 2, mem: "4G", disk: "50G", network: "500G", role: "r" });
		expect(denied.toast).toMatchObject({ type: "error" });

		const { par: upgrade } = await connect(host, "/connect", "oauth:upgrade", { groups: ["compute"] });
		expect(scopes(upgrade.get("scope") ?? "")).toEqual(
			scopes(
				"atproto rpc:com.publicdomainrelay.temp.requester.associateConfirm?aud=* repo:com.publicdomainrelay.temp.compute.vm?action=create repo:com.publicdomainrelay.temp.compute.vm?action=create&action=update repo:com.publicdomainrelay.temp.compute.config.wif.simple?action=create",
			),
		);

		await host.http.respond(
			`${ACCOUNT.pds}/xrpc/com.atproto.repo.createRecord`,
			json({ uri: `at://${ACCOUNT.did}/com.publicdomainrelay.temp.compute.vm/3k`, cid: "bafy" }),
		);
		const created = await host.admin.submit("/requester", "requester:compute", {
			cpus: 2,
			mem: "4G",
			disk: "50G",
			network: "500G",
			role: "compute-runner",
			user_data: "#cloud-config\n",
		});
		expect(created.toast).toMatchObject({ type: "success" });
		expect(requestJson(host, `${ACCOUNT.pds}/xrpc/com.atproto.repo.createRecord`)).toMatchObject({
			collection: "com.publicdomainrelay.temp.compute.vm",
			record: { $type: "com.publicdomainrelay.temp.compute.vm", cpus: 2, mem: "4G", role: "compute-runner" },
		});
		expect(await host.inspect.storage.list("records")).toHaveLength(1);
	});

	it("refuses generic writes outside the granted collections", async () => {
		await connect(host, "/connect", "oauth:connect", { identifier: ACCOUNT.handle, groups: ["tangled"] });
		const refused = await host.admin.submit("/requester", "requester:write", {
			collection: "com.fedproxy.rbac",
			record: "{}",
		});
		expect(refused.toast).toMatchObject({ type: "error", message: "com.fedproxy.rbac is not covered by the granted scopes" });
	});
});
