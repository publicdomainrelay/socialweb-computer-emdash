import { plugin, studioDid } from "./api";

const COLLECTION = "com.fedfork.exec.oauth.clientMetadata";
const STUDIO_RKEY = "_studio";
const RKEY = /^[a-zA-Z0-9._:~-]{1,512}$/;
const GROUP_KEY = /^[a-z0-9-]+$/;
const NSID = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){2,}$/;
const MIME = /^[a-z*]+\/[a-zA-Z0-9.+*-]+$/;

interface Group {
	key: string;
	label: string;
	scopes: string[];
}

interface StoredIntegration {
	rkey: string;
	value: {
		name?: string;
		description?: string;
		clientMetadata?: Record<string, unknown>;
		scopeGroups?: Group[];
		createdAt?: string;
	};
}

interface State {
	rkey: string;
	name: string;
	description: string;
	clientName: string;
	clientUri: string;
	logoUri: string;
	groups: Group[];
	extra: string;
	createdAt: string;
}

const blank = (): State => ({
	rkey: "",
	name: "",
	description: "",
	clientName: "",
	clientUri: "",
	logoUri: "",
	groups: [{ key: "write", label: "Write records", scopes: [] }],
	extra: "",
	createdAt: new Date().toISOString(),
});

const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const lines = (text: string) => text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
const text = (value: unknown) => (typeof value === "string" ? value : "");

function isUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

function fromStored({ rkey, value }: StoredIntegration): State {
	const metadata = value.clientMetadata ?? {};
	const groups = (value.scopeGroups ?? []).map((group) => ({ key: group.key, label: group.label, scopes: [...group.scopes] }));
	const grouped = new Set(groups.flatMap((group) => group.scopes));
	const extra = lines(text(metadata.scope)).filter((scope) => scope !== "atproto" && !grouped.has(scope));
	return {
		rkey,
		name: text(value.name),
		description: text(value.description),
		clientName: text(metadata.client_name),
		clientUri: text(metadata.client_uri),
		logoUri: text(metadata.logo_uri),
		groups,
		extra: extra.join("\n"),
		createdAt: text(value.createdAt) || new Date().toISOString(),
	};
}

export function declaredScope(state: State) {
	return unique(["atproto", ...lines(state.extra), ...state.groups.flatMap((group) => group.scopes)]).join(" ");
}

export function buildRecord(state: State) {
	const host = isUrl(state.clientUri) ? new URL(state.clientUri).host : "example.com";
	return {
		$type: COLLECTION,
		name: state.name.trim(),
		...(state.description.trim() ? { description: state.description.trim() } : {}),
		clientMetadata: {
			client_id: `https://${host}/oauth-client-metadata.json`,
			...(state.clientName.trim() ? { client_name: state.clientName.trim() } : {}),
			...(state.clientUri.trim() ? { client_uri: state.clientUri.trim() } : {}),
			...(state.logoUri.trim() ? { logo_uri: state.logoUri.trim() } : {}),
			redirect_uris: [`https://${host}/oauth/callback`],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			scope: declaredScope(state),
			application_type: "web",
			token_endpoint_auth_method: "none",
			dpop_bound_access_tokens: true,
		},
		scopeGroups: state.groups.map((group) => ({ key: group.key.trim(), label: group.label.trim(), scopes: [...group.scopes] })),
		createdAt: state.createdAt,
	};
}

export function problems(state: State) {
	const found: string[] = [];
	if (!RKEY.test(state.rkey) || state.rkey === "." || state.rkey === ".." || state.rkey === STUDIO_RKEY) {
		found.push("Record key must be 1 to 512 characters of letters, digits and . _ : ~ - (and not _studio).");
	}
	if (!state.name.trim()) found.push("Name is required.");
	if (state.clientUri.trim() && !isUrl(state.clientUri.trim())) found.push("Client URI must be an http or https URL.");
	if (state.logoUri.trim() && !isUrl(state.logoUri.trim())) found.push("Logo URI must be an http or https URL.");
	const keys = new Set<string>();
	for (const group of state.groups) {
		if (!GROUP_KEY.test(group.key.trim())) found.push(`Group key "${group.key}" must be lowercase letters, digits and -.`);
		if (keys.has(group.key.trim())) found.push(`Group key "${group.key}" is used twice.`);
		keys.add(group.key.trim());
		if (!group.label.trim()) found.push(`Group "${group.key}" needs a label.`);
		if (!group.scopes.length) found.push(`Group "${group.key}" has no scopes.`);
	}
	return found;
}

export function helperScope(kind: string, target: string, aud: string, actions: string[]) {
	const value = target.trim();
	switch (kind) {
		case "repo":
			if (!NSID.test(value)) throw new Error("Enter a collection NSID, for example com.example.post.");
			return `repo:${value}${actions.length ? `?${actions.map((action) => `action=${action}`).join("&")}` : ""}`;
		case "rpc":
			if (!NSID.test(value)) throw new Error("Enter a method NSID, for example com.example.getThing.");
			return `rpc:${value}?aud=${(aud.trim() || "*").replaceAll("#", "%23")}`;
		case "blob":
			if (value && !MIME.test(value)) throw new Error("Enter a MIME type, for example image/*.");
			return `blob:${value || "*/*"}`;
		case "account":
			return `account:${value || "email"}`;
		case "identity":
			return `identity:${value || "*"}`;
		case "include":
			if (!NSID.test(value)) throw new Error("Enter a permission set NSID.");
			return `include:${value}`;
		default:
			throw new Error(`Unknown scope kind ${kind}`);
	}
}

const element = <T extends HTMLElement>(root: ParentNode, selector: string) => {
	const found = root.querySelector<T>(selector);
	if (!found) throw new Error(`Missing ${selector}`);
	return found;
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: Node[] = []) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

export function mountIntegrationBuilder(root: HTMLElement) {
	const stored = JSON.parse(element(root, "[data-records]").textContent ?? "[]") as StoredIntegration[];
	const ready = root.dataset.ready === "true";
	let state = blank();

	const start = element<HTMLSelectElement>(root, "[data-start]");
	const fields = ["rkey", "name", "description", "clientName", "clientUri", "logoUri", "extra"] as const;
	const inputs = Object.fromEntries(fields.map((name) => [name, element<HTMLInputElement | HTMLTextAreaElement>(root, `[name="${name}"]`)])) as Record<
		(typeof fields)[number],
		HTMLInputElement | HTMLTextAreaElement
	>;
	const groupsBox = element(root, "[data-groups]");
	const helperGroup = element<HTMLSelectElement>(root, "[data-helper-group]");
	const helperKind = element<HTMLSelectElement>(root, "[data-helper-kind]");
	const helperTarget = element<HTMLInputElement>(root, "[data-helper-target]");
	const helperAud = element<HTMLInputElement>(root, "[data-helper-aud]");
	const helperAudRow = element(root, "[data-helper-aud-row]");
	const helperActions = element(root, "[data-helper-actions]");
	const helperPreview = element(root, "[data-helper-preview]");
	const scopeOut = element(root, "[data-scope]");
	const jsonOut = element(root, "[data-json]");
	const problemsOut = element(root, "[data-problems]");
	const publish = element<HTMLButtonElement>(root, "[data-publish]");
	const result = element(root, "[data-result]");

	const helperValue = () => {
		const actions = [...helperActions.querySelectorAll<HTMLInputElement>("input:checked")].map((input) => input.value);
		return helperScope(helperKind.value, helperTarget.value, helperAud.value, actions);
	};

	const refreshHelper = () => {
		helperActions.hidden = helperKind.value !== "repo";
		helperAudRow.hidden = helperKind.value !== "rpc";
		const placeholders: Record<string, string> = {
			repo: "com.example.post",
			rpc: "com.example.getThing",
			blob: "image/*",
			account: "email",
			identity: "handle",
			include: "com.example.authFull",
		};
		helperTarget.placeholder = placeholders[helperKind.value] ?? "";
		try {
			helperPreview.textContent = helperValue();
			helperPreview.classList.remove("builder__helper-error");
		} catch (cause) {
			helperPreview.textContent = cause instanceof Error ? cause.message : String(cause);
			helperPreview.classList.add("builder__helper-error");
		}
	};

	const refreshPreview = () => {
		const record = buildRecord(state);
		scopeOut.textContent = record.clientMetadata.scope;
		jsonOut.textContent = JSON.stringify(record, null, 2);
		const found = problems(state);
		problemsOut.replaceChildren(...found.map((problem) => make("li", { textContent: problem })));
		problemsOut.hidden = found.length === 0;
		publish.disabled = !ready || found.length > 0;
	};

	const refreshHelperGroups = () => {
		const selected = helperGroup.value;
		helperGroup.replaceChildren(
			...state.groups.map((group, index) => make("option", { value: String(index), textContent: group.label || group.key || `Group ${index + 1}` })),
		);
		helperGroup.value = Number(selected) < state.groups.length ? selected : "0";
	};

	const addScope = (group: Group, scope: string) => {
		const value = scope.trim();
		if (!value || group.scopes.includes(value)) return;
		group.scopes.push(value);
		renderGroups();
	};

	function renderGroups() {
		groupsBox.replaceChildren(
			...state.groups.map((group, index) => {
				const key = make("input", { className: "field", name: `group-${index}-key`, autocomplete: "off", value: group.key, placeholder: "posts", ariaLabel: "Group key" });
				key.addEventListener("input", () => {
					group.key = key.value;
					refreshHelperGroups();
					refreshPreview();
				});
				const label = make("input", { className: "field", name: `group-${index}-label`, autocomplete: "off", value: group.label, placeholder: "Write posts", ariaLabel: "Group label" });
				label.addEventListener("input", () => {
					group.label = label.value;
					refreshHelperGroups();
					refreshPreview();
				});
				const chips = make(
					"ul",
					{ className: "builder__chips" },
					group.scopes.map((scope) => {
						const remove = make("button", { type: "button", className: "builder__chip-remove", textContent: "×", ariaLabel: `Remove ${scope}` });
						remove.addEventListener("click", () => {
							group.scopes = group.scopes.filter((item) => item !== scope);
							renderGroups();
						});
						return make("li", { className: "builder__chip" }, [make("code", { textContent: scope }), remove]);
					}),
				);
				const scopeInput = make("input", { className: "field", name: `group-${index}-scope`, autocomplete: "off", placeholder: "repo:com.example.post?action=create", ariaLabel: "Scope to add" });
				const addButton = make("button", { type: "button", className: "btn btn--ghost btn--small", textContent: "Add scope" });
				addButton.addEventListener("click", () => addScope(group, scopeInput.value));
				scopeInput.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						addScope(group, scopeInput.value);
					}
				});
				const removeGroup = make("button", { type: "button", className: "btn btn--danger btn--small", textContent: "Remove group" });
				removeGroup.addEventListener("click", () => {
					state.groups.splice(index, 1);
					renderGroups();
				});
				return make("fieldset", { className: "builder__group" }, [
					make("legend", { textContent: `Group ${index + 1}` }),
					make("div", { className: "form-grid" }, [
						make("div", { className: "form-row" }, [make("span", { className: "form-label", textContent: "Key" }), key]),
						make("div", { className: "form-row" }, [make("span", { className: "form-label", textContent: "Label" }), label]),
					]),
					group.scopes.length ? chips : make("p", { className: "form-hint", textContent: "No scopes yet. Add one below or with the scope helper." }),
					make("div", { className: "builder__add" }, [scopeInput, addButton]),
					make("div", { className: "toolbar" }, [removeGroup]),
				]);
			}),
		);
		refreshHelperGroups();
		refreshPreview();
	}

	const load = (next: State) => {
		state = next;
		for (const name of fields) inputs[name].value = state[name];
		result.hidden = true;
		renderGroups();
	};

	start.replaceChildren(
		make("option", { value: "", textContent: "New integration" }),
		...stored.map((record) => make("option", { value: record.rkey, textContent: `${record.value.name ?? record.rkey} (${record.rkey})` })),
	);
	start.addEventListener("change", () => {
		const found = stored.find((record) => record.rkey === start.value);
		load(found ? fromStored(found) : blank());
	});

	for (const name of fields) {
		inputs[name].addEventListener("input", () => {
			state[name] = inputs[name].value;
			refreshPreview();
		});
	}

	element(root, "[data-add-group]").addEventListener("click", () => {
		state.groups.push({ key: `group-${state.groups.length + 1}`, label: "", scopes: [] });
		renderGroups();
	});

	for (const control of [helperKind, helperTarget, helperAud, ...helperActions.querySelectorAll("input")]) {
		control.addEventListener("input", refreshHelper);
		control.addEventListener("change", refreshHelper);
	}
	element(root, "[data-helper-add]").addEventListener("click", () => {
		const group = state.groups[Number(helperGroup.value)];
		if (!group) return;
		try {
			addScope(group, helperValue());
		} catch {
			refreshHelper();
		}
	});

	element(root, "[data-copy]").addEventListener("click", async (event) => {
		const button = event.currentTarget as HTMLButtonElement;
		try {
			await navigator.clipboard.writeText(JSON.stringify(buildRecord(state), null, 2));
			button.textContent = "Copied";
		} catch {
			button.textContent = "Select the JSON and copy it";
		}
		setTimeout(() => (button.textContent = "Copy JSON"), 1600);
	});

	publish.addEventListener("click", async () => {
		publish.disabled = true;
		result.hidden = false;
		result.className = "notice";
		result.textContent = "Publishing…";
		try {
			const { uri, cid } = await plugin<{ uri: string; cid: string }>("studio/publish-integration", {
				did: studioDid(),
				rkey: state.rkey,
				record: buildRecord(state),
			});
			result.className = "notice notice--success";
			result.replaceChildren(
				make("strong", { textContent: "Published. " }),
				make("code", { textContent: uri }),
				document.createTextNode(` (${cid}). `),
				make("a", { href: "/integrations", textContent: "Open integrations" }),
			);
		} catch (cause) {
			result.className = "notice notice--error";
			result.textContent = cause instanceof Error ? cause.message : String(cause);
		} finally {
			refreshPreview();
		}
	});

	load(blank());
	refreshHelper();
}
