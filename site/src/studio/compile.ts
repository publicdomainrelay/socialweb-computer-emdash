export interface CompileResult {
	binary?: Uint8Array;
	log: string;
}

const FLAGS = ["--runtime", "stub", "--use", "abort=", "--optimizeLevel", "3", "--shrinkLevel", "1", "--noAssert"];

export async function compile(files: Record<string, string>, entry: string): Promise<CompileResult> {
	const { default: asc } = await import("assemblyscript/asc");
	let binary: Uint8Array | undefined;
	let log = "";
	const stream = { write: (text: string | Uint8Array) => ((log += typeof text === "string" ? text : new TextDecoder().decode(text)), true) };
	const { error } = await asc.main([entry, "--outFile", "module.wasm", ...FLAGS], {
		stdout: stream,
		stderr: stream,
		readFile: (name: string) => files[name.replace(/^\.\//, "")] ?? null,
		writeFile: (name: string, contents: Uint8Array | string) => {
			if (name.endsWith("module.wasm") && typeof contents !== "string") binary = contents;
		},
		listFiles: () => [],
	});
	if (error) log += `${error.message}\n`;
	return { binary: error ? undefined : binary, log };
}
