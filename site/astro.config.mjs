import node from "@astrojs/node";
import react from "@astrojs/react";
import { atproto } from "@emdash-cms/auth-atproto";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import socialwebComputerRequester from "socialweb-computer-requester-emdash";
import statusphere from "statusphere-emdash";

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	server: {
		host: "127.0.0.1",
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
			authProviders: [atproto()],
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [statusphere, socialwebComputerRequester],
		}),
	],
	devToolbar: { enabled: false },
});
