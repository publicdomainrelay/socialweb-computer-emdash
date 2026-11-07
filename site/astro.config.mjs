import node from "@astrojs/node";
import react from "@astrojs/react";
import { atproto } from "@emdash-cms/auth-atproto";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import atprotoIntegrations from "atproto-integrations-emdash";

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
			authProviders: [atproto({ allowedHandles: ["*"] })],
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [atprotoIntegrations],
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
