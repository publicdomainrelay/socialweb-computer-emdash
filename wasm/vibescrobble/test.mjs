import assert from "node:assert/strict";
import { test } from "node:test";

import { did, load, now } from "../harness.mjs";

const { module, run, drive } = await load(new URL("./vibescrobble.wasm", import.meta.url));
const created = { ok: true, output: { uri: `at://${did}/com.vibescrobble.scrobble/new`, cid: "bafy" } };

test("module has no imports and exports the ABI", () => {
	assert.equal(WebAssembly.Module.imports(module).length, 0);
	const names = WebAssembly.Module.exports(module).map((e) => e.name);
	for (const name of ["memory", "alloc", "scrobble", "scrobble_done"]) assert.ok(names.includes(name), name);
});

test("scrobble creates one record and reports its uri", () => {
	const ran = drive("scrobble", { text: "🚀 shipped exec.fedfork.com", task: "#socialweb" }, () => created);
	assert.deepEqual(ran.rounds[0].calls, [
		{
			nsid: "com.atproto.repo.createRecord",
			input: {
				repo: did,
				collection: "com.vibescrobble.scrobble",
				validate: false,
				record: {
					$type: "com.vibescrobble.scrobble",
					text: "🚀 shipped exec.fedfork.com",
					emoji: "🚀",
					createdAt: now,
					task: "#socialweb",
				},
			},
		},
	]);
	assert.deepEqual(ran.result, created.output);
});

test("scrobble keeps whole emoji sequences and omits an empty task", () => {
	for (const emoji of ["👩‍💻", "👍🏽", "🇺🇸", "❤️", "1️⃣", "✅", "⭐"]) {
		const record = run("scrobble", { did, now, text: `${emoji} x`, task: "" }).calls[0].input.record;
		assert.equal(record.emoji, emoji);
		assert.equal("task" in record, false);
	}
});

test("scrobble rejects text that does not start with an emoji", () => {
	for (const text of ["hello", "1 thing", "# heading", "", " 🚀 leading space", "→ arrow", "© 2026"]) {
		assert.match(run("scrobble", { did, now, text }).error, /emoji/, text);
	}
});

test("scrobble truncates long text to 256 graphemes", () => {
	const record = run("scrobble", { did, now, text: `🚀${"a".repeat(400)}` }).calls[0].input.record;
	assert.equal([...new Intl.Segmenter().segment(record.text)].length, 256);
});

test("scrobble rejects a bad did, now or task", () => {
	assert.match(run("scrobble", { did: "alice", now, text: "🚀" }).error, /did/);
	assert.match(run("scrobble", { did, now: "yesterday", text: "🚀" }).error, /now/);
	assert.match(run("scrobble", { did, now, text: "🚀", task: "x".repeat(300) }).error, /task/);
});

test("a failed create surfaces as the module error", () => {
	const ran = drive("scrobble", { text: "🚀" }, () => ({ ok: false, error: "createRecord failed with 400" }));
	assert.equal(ran.error, "createRecord failed with 400");
});
