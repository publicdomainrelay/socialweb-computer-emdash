import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientMetadata, parseRecord } from "../src/record";
import { ALICE, call, connect, ISSUER, json, queueListing, RECORDS, SITE_URL, useEncryptionKey } from "./network";

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

const subscriber = (email: string) => host.fixtures.user({ email, role: "subscriber" });

describe("client metadata templating", () => {
	it("rebases the record onto the site origin", () => {
		const ref = { did: ALICE.did, rkey: "socialweb-computer" };
		const metadata = clientMetadata(SITE_URL, ref, parseRecord(RECORDS["socialweb-computer"]));
		expect(metadata).toMatchObject({
			client_id: `${SITE_URL}/integrations/${ALICE.did}/socialweb-computer/oauth-client-metadata.json`,
			client_uri: SITE_URL,
			redirect_uris: [`${SITE_URL}/_emdash/api/plugins/atproto-integrations/oauth/callback`],
			client_name: "DID Key Associator",
			scope: RECORDS["socialweb-computer"].clientMetadata.scope,
			token_endpoint_auth_method: "none",
		});
	});

	it("uses a loopback client on localhost", () => {
		const metadata = clientMetadata("http://localhost:4321", { did: ALICE.did, rkey: "statusphere" }, parseRecord(RECORDS.statusphere));
		const url = new URL(metadata.client_id);
		expect(url.origin).toBe("http://localhost");
		expect(url.searchParams.get("scope")).toBe("atproto repo:xyz.statusphere.status");
		expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4321/_emdash/api/plugins/atproto-integrations/oauth/callback");
	});
});

describe("atproto integrations", () => {
	it("serves client metadata only for integrations a user started", async () => {
		const query = (rkey: string) => `${SITE_URL}/_emdash/api/plugins/atproto-integrations/client-metadata?did=${ALICE.did}&rkey=${rkey}`;
		const before = await host.actions.routes.request("client-metadata", { method: "GET", url: query("statusphere") });
		expect((await before.json()).data).toEqual({ error: "NOT_FOUND" });
		await connect(host, await subscriber("a@example.com"), "statusphere", []);
		const after = await host.actions.routes.request("client-metadata", { method: "GET", url: query("statusphere") });
		expect((await after.json()).data.client_id).toBe(`${SITE_URL}/integrations/${ALICE.did}/statusphere/oauth-client-metadata.json`);
	});

	it("keeps one encrypted session per user per integration", async () => {
		const a = await subscriber("a@example.com");
		const b = await subscriber("b@example.com");
		const { started, par, callback } = await connect(host, a, "statusphere", []);
		expect(started.data.url).toContain(`${ISSUER}/oauth/authorize?`);
		expect(par.get("scope")).toBe("atproto repo:xyz.statusphere.status");
		expect(par.get("login_hint")).toBe(ALICE.handle);
		expect(callback.headers.get("location")).toBe("/integrations?connected=statusphere");

		await queueListing(host);
		const listedA = await call(host, a, "integrations", { did: ALICE.did });
		const status = listedA.data.integrations.find((item: { rkey: string }) => item.rkey === "statusphere");
		expect(status.session).toMatchObject({ handle: ALICE.handle, scope: "atproto repo:xyz.statusphere.status" });

		await queueListing(host);
		const listedB = await call(host, b, "integrations", { did: ALICE.did });
		expect(listedB.data.integrations.every((item: { session: unknown }) => item.session === null)).toBe(true);

		const stored = await host.inspect.storage.list("sessions");
		expect(stored).toHaveLength(1);
		expect(JSON.stringify(stored)).not.toContain("access-token");

		await host.http.respond(`${ALICE.pds}/xrpc/com.atproto.server.getSession`, json({ did: ALICE.did, handle: ALICE.handle }));
		const verified = await call(host, a, "verify", { did: ALICE.did, rkey: "statusphere" });
		expect(verified.data).toMatchObject({ did: ALICE.did, handle: ALICE.handle });
		const denied = await call(host, b, "verify", { did: ALICE.did, rkey: "statusphere" });
		expect(denied.success).toBe(false);

		await host.http.respond(`${ISSUER}/oauth/revoke`, new Response(null, { status: 200 }));
		await call(host, a, "disconnect", { did: ALICE.did, rkey: "statusphere" });
		expect(await host.inspect.storage.list("sessions")).toHaveLength(0);
	});

	it("requests scope groups progressively", async () => {
		const a = await subscriber("a@example.com");
		const first = await connect(host, a, "socialweb-computer", ["associate"]);
		expect(first.par.get("scope")).toBe("atproto rpc:com.publicdomainrelay.temp.requester.associateConfirm?aud=*");
		const upgrade = await connect(host, a, "socialweb-computer", ["associate", "tangled"]);
		expect(upgrade.par.get("scope")).toBe(
			"atproto rpc:com.publicdomainrelay.temp.requester.associateConfirm?aud=* repo:sh.tangled.graph.vouch?action=create&action=update",
		);
		await queueListing(host);
		const listed = await call(host, a, "integrations", { did: ALICE.did });
		const groups = listed.data.integrations.find((item: { rkey: string }) => item.rkey === "socialweb-computer").groups;
		expect(groups.filter((group: { granted: boolean }) => group.granted).map((group: { key: string }) => group.key)).toEqual([
			"associate",
			"tangled",
		]);
	});

	it("only lets a record authorize the account that published it", async () => {
		const { callback } = await connect(host, await subscriber("a@example.com"), "statusphere", [], "did:plc:mallory");
		const location = new URL(callback.headers.get("location") ?? "", SITE_URL);
		expect(location.searchParams.get("error")).toBe("An integration record can only authorize the account that published it");
		expect(await host.inspect.storage.list("sessions")).toHaveLength(0);
	});
});
