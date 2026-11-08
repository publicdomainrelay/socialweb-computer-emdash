import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { base32nopad } from "@scure/base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTEST_NSID, signInline, verifyInline } from "../src/attest";
import { MODULE_COLLECTION } from "../src/modules";
import { ALICE, call, connect, didDocument, json, OPERATOR, queueIdentity, SITE_URL, useEncryptionKey } from "./network";

// A module whose `echo` export returns its input: the test's `calls` come back as the module's plan.
const ECHO_WASM = Uint8Array.from([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0c, 0x02, 0x60, 0x01, 0x7f, 0x01, 0x7f, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e, 0x03, 0x03, 0x02,
	0x00, 0x01, 0x05, 0x03, 0x01, 0x00, 0x01, 0x06, 0x07, 0x01, 0x7f, 0x01, 0x41, 0x80, 0x08, 0x0b, 0x07, 0x19, 0x03, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72,
	0x79, 0x02, 0x00, 0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00, 0x04, 0x65, 0x63, 0x68, 0x6f, 0x00, 0x01, 0x0a, 0x20, 0x02, 0x11, 0x01, 0x01, 0x7f,
	0x23, 0x00, 0x21, 0x01, 0x23, 0x00, 0x20, 0x00, 0x6a, 0x24, 0x00, 0x20, 0x01, 0x0b, 0x0c, 0x00, 0x20, 0x00, 0xad, 0x42, 0x20, 0x86, 0x20, 0x01, 0xad,
	0x84, 0x0b,
]);
const blobCid = `b${base32nopad.encode(Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...new Uint8Array(await crypto.subtle.digest("SHA-256", ECHO_WASM))])).toLowerCase()}`;
const SUBMIT = "com.publicdomainrelay.temp.market.submitRfp";
const LIST = "com.atproto.repo.listRecords";
const BIDDER = "https://bidder.example";
const echoModule = (calls: string[] | null) => ({
	$type: MODULE_COLLECTION,
	abi: "emdash-wasm-json-v1",
	name: "Echo",
	module: { $type: "blob", ref: { $link: blobCid }, mimeType: "application/wasm", size: ECHO_WASM.length },
	session: { uri: `at://${ALICE.did}/com.fedfork.exec.oauth.clientMetadata/statusphere`, cid: "bafy" },
	actions: [{ entry: "echo", label: "Echo", fields: [] }],
	...(calls && { calls }),
});

// The signed RFP the live bidders accepted (at://did:plc:lpfuqerea3deuoyrn7ojser4/com.publicdomainrelay.temp.market.rfp/3mzof3sr6ez2e).
const RFP_REPO = "did:plc:lpfuqerea3deuoyrn7ojser4";
const RFP = {
	$type: "com.publicdomainrelay.temp.market.rfp",
	domain: "compute",
	payload: {
		cid: "bafyreigh3k4lw4txsk4ojkx3b3x7i32umdi26vmzo2vw3oxyxkfyfckvja",
		uri: "at://did:plc:lpfuqerea3deuoyrn7ojser4/com.publicdomainrelay.temp.compute.vm/3mzof3sah7v2t",
		$type: "com.atproto.repo.strongRef",
	},
	policies: [
		{
			cid: "bafyreigr27gkscq2otmv5xfmyx3t2s32ga63xcwp2amafubjyxfd4oky5y",
			uri: "at://did:plc:lpfuqerea3deuoyrn7ojser4/computer.socialweb.temp.policy.ghalite/3mzof3sjie32i",
			$type: "com.atproto.repo.strongRef",
		},
	],
	createdAt: "2026-11-06T22:02:10.263Z",
	signatures: [
		{
			cid: "bafyreifxbegxhn5nds47mb74segtp75sdtm5iva45l7tphfykkeliax3ca",
			key: "did:key:zQ3shXLEhJWkcH5M1dceCTRkkPajiZ7sAxAbvPMLbtNSLLxaP",
			$type: "network.attested.signature",
			issuer: "did:plc:lpfuqerea3deuoyrn7ojser4",
			signature: { $bytes: "W1NmGCHM1MwpsXEgt2x8N4ZPpwFIunGzzAm5AxaqWoYelO+UH2zp8ZUitHRgv/4itLteOKEePEhvKF4OdLUS6g" },
		},
	],
};

describe("network.attested.signature", () => {
	it("verifies the RFP the bidders accepted", async () => {
		expect(await verifyInline(RFP, RFP.signatures[0], RFP_REPO)).toBe(true);
		expect(await verifyInline({ ...RFP, domain: "other" }, RFP.signatures[0], RFP_REPO)).toBe(false);
		expect(await verifyInline(RFP, RFP.signatures[0], ALICE.did)).toBe(false);
	});

	it("signs what it verifies", async () => {
		const secretKey = crypto.getRandomValues(new Uint8Array(32));
		const { signatures: _, ...unsigned } = RFP;
		const entry = await signInline(secretKey, unsigned, RFP_REPO);
		expect(entry).toMatchObject({ $type: "network.attested.signature", issuer: RFP_REPO, key: expect.stringMatching(/^did:key:zQ3s/) });
		expect(await verifyInline({ ...unsigned, signatures: [entry] }, entry, RFP_REPO)).toBe(true);
	});
});

describe("module call routes", () => {
	let host: PluginRuntimeTestHost;
	let user: Awaited<ReturnType<PluginRuntimeTestHost["fixtures"]["user"]>>;

	beforeEach(async () => {
		useEncryptionKey();
		host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
		user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
	});

	afterEach(() => host.dispose());

	async function run(calls: unknown[], allowed: string[] | null = [LIST, SUBMIT, ATTEST_NSID]) {
		await queueIdentity(host);
		await host.http.respond(
			`${ALICE.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(ALICE.did)}&collection=${MODULE_COLLECTION}&rkey=echo`,
			json({ uri: `at://${ALICE.did}/${MODULE_COLLECTION}/echo`, cid: "bafy", value: echoModule(allowed) }),
		);
		await host.http.respond(
			`${ALICE.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(ALICE.did)}&cid=${blobCid}`,
			new Response(ECHO_WASM, { headers: { "content-type": "application/wasm" } }),
		);
		return call(host, user, "run", { did: ALICE.did, rkey: "echo", entry: "echo", input: { calls } });
	}

	it("proxies a call through the user's PDS with the atproto-proxy header", async () => {
		const params = { repo: "did:plc:bidder", collection: "com.publicdomainrelay.temp.market.bid" };
		await host.http.respond(`${ALICE.pds}/xrpc/${LIST}?${new URLSearchParams(params)}`, json({ records: [] }));
		const ran = await run([{ nsid: LIST, params, proxy: "did:plc:bidder#atproto_pds" }]);
		expect(ran.data.rounds[0].calls).toEqual([{ nsid: LIST, ok: true, output: { records: [] } }]);
		const sent = host.http.requests().find((item) => item.url.includes(LIST));
		expect(sent?.headers["atproto-proxy"]).toBe("did:plc:bidder#atproto_pds");
		expect(sent?.headers.authorization).toBe("DPoP access-token");
	});

	it("calls a service directly with a service-auth token wasm never sees", async () => {
		await host.http.respond(
			`${ALICE.pds}/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: "did:web:bidder.example", lxm: SUBMIT })}`,
			json({ token: "service-token" }),
		);
		await host.http.respond(`${BIDDER}/xrpc/${SUBMIT}`, json({ status: "intent-recorded" }));
		const input = { rfpUri: `at://${ALICE.did}/com.publicdomainrelay.temp.market.rfp/3rfp`, rfpCid: "bafyrfp" };
		const ran = await run([{ nsid: SUBMIT, input, service: BIDDER }]);
		expect(ran.data.rounds[0].calls).toEqual([{ nsid: SUBMIT, ok: true, output: { status: "intent-recorded" } }]);
		const sent = host.http.requests().find((item) => item.url === `${BIDDER}/xrpc/${SUBMIT}`);
		expect(sent?.method).toBe("POST");
		expect(sent?.headers.authorization).toBe("Bearer service-token");
		expect(JSON.parse(new TextDecoder().decode(sent?.body))).toEqual(input);
		expect(JSON.stringify(ran.data)).not.toContain("service-token");
	});

	it("reads from a DID service's own PDS without a token", async () => {
		const params = { repo: OPERATOR.did, collection: "com.publicdomainrelay.temp.market.offering" };
		await queueIdentity(host, didDocument([], OPERATOR), 1, OPERATOR);
		await host.http.respond(`${OPERATOR.pds}/xrpc/${LIST}?${new URLSearchParams(params)}`, json({ records: [] }));
		const ran = await run([{ nsid: LIST, params, service: OPERATOR.did }]);
		expect(ran.data.rounds[0].calls).toEqual([{ nsid: LIST, ok: true, output: { records: [] } }]);
		const sent = host.http.requests().find((item) => item.url.startsWith(`${OPERATOR.pds}/xrpc/${LIST}`));
		expect(sent?.headers.authorization).toBeUndefined();
		expect(host.http.requests().some((item) => item.url.includes("getServiceAuth"))).toBe(false);
	});

	it("signs with one sealed key per user and session DID", async () => {
		const record = { $type: "com.publicdomainrelay.temp.market.rfp", domain: "compute", createdAt: "2026-11-08T00:00:00.000Z" };
		const first = await run([
			{ nsid: ATTEST_NSID, input: { repository: ALICE.did } },
			{ nsid: ATTEST_NSID, input: { repository: ALICE.did, record } },
			{ nsid: ATTEST_NSID, input: { repository: "did:plc:someoneelse", record } },
		]);
		const [bare, signed, foreign] = first.data.rounds[0].calls;
		expect(bare.output.key).toMatch(/^did:key:zQ3s/);
		expect(signed.output.key).toBe(bare.output.key);
		expect(signed.output.record).toEqual({ ...record, signatures: [expect.objectContaining({ key: bare.output.key, issuer: ALICE.did })] });
		expect(await verifyInline(signed.output.record, signed.output.record.signatures[0], ALICE.did)).toBe(true);
		expect(foreign).toEqual({ nsid: ATTEST_NSID, ok: false, error: "attest repository must be the session DID" });
		expect(host.http.requests().some((item) => item.url.includes(ATTEST_NSID))).toBe(false);
		const again = await run([{ nsid: ATTEST_NSID, input: { repository: ALICE.did } }]);
		expect(again.data.rounds[0].calls[0].output.key).toBe(bare.output.key);
	});

	it.each([
		["a proxy that is not did#service", [{ nsid: LIST, proxy: "https://bidder.example" }], "Module call proxy must be did#service"],
		["a service that is not an https origin", [{ nsid: SUBMIT, service: "http://bidder.example" }], "Module call service must be an https origin or a DID"],
		["a service with a path", [{ nsid: SUBMIT, service: `${BIDDER}/xrpc` }], "Module call service must be an https origin or a DID"],
		["a DID service with a fragment", [{ nsid: LIST, service: "did:plc:bidder#atproto_pds" }], "Module call service must be an https origin or a DID"],
		["input to a DID service", [{ nsid: SUBMIT, input: {}, service: "did:plc:bidder" }], "Module call to a DID service is a read: no input"],
		["both proxy and service", [{ nsid: SUBMIT, proxy: "did:plc:bidder#svc", service: BIDDER }], "Module call takes proxy or service, not both"],
	])("refuses %s", async (_name, calls, message) => {
		const ran = await run(calls);
		expect(ran.success).toBe(false);
		expect(ran.error?.message).toContain(message);
	});

	it.each([
		["module records that do not list it", [LIST]],
		["module records without a calls list", null],
	])("refuses attest for %s", async (_name, allowed) => {
		const ran = await run([{ nsid: ATTEST_NSID, input: { repository: ALICE.did } }], allowed);
		expect(ran.success).toBe(false);
		expect(ran.error?.message).toContain(`Module record does not allow ${ATTEST_NSID}`);
	});
});
