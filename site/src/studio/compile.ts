export const ENTRY_FILE = "module.ts";
export const ARTIFACT = "module.wasm";

const FLAGS = ["--runtime", "stub", "--use", "abort=", "--optimizeLevel", "3", "--shrinkLevel", "1", "--noAssert"];

export interface CompileResult {
	binary?: Uint8Array<ArrayBuffer>;
	log: string;
	version: string;
	command: string;
}

export async function compile(files: Record<string, string>): Promise<CompileResult> {
	const asc = await import("assemblyscript/asc");
	let binary: Uint8Array<ArrayBuffer> | undefined;
	let log = "";
	const stream = { write: (chunk: string | Uint8Array) => ((log += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)), true) };
	const { error } = await asc.main([ENTRY_FILE, "--outFile", ARTIFACT, ...FLAGS], {
		stdout: stream,
		stderr: stream,
		readFile: (name: string) => files[name.replace(/^\.\//, "")] ?? null,
		writeFile: (name: string, contents: Uint8Array | string) => {
			if (name.endsWith(ARTIFACT) && typeof contents !== "string") binary = new Uint8Array(contents);
		},
		listFiles: () => [],
	});
	if (error) log += `${error.message}\n`;
	return {
		binary: error ? undefined : binary,
		log,
		version: `assemblyscript ${asc.version}`,
		command: `npx --yes --package=assemblyscript@${asc.version} asc ${ENTRY_FILE} --outFile ${ARTIFACT} ${FLAGS.join(" ")}`,
	};
}
