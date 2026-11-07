import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { plugin, studioDid } from "./api";
import abiSource from "./assemblyscript/abi.as?raw";
import echoSource from "./assemblyscript/echo.as?raw";
import noteSource from "./assemblyscript/note.as?raw";
import { ARTIFACT, type CompileResult, compile, ENTRY_FILE } from "./compile";
import { sha256Hex } from "./hash";

interface Template {
	label: string;
	source: string;
	input: Record<string, unknown>;
	rkey: string;
	name: string;
	description: string;
	actions: Array<{ entry: string; label: string; description?: string; fields: string }>;
}

const TEMPLATES: Record<string, Template> = {
	note: {
		label: "Write a note",
		source: noteSource,
		input: { text: "hello" },
		rkey: "note",
		name: "Note",
		description: "Write a com.example.note record.",
		actions: [{ entry: "note", label: "Write note", fields: "text:Text" }],
	},
	echo: {
		label: "Echo",
		source: echoSource,
		input: { text: "hello" },
		rkey: "echo",
		name: "Echo",
		description: "Return the input it was given, without calling anything.",
		actions: [{ entry: "echo", label: "Echo", fields: "text:Text" }],
	},
};

const DRAFT_KEY = "studio.module.draft";
const MAX_ROUNDS = 8;
const MOCK_RESULT = { ok: true, output: { uri: "at://did:plc:example/mock/1", cid: "bafymock" } };
const HIDDEN_EXPORTS = new Set(["alloc", "memory"]);

const root = document.querySelector<HTMLElement>("[data-module-editor]");
const $ = <T extends HTMLElement>(selector: string) => root?.querySelector<T>(selector) ?? null;

interface Compiled {
	result: CompileResult;
	binary: Uint8Array<ArrayBuffer>;
	module: WebAssembly.Module;
	entries: string[];
	code: string;
}

let compiled: Compiled | undefined;

function readDraft(): { template: string; code: string } | undefined {
	try {
		const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
		return draft && typeof draft.code === "string" && typeof draft.template === "string" ? draft : undefined;
	} catch {
		return undefined;
	}
}

function saveDraft(template: string, code: string) {
	try {
		localStorage.setItem(DRAFT_KEY, JSON.stringify({ template, code }));
	} catch {}
}

const theme = EditorView.theme({
	"&": {
		height: "28rem",
		backgroundColor: "var(--color-surface)",
		color: "var(--color-text)",
		fontSize: "0.875rem",
	},
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55", overflow: "auto" },
	".cm-content": { caretColor: "var(--color-text)" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-text)" },
	".cm-gutters": {
		backgroundColor: "var(--color-fill)",
		color: "var(--color-muted)",
		border: "none",
		borderRight: "1px solid var(--color-border)",
	},
	".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-brand) 7%, transparent)" },
	".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--color-brand) 12%, transparent)", color: "var(--color-text)" },
	"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
		backgroundColor: "color-mix(in srgb, var(--color-brand) 30%, transparent)",
	},
	".cm-tooltip": { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)" },
	".cm-panels": { backgroundColor: "var(--color-fill)", color: "var(--color-text)" },
});

const highlight = HighlightStyle.define([
	{ tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: "var(--syntax-keyword)" },
	{ tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syntax-string)" },
	{ tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syntax-number)" },
	{ tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
	{ tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
	{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))], color: "var(--syntax-function)" },
	{ tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--syntax-property)" },
	{ tag: [tags.variableName, tags.definition(tags.variableName)], color: "var(--color-text)" },
	{ tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--syntax-punctuation)" },
]);

function createView(parent: HTMLElement, doc: string, readOnly: boolean, onChange?: (code: string) => void) {
	return new EditorView({
		parent,
		state: EditorState.create({
			doc,
			extensions: [
				basicSetup,
				javascript({ typescript: true }),
				syntaxHighlighting(highlight),
				theme,
				EditorState.tabSize.of(2),
				EditorState.readOnly.of(readOnly),
				EditorView.editable.of(!readOnly),
				EditorView.contentAttributes.of({ "aria-label": readOnly ? "abi.ts, read only" : "module.ts" }),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && onChange) onChange(update.state.doc.toString());
				}),
			],
		}),
	});
}

const templateSelect = $<HTMLSelectElement>("[data-template]");
const moduleHost = $<HTMLElement>("[data-editor='module']");
const abiHost = $<HTMLElement>("[data-editor='abi']");
const compileButton = $<HTMLButtonElement>("[data-compile]");
const compileStatus = $<HTMLElement>("[data-compile-status]");
const compileOutput = $<HTMLElement>("[data-compile-output]");
const entrySelect = $<HTMLSelectElement>("[data-entry]");
const inputField = $<HTMLTextAreaElement>("[data-input]");
const runButton = $<HTMLButtonElement>("[data-run]");
const runOutput = $<HTMLElement>("[data-run-output]");
const publishForm = $<HTMLFormElement>("[data-publish]");
const publishButton = $<HTMLButtonElement>("[data-publish-submit]");
const publishHint = $<HTMLElement>("[data-publish-hint]");
const publishResult = $<HTMLElement>("[data-publish-result]");
const actionsList = $<HTMLElement>("[data-actions]");
const callsField = $<HTMLTextAreaElement>("[data-calls]");
const studioReady = root?.dataset.ready === "true";
const signedInDid = root?.dataset.did || "did:plc:example";

const draft = readDraft();
let templateKey = draft && TEMPLATES[draft.template] ? draft.template : "note";
if (templateSelect) templateSelect.value = templateKey;

const moduleView = moduleHost
	? createView(moduleHost, draft?.code ?? TEMPLATES[templateKey].source, false, (code) => {
			saveDraft(templateKey, code);
			if (compiled && compiled.code !== code) setCompileState("Edited since the last compile.");
			updatePublishState();
		})
	: undefined;
const abiView = abiHost ? createView(abiHost, abiSource, true) : undefined;
const remeasure = () => {
	moduleView?.requestMeasure();
	abiView?.requestMeasure();
};
document.fonts?.ready.then(remeasure);
window.addEventListener("load", remeasure);

const currentCode = () => moduleView?.state.doc.toString() ?? "";

function setCompileState(text: string) {
	if (compileStatus) compileStatus.textContent = text;
}

for (const tab of root?.querySelectorAll<HTMLButtonElement>("[data-tab]") ?? []) {
	tab.addEventListener("click", () => {
		for (const other of root?.querySelectorAll<HTMLButtonElement>("[data-tab]") ?? []) {
			const selected = other === tab;
			other.setAttribute("aria-selected", String(selected));
			const panel = root?.querySelector<HTMLElement>(`[data-editor='${other.dataset.tab}']`);
			if (panel) panel.hidden = !selected;
		}
		remeasure();
	});
}

function fillPublishDefaults(template: Template) {
	const set = (name: string, value: string) => {
		const field = publishForm?.elements.namedItem(name);
		if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
	};
	set("rkey", template.rkey);
	set("name", template.name);
	set("description", template.description);
	if (inputField) inputField.value = JSON.stringify(template.input, null, 2);
	if (actionsList) actionsList.replaceChildren();
	for (const action of template.actions) addAction(action);
	prefillCalls();
}

templateSelect?.addEventListener("change", () => {
	const next = templateSelect.value;
	const template = TEMPLATES[next];
	if (!template) return;
	const edited = !Object.values(TEMPLATES).some((item) => item.source === currentCode());
	if (edited && !window.confirm("Replace your edits with this template?")) {
		templateSelect.value = templateKey;
		return;
	}
	templateKey = next;
	moduleView?.dispatch({ changes: { from: 0, to: moduleView.state.doc.length, insert: template.source } });
	saveDraft(templateKey, template.source);
	fillPublishDefaults(template);
	compiled = undefined;
	setCompileState("Not compiled yet.");
	if (compileOutput) compileOutput.hidden = true;
	refreshEntries();
	updatePublishState();
});

function refreshEntries() {
	const entries = compiled?.entries ?? [];
	if (entrySelect) {
		entrySelect.replaceChildren(...entries.map((entry) => new Option(entry, entry)));
		entrySelect.disabled = entries.length === 0;
	}
	if (runButton) runButton.disabled = entries.length === 0;
	for (const select of actionsList?.querySelectorAll<HTMLSelectElement>("[data-action-entry]") ?? []) fillEntryOptions(select, select.value);
}

function fillEntryOptions(select: HTMLSelectElement, selected: string) {
	const entries = compiled?.entries.length ? compiled.entries : [selected].filter(Boolean);
	select.replaceChildren(...entries.map((entry) => new Option(entry, entry, false, entry === selected)));
}

compileButton?.addEventListener("click", async () => {
	if (!compileButton || !compileOutput) return;
	compileButton.disabled = true;
	setCompileState("Loading the compiler… the first time downloads about 4 MB.");
	const code = currentCode();
	try {
		const result = await compile({ "abi.ts": abiSource, [ENTRY_FILE]: code });
		compileOutput.hidden = false;
		if (!result.binary) {
			compiled = undefined;
			setCompileState("Compile failed.");
			compileOutput.textContent = result.log || "The compiler produced no module.";
			compileOutput.dataset.state = "error";
		} else {
			const module = new WebAssembly.Module(result.binary);
			const imports = WebAssembly.Module.imports(module);
			const exports = WebAssembly.Module.exports(module).map((item) => item.name);
			const entries = exports.filter((name) => !HIDDEN_EXPORTS.has(name));
			compiled = { result, binary: result.binary, module, entries, code };
			setCompileState(`Compiled with ${result.version}.`);
			compileOutput.dataset.state = imports.length ? "error" : "ok";
			compileOutput.textContent = [
				`${ARTIFACT}  ${result.binary.length} bytes`,
				`sha256     ${await sha256Hex(result.binary)}`,
				`exports    ${exports.join(", ")}`,
				`imports    ${imports.length}${imports.length ? `  (${imports.map((item) => `${item.module}.${item.name}`).join(", ")}): the host gives modules no imports, so this one cannot run` : ""}`,
				result.log.trim() ? `\n${result.log.trim()}` : "",
			]
				.filter(Boolean)
				.join("\n");
		}
	} catch (cause) {
		compiled = undefined;
		compileOutput.hidden = false;
		compileOutput.dataset.state = "error";
		compileOutput.textContent = cause instanceof Error ? cause.message : String(cause);
		setCompileState("Compile failed.");
	}
	compileButton.disabled = false;
	refreshEntries();
	updatePublishState();
});

function step(module: WebAssembly.Module, entry: string, input: unknown) {
	const { exports } = new WebAssembly.Instance(module, {});
	const memory = exports.memory as WebAssembly.Memory;
	const alloc = exports.alloc as (length: number) => number;
	const run = exports[entry] as (pointer: number, length: number) => bigint;
	const data = new TextEncoder().encode(JSON.stringify(input));
	const pointer = alloc(data.length);
	new Uint8Array(memory.buffer, pointer, data.length).set(data);
	const packed = BigInt.asUintN(64, BigInt(run(pointer, data.length)));
	const out = Number(packed >> 32n);
	const length = Number(packed & 0xffffffffn);
	return JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, out, length))) as {
		calls?: Array<{ nsid: string }>;
		next?: string;
		state?: unknown;
		result?: unknown;
		error?: string;
	};
}

runButton?.addEventListener("click", () => {
	if (!compiled || !entrySelect || !runOutput) return;
	runOutput.hidden = false;
	let values: Record<string, unknown>;
	try {
		const parsed = JSON.parse(inputField?.value || "{}");
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Input must be a JSON object");
		values = parsed;
	} catch (cause) {
		runOutput.dataset.state = "error";
		runOutput.textContent = cause instanceof Error ? cause.message : String(cause);
		return;
	}
	const lines: string[] = [];
	let entry = entrySelect.value;
	let carried: Record<string, unknown> = {};
	let state = "error";
	try {
		for (let round = 1; ; round++) {
			if (round > MAX_ROUNDS) {
				lines.push(`Stopped: the host allows ${MAX_ROUNDS} rounds.`);
				break;
			}
			const output = step(compiled.module, entry, { ...values, did: signedInDid, now: new Date().toISOString(), ...carried });
			const calls = output.calls ?? [];
			lines.push(`Round ${round}: ${entry}`);
			lines.push(JSON.stringify(output, null, 2));
			if (output.error) {
				lines.push(`Error: ${output.error}`);
				break;
			}
			if (!output.next) {
				lines.push(`Result: ${JSON.stringify(output.result ?? null)}`);
				state = "ok";
				break;
			}
			if (calls.length) lines.push(`Planned calls, answered here with a mock result: ${calls.map((call) => call.nsid).join(", ")}`);
			carried = { state: output.state, results: calls.map(() => MOCK_RESULT) };
			entry = output.next;
			lines.push("");
		}
	} catch (cause) {
		lines.push(`Trap: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	runOutput.dataset.state = state;
	runOutput.textContent = lines.join("\n");
});

function addAction(action: { entry: string; label: string; description?: string; fields: string } = { entry: compiled?.entries[0] ?? "", label: "", fields: "" }) {
	if (!actionsList) return;
	const row = document.createElement("fieldset");
	row.className = "action-row";
	row.innerHTML = `
		<legend class="form-label">Action</legend>
		<div class="form-grid">
			<div class="form-row"><label>Entry</label><select class="field" data-action-entry></select></div>
			<div class="form-row"><label>Button label</label><input class="field" data-action-label required maxlength="640" /></div>
		</div>
		<div class="form-row"><label>Description</label><input class="field" data-action-description maxlength="3000" /></div>
		<div class="form-row"><label>Fields</label><input class="field" data-action-fields placeholder="text:Text, task:Task" /><span class="form-hint">Comma separated, as key:Label. Each becomes an input on /integrations.</span></div>
		<button class="btn btn--ghost btn--small" type="button" data-action-remove>Remove action</button>`;
	const select = row.querySelector<HTMLSelectElement>("[data-action-entry]");
	if (select) fillEntryOptions(select, action.entry);
	const label = row.querySelector<HTMLInputElement>("[data-action-label]");
	if (label) label.value = action.label;
	const description = row.querySelector<HTMLInputElement>("[data-action-description]");
	if (description) description.value = action.description ?? "";
	const fields = row.querySelector<HTMLInputElement>("[data-action-fields]");
	if (fields) fields.value = action.fields;
	row.querySelector("[data-action-remove]")?.addEventListener("click", () => row.remove());
	actionsList.append(row);
}

$<HTMLButtonElement>("[data-add-action]")?.addEventListener("click", () => addAction());

function prefillCalls() {
	if (!callsField) return;
	const found = new Set([...currentCode().matchAll(/\b(?:call|query)\(\s*["']([A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+){2,})["']/g)].map((match) => match[1]));
	callsField.value = [...found].join("\n");
}

$<HTMLButtonElement>("[data-scan-calls]")?.addEventListener("click", prefillCalls);

function readActions() {
	return [...(actionsList?.querySelectorAll<HTMLElement>(".action-row") ?? [])].map((row) => {
		const value = (selector: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value.trim() ?? "";
		const fields = value("[data-action-fields]")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean)
			.map((item) => {
				const [key, ...label] = item.split(":");
				return { key: key.trim(), label: label.join(":").trim() || key.trim() };
			});
		const description = value("[data-action-description]");
		return { entry: value("[data-action-entry]"), label: value("[data-action-label]"), ...(description ? { description } : {}), fields };
	});
}

function base64(bytes: Uint8Array) {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return btoa(binary);
}

function updatePublishState() {
	const fresh = compiled && compiled.code === currentCode();
	if (publishButton) publishButton.disabled = !studioReady || !fresh;
	if (publishHint) {
		publishHint.textContent = !studioReady
			? "Connect the studio above to publish."
			: !fresh
				? "Compile the current code to publish it."
				: "Publishes the source files, a manifest, the blob and the module record to your PDS.";
	}
}

publishForm?.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (!compiled || !publishButton || !publishResult) return;
	const form = new FormData(publishForm);
	const text = (name: string) => String(form.get(name) ?? "").trim();
	const calls = (callsField?.value ?? "")
		.split(/\s+/)
		.map((item) => item.trim())
		.filter(Boolean);
	publishButton.disabled = true;
	publishResult.hidden = false;
	publishResult.dataset.state = "";
	publishResult.textContent = "Publishing…";
	try {
		const published = await plugin<{ module: { uri: string; cid: string }; source: { uri: string }; files: number }>("studio/publish-module", {
			did: studioDid(),
			rkey: text("rkey"),
			name: text("name"),
			description: text("description") || undefined,
			session: text("session"),
			actions: readActions(),
			calls,
			wasm: base64(compiled.binary),
			source: {
				language: "assemblyscript",
				files: [
					{ path: ENTRY_FILE, text: compiled.code },
					{ path: "abi.ts", text: abiSource },
				],
				build: { tool: "asc", version: compiled.result.version, command: compiled.result.command, artifact: ARTIFACT },
			},
		});
		publishResult.dataset.state = "ok";
		publishResult.replaceChildren(
			Object.assign(document.createElement("p"), { textContent: `Published ${published.module.uri} with ${published.files} source files.` }),
			Object.assign(document.createElement("p"), {
				innerHTML: `<a href="/source?uri=${encodeURIComponent(published.module.uri)}">View its source</a> · <a href="/integrations">Run it on /integrations</a>`,
			}),
		);
	} catch (cause) {
		publishResult.dataset.state = "error";
		publishResult.textContent = cause instanceof Error ? cause.message : String(cause);
	}
	updatePublishState();
});

fillPublishDefaults(TEMPLATES[templateKey]);
setCompileState("Not compiled yet.");
updatePublishState();
