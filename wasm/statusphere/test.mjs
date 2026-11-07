import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const bytes = await readFile(new URL("./statusphere.wasm", import.meta.url));
const module = new WebAssembly.Module(bytes);
const { exports } = new WebAssembly.Instance(module, {});

function run(entry, input) {
	const data = new TextEncoder().encode(JSON.stringify(input ?? null));
	const ptr = exports.alloc(data.length);
	new Uint8Array(exports.memory.buffer, ptr, data.length).set(data);
	const packed = BigInt.asUintN(64, exports[entry](ptr, data.length));
	const outPtr = Number(packed >> 32n);
	const outLen = Number(packed & 0xffffffffn);
	return JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, outPtr, outLen)));
}

const did = "did:plc:lpfuqerea3deuoyrn7ojser4";

test("module has no imports and exports the ABI", () => {
	assert.equal(WebAssembly.Module.imports(module).length, 0);
	const names = WebAssembly.Module.exports(module).map((e) => e.name);
	for (const name of ["memory", "alloc", "set_status"]) assert.ok(names.includes(name), name);
});

test("set_status returns a createRecord call", () => {
	assert.deepEqual(run("set_status", { status: "🦋", now: "2026-11-06T12:34:56.789Z", did }), {
		calls: [
			{
				nsid: "com.atproto.repo.createRecord",
				input: {
					repo: did,
					collection: "xyz.statusphere.status",
					record: {
						$type: "xyz.statusphere.status",
						status: "🦋",
						createdAt: "2026-11-06T12:34:56.789Z",
					},
				},
			},
		],
	});
});

test("set_status normalizes now to UTC milliseconds", () => {
	const out = run("set_status", { status: "🙂", now: "2026-11-06T04:00:00-08:00", did });
	assert.equal(out.calls[0].input.record.createdAt, "2026-11-06T12:00:00.000Z");
});

test("set_status rejects an empty status", () => {
	const out = run("set_status", { status: "", now: "2026-11-06T12:00:00Z", did });
	assert.equal(typeof out.error, "string");
	assert.equal(out.calls, undefined);
});

test("set_status rejects an invalid now", () => {
	const out = run("set_status", { status: "🦋", now: "yesterday", did });
	assert.match(out.error, /now/);
});

test("set_status rejects null input", () => {
	assert.equal(typeof run("set_status", null).error, "string");
});
