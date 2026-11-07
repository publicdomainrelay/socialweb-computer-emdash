import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext } from "emdash/plugin";
import { clientConfig, type Integration } from "./client";
import { type Interaction, optionalText, textList } from "./interaction";
import { beginAuthorization, disconnect } from "./oauth";
import { grantedGroupIds } from "./scopes";
import { loadSession, takeNotice } from "./store";

export const CONNECT_PAGE = "/connect";

const groupOptions = (integration: Integration, ids: string[]) =>
	integration.groups
		.filter((group) => ids.includes(group.id))
		.map((group) => ({ label: group.label, value: group.id }));

function authorizeBlocks(url: string): Block[] {
	return [
		{
			type: "banner",
			title: "Continue at your account provider",
			description: "Approve the requested permissions, then you return here.",
		},
		{
			type: "actions",
			elements: [{ type: "link", label: "Authorize", target: { kind: "external", url }, appearance: "primary" }],
		},
	];
}

async function renderConnect(ctx: PluginContext, integration: Integration, top: Block[] = []): Promise<BlockResponse> {
	const session = await loadSession(ctx);
	const notice = await takeNotice(ctx);
	const allIds = integration.groups.map((group) => group.id);
	const granted = session ? grantedGroupIds(integration.groups, session.scope) : [];
	const missing = allIds.filter((id) => !granted.includes(id));
	const blocks: Block[] = [
		{ type: "header", text: integration.name },
		...(notice ? [{ type: "banner", description: notice } satisfies Block] : []),
		...top,
	];
	if (!session) {
		blocks.push(
			{ type: "context", text: "This plugin is its own OAuth client. Pick only the permissions you need now." },
			{
				type: "form",
				block_id: "connect",
				fields: [
					{ type: "text_input", action_id: "identifier", label: "Handle or DID", placeholder: "alice.bsky.social" },
					{
						type: "checkbox",
						action_id: "groups",
						label: "Permissions",
						options: groupOptions(integration, allIds),
						initial_value: allIds.slice(0, 1),
					},
				],
				submit: { label: "Connect", action_id: "oauth:connect" },
			},
		);
	} else {
		blocks.push({
			type: "fields",
			fields: [
				{ label: "Account", value: session.handle ?? session.did },
				{ label: "DID", value: session.did },
				{ label: "PDS", value: session.pds },
				{ label: "Authorization server", value: session.issuer },
			],
		});
		if (missing.length) {
			blocks.push({
				type: "form",
				block_id: "upgrade",
				fields: [
					{ type: "checkbox", action_id: "groups", label: "Request more access", options: groupOptions(integration, missing) },
				],
				submit: { label: "Upgrade", action_id: "oauth:upgrade" },
			});
		}
		blocks.push({
			type: "actions",
			elements: [
				{
					type: "button",
					action_id: "oauth:disconnect",
					label: "Disconnect",
					style: "danger",
					confirm: { title: "Disconnect?", text: "The session is revoked.", confirm: "Disconnect", deny: "Cancel" },
				},
			],
		});
	}
	blocks.push(
		{
			type: "table",
			page_action_id: "oauth:page",
			columns: [
				{ key: "group", label: "Permission" },
				{ key: "status", label: "Status", format: "badge" },
				{ key: "scopes", label: "Scopes", format: "code" },
			],
			rows: integration.groups.map((group) => ({
				group: group.label,
				status: granted.includes(group.id) ? "granted" : "not granted",
				scopes: group.scopes.join(" "),
			})),
		},
		{ type: "context", text: `client_id: ${clientConfig(ctx, integration).clientId}` },
	);
	return { blocks };
}

async function authorize(ctx: PluginContext, integration: Integration, identifier: string, groups: string[]) {
	try {
		const url = await beginAuthorization(ctx, integration, identifier, groups);
		return renderConnect(ctx, integration, authorizeBlocks(url));
	} catch (error) {
		return {
			...(await renderConnect(ctx, integration)),
			toast: { type: "error" as const, message: error instanceof Error ? error.message : "Authorization failed" },
		};
	}
}

export async function handleConnect(
	ctx: PluginContext,
	integration: Integration,
	interaction: Interaction,
): Promise<BlockResponse | undefined> {
	if (interaction.type === "page_load") {
		return interaction.page === CONNECT_PAGE ? renderConnect(ctx, integration) : undefined;
	}
	if (interaction.type === "block_action" && interaction.action_id === "oauth:disconnect") {
		await disconnect(ctx, integration);
		return { ...(await renderConnect(ctx, integration)), toast: { type: "success", message: "Disconnected" } };
	}
	if (interaction.type !== "form_submit") return undefined;
	if (interaction.action_id === "oauth:connect") {
		const identifier = optionalText(interaction.values.identifier);
		if (!identifier) return { ...(await renderConnect(ctx, integration)), toast: { type: "error", message: "Enter a handle or DID" } };
		return authorize(ctx, integration, identifier, textList(interaction.values.groups));
	}
	if (interaction.action_id === "oauth:upgrade") {
		const session = await loadSession(ctx);
		const extra = textList(interaction.values.groups);
		if (!session || !extra.length) return renderConnect(ctx, integration);
		return authorize(ctx, integration, session.did, [...grantedGroupIds(integration.groups, session.scope), ...extra]);
	}
	return undefined;
}
