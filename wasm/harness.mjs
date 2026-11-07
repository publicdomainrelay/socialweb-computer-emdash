import { readFile } from "node:fs/promises";

export const did = "did:plc:lpfuqerea3deuoyrn7ojser4";
export const now = "2026-11-06T12:34:56.789Z";

export async function load(url) {
	const module = new WebAssembly.Module(await readFile(url));
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

	function drive(entry, input, respond) {
		const rounds = [];
		let output = run(entry, { ...input, did, now });
		for (;;) {
			if (output.error) return { error: output.error, rounds };
			rounds.push({ entry, calls: output.calls });
			const results = output.calls.map(respond);
			if (!output.next) return { result: output.result, rounds };
			entry = output.next;
			output = run(entry, { ...input, did, now, state: output.state, results });
		}
	}

	return { module, run, drive };
}
