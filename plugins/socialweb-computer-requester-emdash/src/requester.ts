import type { Block, BlockResponse } from "@emdash-cms/blocks";
import {
	type Agent,
	CONNECT_PAGE,
	connectedAgent,
	grantedGroupIds,
	type Interaction,
	MissingScopeError,
	optionalText,
	text,
} from "atproto-oauth-sandbox";
import type { PluginContext } from "emdash/plugin";
import { ASSOCIATE_CONFIRM, COMPUTE_VM, integration } from "./integration";

export const REQUESTER_PAGE = "/requester";

type StoredRecord = {
	uri: string;
	collection: string;
	createdAt: string;
};

const groupLabel = (id: string) => integration.groups.find((group) => group.id === id)?.label ?? id;

export function writableCollections(scope: string) {
	const collections = scope.split(" ").flatMap((item) => {
		const match = /^repo:([^?]+)(?:\?(.*))?$/.exec(item);
		if (!match) return [];
		const actions = new URLSearchParams(match[2] ?? "").getAll("action");
		return actions.length === 0 || actions.includes("create") ? [match[1]] : [];
	});
	return [...new Set(collections)].sort();
}

const gated = (granted: string[], id: string, blocks: Block[]): Block[] =>
	granted.includes(id)
		? blocks
		: [
				{ type: "banner", variant: "alert", description: `Needs the "${groupLabel(id)}" permission.` },
				{
					type: "actions",
					elements: [{ type: "link", label: "Upgrade permissions", target: { kind: "plugin-page", path: CONNECT_PAGE } }],
				},
			];

const associateBlocks: Block[] = [
	{
		type: "form",
		block_id: "associate",
		fields: [{ type: "text_input", action_id: "requesterDid", label: "Requester DID", placeholder: "did:plc:..." }],
		submit: { label: "Confirm association", action_id: "requester:associate" },
	},
];

const computeBlocks: Block[] = [
	{
		type: "form",
		block_id: "compute",
		fields: [
			{ type: "number_input", action_id: "cpus", label: "vCPUs", initial_value: 2, min: 1, max: 64 },
			{ type: "text_input", action_id: "mem", label: "Memory", initial_value: "4G" },
			{ type: "text_input", action_id: "disk", label: "Disk", initial_value: "50G" },
			{ type: "text_input", action_id: "network", label: "Network quota", initial_value: "500G" },
			{ type: "text_input", action_id: "role", label: "RBAC role", placeholder: "compute-runner" },
			{ type: "text_input", action_id: "user_data", label: "cloud-init user data", multiline: true, initial_value: "#cloud-config\n" },
		],
		submit: { label: "Create compute.vm record", action_id: "requester:compute" },
	},
];

function writerBlocks(collections: string[]): Block[] {
	if (!collections.length) return [];
	return [
		{ type: "section", text: "Write any record your granted scopes allow" },
		{
			type: "form",
			block_id: "write",
			fields: [
				{
					type: "select",
					action_id: "collection",
					label: "Collection",
					options: collections.map((collection) => ({ label: collection, value: collection })),
					initial_value: collections[0],
				},
				{ type: "text_input", action_id: "record", label: "Record JSON", multiline: true, initial_value: "{}" },
			],
			submit: { label: "Create record", action_id: "requester:write" },
		},
	];
}

async function renderRequester(ctx: PluginContext): Promise<BlockResponse> {
	const agent = await connectedAgent(ctx, integration);
	if (!agent) {
		return {
			blocks: [
				{ type: "header", text: "socialweb.computer requester" },
				{
					type: "empty",
					title: "No account connected",
					description: "Connect an account, starting with just the permissions you need.",
					actions: [{ type: "link", label: "Connect", target: { kind: "plugin-page", path: CONNECT_PAGE }, appearance: "primary" }],
				},
			],
		};
	}
	const granted = grantedGroupIds(integration.groups, agent.session.scope);
	const recent = await ctx.storage.records.query({ orderBy: { createdAt: "desc" }, limit: 20 });
	return {
		blocks: [
			{ type: "header", text: `Requester for ${agent.session.handle ?? agent.session.did}` },
			{
				type: "stats",
				items: [
					{ label: "Permission groups", value: `${granted.length}/${integration.groups.length}` },
					{ label: "Writable collections", value: writableCollections(agent.session.scope).length },
				],
			},
			{ type: "section", text: groupLabel("associate") },
			...gated(granted, "associate", associateBlocks),
			{ type: "section", text: groupLabel("compute") },
			...gated(granted, "compute", computeBlocks),
			...writerBlocks(writableCollections(agent.session.scope)),
			{
				type: "table",
				page_action_id: "requester:page",
				empty_text: "No records written from this site yet",
				columns: [
					{ key: "collection", label: "Collection", format: "code" },
					{ key: "createdAt", label: "Written", format: "relative_time" },
					{ key: "uri", label: "Record", format: "code" },
				],
				rows: recent.items.map(({ data }) => data as StoredRecord),
			},
		],
	};
}

async function requireAgent(ctx: PluginContext) {
	const agent = await connectedAgent(ctx, integration);
	if (!agent) throw new Error("Connect an account first");
	return agent;
}

async function writeRecord(ctx: PluginContext, agent: Agent, collection: string, record: Record<string, unknown>) {
	if (!writableCollections(agent.session.scope).includes(collection)) {
		throw new Error(`${collection} is not covered by the granted scopes`);
	}
	const createdAt = new Date().toISOString();
	const { uri } = await agent.createRecord(collection, { createdAt, ...record });
	await ctx.storage.records.put(uri.replace(/[^a-zA-Z0-9]/g, "_"), { uri, collection, createdAt });
	return uri;
}

function parseRecord(value: unknown) {
	const parsed = JSON.parse(text(value, 64 * 1024)) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Record must be a JSON object");
	return parsed as Record<string, unknown>;
}

const actions: Record<string, (ctx: PluginContext, values: Record<string, unknown>) => Promise<string>> = {
	"requester:associate": async (ctx, values) => {
		const requesterDid = text(values.requesterDid);
		if (!requesterDid.startsWith("did:")) throw new Error("Requester must be a DID");
		const agent = await requireAgent(ctx);
		agent.requireGroup("associate");
		const result = await agent.call<{ ok: boolean; requesterDid: string }>(ASSOCIATE_CONFIRM, {
			input: {},
			proxy: `${requesterDid}#requester_associate`,
		});
		return result.ok ? `Associated with ${result.requesterDid}` : "Requester declined the association";
	},
	"requester:compute": async (ctx, values) => {
		const agent = await requireAgent(ctx);
		agent.requireGroup("compute");
		const cpus = Number(values.cpus);
		if (!Number.isInteger(cpus) || cpus < 1) throw new Error("vCPUs must be a positive integer");
		const uri = await writeRecord(ctx, agent, COMPUTE_VM, {
			kind: "vm",
			cpus,
			mem: text(values.mem, 16),
			disk: text(values.disk, 16),
			network: text(values.network, 16),
			role: text(values.role, 128),
			user_data: optionalText(values.user_data, 32 * 1024) || "#cloud-config\n",
		});
		return `Created ${uri}`;
	},
	"requester:write": async (ctx, values) => {
		const agent = await requireAgent(ctx);
		const uri = await writeRecord(ctx, agent, text(values.collection), parseRecord(values.record));
		return `Created ${uri}`;
	},
};

export async function handleRequester(ctx: PluginContext, interaction: Interaction): Promise<BlockResponse | undefined> {
	if (interaction.type === "page_load") return interaction.page === REQUESTER_PAGE ? renderRequester(ctx) : undefined;
	if (interaction.type !== "form_submit") return undefined;
	const action = actions[interaction.action_id];
	if (!action) return undefined;
	try {
		const message = await action(ctx, interaction.values);
		return { ...(await renderRequester(ctx)), toast: { type: "success", message } };
	} catch (error) {
		const message =
			error instanceof MissingScopeError
				? `Grant "${groupLabel(error.groupId)}" on the Connect page first`
				: error instanceof Error
					? error.message
					: "Request failed";
		return { ...(await renderRequester(ctx)), toast: { type: "error", message } };
	}
}
