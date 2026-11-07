import type { Integration } from "atproto-oauth-sandbox";

const PDR = "com.publicdomainrelay.temp";
const create = (nsid: string) => `repo:${nsid}?action=create`;
const update = (nsid: string) => `repo:${nsid}?action=create&action=update`;
const manage = (nsid: string) => `repo:${nsid}?action=create&action=update&action=delete`;
const anyAud = (nsid: string) => `rpc:${nsid}?aud=*`;

export const ATIRC_SERVICE = "did:web:irc.fedfork.com%23atirc";
export const COMPUTE_VM = `${PDR}.compute.vm`;
export const ASSOCIATE_CONFIRM = `${PDR}.requester.associateConfirm`;

export const integration: Integration = {
	name: "socialweb.computer requester",
	groups: [
		{ id: "associate", label: "Confirm requester association", scopes: [anyAud(ASSOCIATE_CONFIRM)] },
		{
			id: "compute",
			label: "Describe compute to request",
			scopes: [create(COMPUTE_VM), update(COMPUTE_VM), create(`${PDR}.compute.config.wif.simple`)],
		},
		{
			id: "market",
			label: "Submit RFPs, accepts, bids and receipts",
			scopes: [
				create(`${PDR}.market.rfp`),
				update(`${PDR}.market.rfp`),
				create(`${PDR}.market.accept`),
				update(`${PDR}.market.accept`),
				create(`${PDR}.market.bid`),
				create(`${PDR}.market.bids.free`),
				create(`${PDR}.market.receipt`),
				create(`${PDR}.market.event`),
				update(`${PDR}.market.event`),
				anyAud(`${PDR}.market.submitRfp`),
				anyAud(`${PDR}.market.submitAccept`),
				anyAud(`${PDR}.market.submitBid`),
				anyAud(`${PDR}.market.submitEvent`),
			],
		},
		{
			id: "events",
			label: "Report compute lifecycle events",
			scopes: [
				...["vm.terminated", "vm.hostKeys", "guest.secretsApplied", "guest.secretsRequested", "guest.requesterDid", "guest.r2Released"].map(
					(name) => create(`${PDR}.compute.events.${name}`),
				),
				...["vm.delete", "vm.onNetwork", "guest.publicKey", "guest.signalWebRTC"].flatMap((name) => [
					create(`${PDR}.compute.events.${name}`),
					update(`${PDR}.compute.events.${name}`),
				]),
				...["guest.secrets", "guest.agentStart", "guest.secretsUpdated", "guest.r2Start", "guest.r2Release"].map((name) =>
					update(`${PDR}.compute.events.${name}`),
				),
			],
		},
		{
			id: "offering",
			label: "Offer compute as a bidder",
			scopes: [
				update(`${PDR}.market.offering`),
				update(`${PDR}.market.heartbeat`),
				create(`${PDR}.market.bidderAssociation`),
				manage(`${PDR}.market.association`),
				manage(`${PDR}.market.associationRequest`),
			],
		},
		{
			id: "policy",
			label: "Publish evaluation policies",
			scopes: ["ghalite", "typescript"].flatMap((name) => [
				create(`computer.socialweb.temp.policy.${name}`),
				update(`computer.socialweb.temp.policy.${name}`),
			]),
		},
		{
			id: "access",
			label: "Manage RBAC, allowlists and badge keys",
			scopes: [
				create("com.fedproxy.rbac"),
				manage("com.fedproxy.rbac"),
				create(`${PDR}.auth.allowlist.rbacDid`),
				manage(`${PDR}.badgeBlueKeys`),
			],
		},
		{
			id: "infra",
			label: "Declare infrastructure",
			scopes: [manage("computer.socialweb.infra"), manage("computer.socialweb.ephemeralInfra")],
		},
		{
			id: "atirc",
			label: "Mint atirc chat credentials",
			scopes: [`rpc:chat.atirc.mint?aud=${ATIRC_SERVICE}`, `rpc:chat.atirc.revoke?aud=${ATIRC_SERVICE}`],
		},
		{ id: "tangled", label: "Vouch on Tangled", scopes: [update("sh.tangled.graph.vouch")] },
	],
};
