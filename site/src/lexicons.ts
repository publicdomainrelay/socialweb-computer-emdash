import statusphereIntegration from "../../records/statusphere.json";
import statusphereModule from "../../records/wasm/statusphere.json";
import statusphereManifest from "../../records/wasm/statusphere.manifest.json";

interface Property {
	type?: string;
	format?: string;
	ref?: string;
	refs?: string[];
	items?: Property;
	knownValues?: string[];
	minLength?: number;
	maxLength?: number;
	maxGraphemes?: number;
	minimum?: number;
	maximum?: number;
	maxSize?: number;
	accept?: string[];
	description?: string;
}

interface ObjectSchema {
	type?: string;
	required?: string[];
	properties?: Record<string, Property>;
	description?: string;
}

interface Def extends ObjectSchema {
	key?: string;
	record?: ObjectSchema;
	input?: { encoding: string; schema?: ObjectSchema };
	output?: { encoding: string; schema?: ObjectSchema };
	errors?: Array<{ name: string; description?: string }>;
}

interface LexiconDocument {
	id: string;
	defs: Record<string, Def>;
}

export interface Row {
	name: string;
	type: string;
	link?: string;
	required: boolean;
	constraints: string[];
	description?: string;
}

export interface Table {
	id: string;
	title: string;
	description?: string;
	rows: Row[];
}

const REPOSITORY = "https://github.com/publicdomainrelay/socialweb-computer-emdash/blob/main";

const files = import.meta.glob<LexiconDocument>("../../lexicons/**/*.json", { eager: true, import: "default" });

export const anchorOf = (nsid: string) => nsid.replaceAll(".", "-").toLowerCase();

function typeOf(property: Property): string {
	if (property.type === "array") return `array of ${property.items ? typeOf(property.items) : "unknown"}`;
	if (property.type === "ref") return property.ref ?? "ref";
	if (property.type === "union") return `union of ${(property.refs ?? []).join(", ")}`;
	if (property.format) return `${property.type} (${property.format})`;
	return property.type ?? "unknown";
}

function linkOf(nsid: string, property: Property): string | undefined {
	const ref = property.type === "array" ? property.items?.ref : property.ref;
	if (!ref) return undefined;
	if (ref.startsWith("#")) return `#${anchorOf(nsid)}-${ref.slice(1).toLowerCase()}`;
	const [target, def] = ref.split("#");
	return files[`../../lexicons/${target.replaceAll(".", "/")}.json`] ? `#${anchorOf(target)}${def ? `-${def.toLowerCase()}` : ""}` : undefined;
}

const bytes = (size: number) => (size >= 1024 * 1024 ? `${Math.round(size / 1024 / 102.4) / 10} MB` : `${Math.round(size / 102.4) / 10} KB`);

function constraintsOf(property: Property): string[] {
	const out: string[] = [];
	const array = property.type === "array";
	if (property.knownValues?.length) out.push(`known values: ${property.knownValues.join(", ")}`);
	if (property.minLength !== undefined) out.push(array ? `at least ${property.minLength} items` : `min length ${property.minLength}`);
	if (property.maxLength !== undefined) out.push(array ? `at most ${property.maxLength} items` : `max length ${property.maxLength}`);
	if (property.maxGraphemes !== undefined) out.push(`max ${property.maxGraphemes} graphemes`);
	if (property.minimum !== undefined) out.push(`minimum ${property.minimum}`);
	if (property.maximum !== undefined) out.push(`maximum ${property.maximum}`);
	if (property.maxSize !== undefined) out.push(`max size ${bytes(property.maxSize)}`);
	if (property.accept?.length) out.push(`accepts ${property.accept.join(", ")}`);
	if (property.type === "array" && property.items) out.push(...constraintsOf(property.items).map((item) => `each item: ${item}`));
	return out;
}

function rowsOf(nsid: string, schema: ObjectSchema | undefined): Row[] {
	const required = new Set(schema?.required ?? []);
	return Object.entries(schema?.properties ?? {}).map(([name, property]) => ({
		name,
		type: typeOf(property),
		link: linkOf(nsid, property),
		required: required.has(name),
		constraints: constraintsOf(property),
		description: property.description,
	}));
}

function tablesOf(document: LexiconDocument): Table[] {
	const nsid = document.id;
	return Object.entries(document.defs).flatMap(([name, def]) => {
		const id = `${anchorOf(nsid)}-${name.toLowerCase()}`;
		if (def.type === "record") return [{ id, title: "Record", description: def.description, rows: rowsOf(nsid, def.record) }];
		if (def.type === "procedure" || def.type === "query") {
			return [
				{ id, title: `Input (${def.input?.encoding ?? "none"})`, description: def.description, rows: rowsOf(nsid, def.input?.schema) },
				{ id: `${id}-output`, title: `Output (${def.output?.encoding ?? "none"})`, rows: rowsOf(nsid, def.output?.schema) },
			];
		}
		return [{ id, title: `#${name}`, description: def.description, rows: rowsOf(nsid, def) }];
	});
}

interface Guide {
	summary: string;
	kind: string;
	key: string;
	writtenBy: string;
	readBy: string;
	uses: string[];
	links: Array<{ href: string; label: string }>;
	example: { title: string; value: unknown };
}

const trimmedManifest = { ...statusphereManifest, files: statusphereManifest.files.slice(0, 2) };

const guides: Record<string, Guide> = {
	"com.fedfork.exec.oauth.clientMetadata": {
		summary:
			"An integration: an OAuth client this site can act as, with its full scope and the groups of scopes a person can grant one at a time.",
		kind: "record",
		key: "any. The key names the integration, for example statusphere. The site serves its client metadata at /integrations/<did>/<key>/oauth-client-metadata.json.",
		writtenBy: "The integration's author, into their own repo: publish-records.sh, the integration builder in the studio, or the one-click examples.",
		readBy: "The plugin, when it lists integrations, connects one and serves its client metadata.",
		uses: [
			"client_id and redirect_uris are placeholders. The site replaces them with its own URLs, and rebases client_uri, logo_uri, tos_uri and policy_uri when they share the placeholder's origin.",
			"Every scope in a group must also appear in clientMetadata.scope. The plugin requests atproto plus the scopes of the groups a person ticks.",
			"Only the account that published the record can authorize it, except for site integrations: records the operator lists in EMDASH_SITE_INTEGRATIONS, which any signed-in account may authorize for itself.",
			"The studio is one of these records. records/studio.json is published by the operator and listed as a site integration.",
		],
		links: [
			{ href: "/how-it-works#records", label: "How it works: records define it" },
			{ href: "/use#own", label: "Use it: your own integration" },
			{ href: "/use#site-integrations", label: "Use it: site integrations" },
			{ href: "/studio/integration", label: "Integration builder" },
		],
		example: { title: "records/statusphere.json", value: statusphereIntegration },
	},
	"com.fedfork.exec.wasm.module": {
		summary:
			"A sandboxed WebAssembly module and how to run it: the blob, the integration whose session it uses, the actions people can run, the calls it may plan and where its source is.",
		kind: "record",
		key: "any. The key names the module and is what a run refers to, for example at://<did>/com.fedfork.exec.wasm.module/statusphere.",
		writtenBy: "The module's author: publish-wasm.sh, the module editor in the studio, or the one-click examples.",
		readBy: "The plugin, when it lists modules on an integration's card and when it runs one.",
		uses: [
			"The plugin downloads the blob, checks its sha256 against the blob's CID, and runs the named entry in an isolate with no imports and no network.",
			"session is a strong reference, so a module points at one exact version of its integration. Modules only run with a session the record's own account granted.",
			"calls is an allow-list. The plugin refuses any planned call outside it.",
			"source points at a com.fedfork.exec.source.manifest so anyone can read and rebuild the module.",
		],
		links: [
			{ href: "/modules#contract", label: "Write a module: the contract" },
			{ href: "/how-it-works#rounds", label: "How it works: running a module" },
			{ href: "/studio/module", label: "Module editor" },
		],
		example: { title: "records/wasm/statusphere.json", value: statusphereModule },
	},
	"com.fedfork.exec.wasm.run": {
		summary: "The XRPC procedure the site serves to run a module for the calling account, from a terminal or any atproto app.",
		kind: "procedure",
		key: "None. It is served at POST /xrpc/com.fedfork.exec.wasm.run on the site.",
		writtenBy: "Not stored. The caller sends it to the site directly, or to its own PDS with an atproto-proxy header.",
		readBy: "The site. The did:web document at /.well-known/did.json names the service #emdash_integrations.",
		uses: [
			"The caller authenticates with an atproto service-auth JWT whose aud is the site's did:web and whose lxm is com.fedfork.exec.wasm.run.",
			"Each token's jti works once. A replay gets AuthenticationRequired.",
			"Through a PDS, send atproto-proxy: did:web:<host>#emdash_integrations and the PDS signs the token for you.",
			"The module must run with a session the calling account connected on the site.",
		],
		links: [
			{ href: "/use#cli", label: "Use it: from your terminal" },
			{ href: "/how-it-works#service-auth", label: "How it works: service auth" },
		],
		example: {
			title: "input and output",
			value: {
				input: { module: "at://did:plc:…/com.fedfork.exec.wasm.module/statusphere", entry: "set_status", input: { status: "🦋" } },
				output: {
					did: "did:plc:…",
					module: "Statusphere",
					entry: "set_status",
					rounds: [
						{ entry: "set_status", calls: [{ nsid: "com.atproto.repo.listRecords", ok: true }] },
						{ entry: "set_status_write", calls: [{ nsid: "com.atproto.repo.createRecord", ok: true }] },
						{ entry: "set_status_done", calls: [] },
					],
					result: { status: "🦋", unchanged: false, uri: "at://did:plc:…/xyz.statusphere.status/…" },
				},
			},
		},
	},
	"com.fedfork.exec.source.file": {
		summary: "The contents of one source file. Paths live in the manifests that reference it, so one file record can belong to many snapshots.",
		kind: "record",
		key: "The lowercase hex sha256 of the file's bytes. Identical files are stored once, the way git stores blobs.",
		writtenBy: "publish-wasm.sh and the studio, before they write a manifest. A file that already exists is reused, never rewritten.",
		readBy: "The source viewer, verify-source.sh and anyone rebuilding a module.",
		uses: [
			"Exactly one of text and blob is present. Text up to 256 KB is stored inline; larger or binary files use a blob.",
			"Readers check that sha256 matches the record key and the text, and that the record's CID matches the manifest's strong reference.",
		],
		links: [
			{ href: "/modules#source", label: "Write a module: source records" },
			{ href: "/source", label: "Source viewer" },
		],
		example: {
			title: "a .cargo/config.toml",
			value: {
				$type: "com.fedfork.exec.source.file",
				sha256: "285033faa15221410d801d5394381ae495890d37cc60b6c0aff0b7d08beda7b8",
				size: 42,
				text: '[build]\ntarget = "wasm32-unknown-unknown"\n',
				createdAt: "2026-11-07T08:40:00.000Z",
			},
		},
	},
	"com.fedfork.exec.source.manifest": {
		summary: "An immutable snapshot of a module's source and the exact build that turned it into the published blob.",
		kind: "record",
		key: "any. The tools use <module>.<milliseconds>, so every build keeps its own snapshot.",
		writtenBy: "publish-wasm.sh for Rust modules and the module editor for AssemblyScript, each time they publish a module.",
		readBy: "The source viewer and verify-source.sh, which rebuild from it in a container and compare hashes.",
		uses: [
			"files lists paths with strong references to com.fedfork.exec.source.file records.",
			"build records the tool, the compiler version, the command run in the working directory and the artifact it produces.",
			"output is the sha256 and size of what the build produced. It must equal the module's blob.",
			"A manifest is never updated. A new build is a new manifest, and the module record points at it.",
		],
		links: [
			{ href: "/modules#built", label: "Write a module: how our modules are built" },
			{ href: "/modules#verify", label: "Write a module: verify a build" },
		],
		example: { title: "records/wasm/statusphere.manifest.json, first two files", value: trimmedManifest },
	},
};

export const ORDER = [
	"com.fedfork.exec.oauth.clientMetadata",
	"com.fedfork.exec.wasm.module",
	"com.fedfork.exec.wasm.run",
	"com.fedfork.exec.source.manifest",
	"com.fedfork.exec.source.file",
];

export const lexicons = Object.entries(files)
	.map(([path, document]) => ({
		nsid: document.id,
		anchor: anchorOf(document.id),
		source: `${REPOSITORY}/${path.replace(/^\.\.\/\.\.\//, "")}`,
		description: document.defs.main?.description,
		tables: tablesOf(document),
		errors: document.defs.main?.errors ?? [],
		guide: guides[document.id],
	}))
	.filter((lexicon) => lexicon.guide)
	.sort((a, b) => ORDER.indexOf(a.nsid) - ORDER.indexOf(b.nsid));

const palette = `
  classDef you fill:#8b5cf624,stroke:#8b5cf6,stroke-width:1.5px
  classDef pds fill:#ec489924,stroke:#ec4899,stroke-width:1.5px
  classDef site fill:#3b82f624,stroke:#3b82f6,stroke-width:1.5px
  classDef sandbox fill:#f59e0b24,stroke:#f59e0b,stroke-width:1.5px
  classDef wasm fill:#10b98124,stroke:#10b981,stroke-width:1.5px
  classDef cloud fill:#f9731624,stroke:#f97316,stroke-width:1.5px
  classDef store fill:#64748b24,stroke:#64748b,stroke-width:1.5px
  classDef deny fill:#ef444424,stroke:#ef4444,stroke-width:1.5px`;

export const relationships = `flowchart LR
  SITE["EMDASH_SITE_INTEGRATIONS<br/>site integrations, like the studio"]:::site
  CM["oauth.clientMetadata<br/>key: integration name"]:::pds
  RUN["wasm.run<br/>procedure on the site"]:::site
  MOD["wasm.module<br/>key: module name"]:::wasm
  BLOB[("WebAssembly blob<br/>application/wasm")]:::store
  MAN["source.manifest<br/>key: module.milliseconds"]:::pds
  FILE["source.file<br/>key: sha256"]:::store
  SITE -- "lists" --> CM
  RUN -- "module: at-uri" --> MOD
  MOD -- "session: strong ref" --> CM
  MOD -- "module: blob" --> BLOB
  MOD -- "source: strong ref" --> MAN
  MAN -- "files: strong refs" --> FILE
${palette}`;
