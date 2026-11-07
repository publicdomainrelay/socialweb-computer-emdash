import cargoConfig from "../../../wasm/.cargo/config.toml?raw";
import { sha256Hex } from "./hash";

export const EXAMPLES = ["statusphere", "vibescrobble"] as const;

interface ModuleSpec {
	name: string;
	description?: string;
	session: string;
	actions: unknown[];
	calls?: string[];
}

interface Manifest {
	files: Array<{ path: string; file: { uri: string } }>;
	build: { tool: string; version: string; command: string; artifact?: string };
	output: { sha256: string; size: number };
	origin?: { repository: string; commit?: string };
}

const records = import.meta.glob<Record<string, unknown>>("../../../records/*.json", { eager: true, import: "default" });
const manifests = import.meta.glob<Manifest>("../../../records/wasm/*.manifest.json", { eager: true, import: "default" });
const specs = import.meta.glob<ModuleSpec>("../../../wasm/*/module.json", { eager: true, import: "default" });
const binaries = import.meta.glob<string>("../../../wasm/*/*.wasm", { eager: true, query: "?base64", import: "default" });
const sources: Record<string, string> = {
	"../../../wasm/.cargo/config.toml": cargoConfig,
	...import.meta.glob<string>(
		[
			"../../../wasm/{Cargo.toml,Cargo.lock,build.sh}",
			"../../../wasm/abi/Cargo.toml",
			"../../../wasm/abi/src/**/*.rs",
			"../../../wasm/*/Cargo.toml",
			"../../../wasm/*/src/**/*.rs",
		],
		{ eager: true, query: "?raw", import: "default" },
	),
};

const one = <T>(map: Record<string, T>, path: string) => {
	const value = map[path];
	if (value === undefined) throw new Error(`Missing ${path} in the examples bundle`);
	return value;
};

async function moduleBundle(rkey: string) {
	const spec = one(specs, `../../../wasm/${rkey}/module.json`);
	const manifest = one(manifests, `../../../records/wasm/${rkey}.manifest.json`);
	const wasm = one(binaries, `../../../wasm/${rkey}/${rkey}.wasm`);
	const bytes = Uint8Array.from(atob(wasm), (char) => char.charCodeAt(0));
	if ((await sha256Hex(bytes)) !== manifest.output.sha256) throw new Error(`${rkey}.wasm does not match its manifest`);
	const files = await Promise.all(
		manifest.files.map(async ({ path, file }) => {
			const text = one(sources, `../../../wasm/${path}`);
			if ((await sha256Hex(new TextEncoder().encode(text))) !== file.uri.split("/").pop()) throw new Error(`wasm/${path} does not match the ${rkey} manifest`);
			return { path, text };
		}),
	);
	return {
		rkey,
		name: spec.name,
		description: spec.description,
		session: spec.session,
		actions: spec.actions,
		calls: spec.calls,
		wasm,
		source: { language: "rust", files, build: manifest.build, origin: manifest.origin },
	};
}

export async function examplesBundle() {
	return {
		integrations: EXAMPLES.map((rkey) => ({ rkey, record: one(records, `../../../records/${rkey}.json`) })),
		modules: await Promise.all(EXAMPLES.map(moduleBundle)),
	};
}

export type ExamplesBundle = Awaited<ReturnType<typeof examplesBundle>>;
