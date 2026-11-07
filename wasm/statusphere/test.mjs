import assert from "node:assert/strict";
import { test } from "node:test";

import { did, load, now } from "../harness.mjs";

const { module, run, drive } = await load(new URL("./statusphere.wasm", import.meta.url));
const ENTRIES = ["set_status", "set_status_write", "set_status_done", "clear_status", "clear_status_delete", "clear_status_done"];

test("module has no imports and exports the ABI", () => {
	assert.equal(WebAssembly.Module.imports(module).length, 0);
	const names = WebAssembly.Module.exports(module).map((e) => e.name);
	for (const name of ["memory", "alloc", ...ENTRIES]) assert.ok(names.includes(name), name);
});

test("set_status reads the latest status, writes, then reports the new uri", () => {
	const ran = drive("set_status", { status: "🦋" }, (call) =>
		call.nsid === "com.atproto.repo.listRecords"
			? { ok: true, output: { records: [{ uri: `at://${did}/xyz.statusphere.status/old`, value: { status: "🙂" } }] } }
			: { ok: true, output: { uri: `at://${did}/xyz.statusphere.status/new`, cid: "bafy" } },
	);
	assert.deepEqual(
		ran.rounds.map((round) => round.calls.map((call) => call.nsid)),
		[["com.atproto.repo.listRecords"], ["com.atproto.repo.createRecord"], []],
	);
	assert.deepEqual(ran.rounds[0].calls[0].params, { repo: did, collection: "xyz.statusphere.status", limit: "1" });
	assert.deepEqual(ran.rounds[1].calls[0].input, {
		repo: did,
		collection: "xyz.statusphere.status",
		record: { $type: "xyz.statusphere.status", status: "🦋", createdAt: now },
	});
	assert.deepEqual(ran.result, { status: "🦋", unchanged: false, uri: `at://${did}/xyz.statusphere.status/new` });
});

test("set_status skips the write when the latest status already matches", () => {
	const uri = `at://${did}/xyz.statusphere.status/same`;
	const ran = drive("set_status", { status: "🦋" }, () => ({ ok: true, output: { records: [{ uri, value: { status: "🦋" } }] } }));
	assert.equal(ran.rounds.length, 2);
	assert.deepEqual(ran.result, { status: "🦋", unchanged: true, uri });
});

test("set_status normalizes now to UTC milliseconds", () => {
	const out = run("set_status_write", {
		did,
		now: "2026-11-06T04:00:00-08:00",
		state: { status: "🙂" },
		results: [{ ok: true, output: { records: [] } }],
	});
	assert.equal(out.calls[0].input.record.createdAt, "2026-11-06T12:00:00.000Z");
});

test("set_status rejects an empty status and an invalid now", () => {
	assert.match(run("set_status", { status: "", now, did }).error, /status/);
	assert.match(run("set_status", { status: "🦋", now: "yesterday", did }).error, /now/);
});

test("a failed call surfaces as the module error", () => {
	const ran = drive("set_status", { status: "🦋" }, () => ({ ok: false, error: "listRecords failed with 500" }));
	assert.equal(ran.error, "listRecords failed with 500");
});

test("clear_status deletes every listed status", () => {
	const records = ["a", "b", "c"].map((rkey) => ({ uri: `at://${did}/xyz.statusphere.status/${rkey}`, value: { status: "🦋" } }));
	const ran = drive("clear_status", {}, (call) =>
		call.nsid === "com.atproto.repo.listRecords" ? { ok: true, output: { records } } : { ok: call.input.rkey !== "c", output: {} },
	);
	assert.deepEqual(
		ran.rounds[1].calls.map((call) => [call.nsid, call.input.rkey]),
		[
			["com.atproto.repo.deleteRecord", "a"],
			["com.atproto.repo.deleteRecord", "b"],
			["com.atproto.repo.deleteRecord", "c"],
		],
	);
	assert.deepEqual(ran.result, { deleted: 2, failed: 1 });
});

test("clear_status with nothing to delete makes no delete calls", () => {
	const ran = drive("clear_status", {}, () => ({ ok: true, output: { records: [] } }));
	assert.deepEqual(ran.rounds.map((round) => round.calls.length), [1, 0]);
	assert.deepEqual(ran.result, { deleted: 0 });
});
