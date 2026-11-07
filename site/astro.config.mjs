import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { atprotoSubscriber } from "@publicdomainrelay/auth-atproto-subscriber";
import atprotoIntegrations from "atproto-integrations-emdash";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

const onCloudflare = process.env.EMDASH_TARGET === "cloudflare";

const platform = onCloudflare
	? {
			adapter: cloudflare({ configPath: "../wrangler.jsonc" }),
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			sandboxRunner: sandbox(),
		}
	: {
			adapter: node({ mode: "standalone" }),
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
		};

export default defineConfig({
	output: "server",
	adapter: platform.adapter,
	server: {
		host: "127.0.0.1",
		allowedHosts: [".fedproxy.com"],
	},
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: platform.database,
			storage: platform.storage,
			authProviders: [atprotoSubscriber({ allowAnyAccount: true })],
			sandboxRunner: platform.sandboxRunner,
			sandboxLimits: { cpuMs: 1000, subrequests: 200 },
			sandboxed: [atprotoIntegrations],
		}),
	],
	devToolbar: { enabled: false },
});
