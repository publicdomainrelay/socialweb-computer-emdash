import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import atprotoIntegrations from "atproto-integrations-emdash";
import { atprotoSubscriber } from "@publicdomainrelay/auth-atproto-subscriber";

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
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
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			authProviders: [atprotoSubscriber({ allowAnyAccount: true })],
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [atprotoIntegrations],
		}),
	],
	devToolbar: { enabled: false },
});
