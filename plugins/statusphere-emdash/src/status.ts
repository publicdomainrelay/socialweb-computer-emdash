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
import { BSKY_APPVIEW, EMOJIS, integration, STATUS_COLLECTION } from "./integration";

export const STATUS_PAGE = "/status";

interface StoredStatus {
	uri: string;
	status: string;
	createdAt: string;
}

interface Profile {
	handle: string;
	displayName?: string;
	followersCount?: number;
	postsCount?: number;
}

const connectLink = (label: string): Block => ({
	type: "actions",
	elements: [{ type: "link", label, target: { kind: "plugin-page", path: CONNECT_PAGE } }],
});

const upgradeBanner = (group: string): Block[] => [
	{ type: "banner", variant: "alert", description: `This needs the "${group}" permission.` },
	connectLink("Upgrade permissions"),
];

const groupLabel = (id: string) => integration.groups.find((group) => group.id === id)?.label ?? id;

export async function postStatus(ctx: PluginContext, agent: Agent, status: string) {
	agent.requireGroup("status");
	const createdAt = new Date().toISOString();
	const { uri } = await agent.createRecord(STATUS_COLLECTION, { status, createdAt });
	await ctx.storage.statuses.put(uri.split("/").pop() ?? uri, { uri, status, createdAt });
	return uri;
}

async function profileBlocks(agent: Agent): Promise<Block[]> {
	const profile = await agent.call<Profile>("app.bsky.actor.getProfile", {
		params: { actor: agent.session.did },
		proxy: BSKY_APPVIEW,
	});
	return [
		{
			type: "fields",
			fields: [
				{ label: "Name", value: profile.displayName || profile.handle },
				{ label: "Handle", value: `@${profile.handle}` },
				{ label: "Followers", value: String(profile.followersCount ?? 0) },
				{ label: "Posts", value: String(profile.postsCount ?? 0) },
			],
		},
	];
}

async function renderStatus(ctx: PluginContext): Promise<BlockResponse> {
	const agent = await connectedAgent(ctx, integration);
	if (!agent) {
		return {
			blocks: [
				{ type: "header", text: "Statusphere" },
				{
					type: "empty",
					title: "No account connected",
					description: "Connect an Atmosphere account to post statuses.",
					actions: [{ type: "link", label: "Connect", target: { kind: "plugin-page", path: CONNECT_PAGE }, appearance: "primary" }],
				},
			],
		};
	}
	const granted = grantedGroupIds(integration.groups, agent.session.scope);
	const recent = await ctx.storage.statuses.query({ orderBy: { createdAt: "desc" }, limit: 20 });
	const publishEmoji = (await ctx.settings.get<string>("publishEmoji")) ?? "";
	const blocks: Block[] = [{ type: "header", text: `Statusphere for ${agent.session.handle ?? agent.session.did}` }];
	blocks.push(...(granted.includes("profile") ? await profileBlocks(agent) : upgradeBanner(groupLabel("profile"))));
	if (!granted.includes("status")) {
		blocks.push(...upgradeBanner(groupLabel("status")));
		return { blocks };
	}
	blocks.push(
		{ type: "section", text: "Set your status" },
		{
			type: "actions",
			elements: EMOJIS.map((emoji) => ({ type: "button", action_id: "status:set", label: emoji, value: emoji })),
		},
		{
			type: "form",
			block_id: "publish",
			fields: [
				{
					type: "select",
					action_id: "publishEmoji",
					label: "Set this status when content is published",
					options: [{ label: "Off", value: "" }, ...EMOJIS.map((emoji) => ({ label: emoji, value: emoji }))],
					initial_value: publishEmoji,
				},
			],
			submit: { label: "Save", action_id: "status:publish" },
		},
		{
			type: "table",
			page_action_id: "status:page",
			empty_text: "No statuses posted from this site yet",
			columns: [
				{ key: "status", label: "Status" },
				{ key: "createdAt", label: "Posted", format: "relative_time" },
				{ key: "uri", label: "Record", format: "code" },
				{ key: "action", label: "", format: "element" },
			],
			rows: recent.items.map(({ id, data }) => {
				const status = data as StoredStatus;
				return {
					...status,
					action: { type: "button", action_id: "status:delete", label: "Delete", style: "danger", value: id },
				};
			}),
		},
	);
	return { blocks };
}

async function withToast(ctx: PluginContext, action: () => Promise<string>): Promise<BlockResponse> {
	try {
		const message = await action();
		return { ...(await renderStatus(ctx)), toast: { type: "success", message } };
	} catch (error) {
		const message =
			error instanceof MissingScopeError
				? `Grant "${groupLabel(error.groupId)}" on the Connect page first`
				: error instanceof Error
					? error.message
					: "Request failed";
		return { ...(await renderStatus(ctx)), toast: { type: "error", message } };
	}
}

async function requireAgent(ctx: PluginContext) {
	const agent = await connectedAgent(ctx, integration);
	if (!agent) throw new Error("Connect an account first");
	return agent;
}

export async function handleStatus(ctx: PluginContext, interaction: Interaction): Promise<BlockResponse | undefined> {
	if (interaction.type === "page_load") return interaction.page === STATUS_PAGE ? renderStatus(ctx) : undefined;
	if (interaction.type === "block_action" && interaction.action_id === "status:set") {
		return withToast(ctx, async () => {
			const status = text(interaction.value, 32);
			await postStatus(ctx, await requireAgent(ctx), status);
			return `Status set to ${status}`;
		});
	}
	if (interaction.type === "block_action" && interaction.action_id === "status:delete") {
		return withToast(ctx, async () => {
			const rkey = text(interaction.value, 512);
			const agent = await requireAgent(ctx);
			agent.requireGroup("status");
			await agent.deleteRecord(STATUS_COLLECTION, rkey);
			await ctx.storage.statuses.delete(rkey);
			return "Status deleted";
		});
	}
	if (interaction.type === "form_submit" && interaction.action_id === "status:publish") {
		return withToast(ctx, async () => {
			const publishEmoji = optionalText(interaction.values.publishEmoji, 32);
			await ctx.settings.set("publishEmoji", publishEmoji);
			return publishEmoji ? `Publishing sets status ${publishEmoji}` : "Publish status off";
		});
	}
	return undefined;
}
