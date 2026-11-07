export const guides = [
	{
		href: "/how-it-works",
		title: "How it works",
		blurb: "Records become OAuth clients, modules run in isolates, and tokens never leave the plugin.",
	},
	{
		href: "/use",
		title: "Use it",
		blurb: "Sign in, publish an integration record, connect it, and run a module from the page or your terminal.",
	},
	{
		href: "/modules",
		title: "Write a module",
		blurb: "A Rust crate with a JSON ABI. It plans XRPC calls and the plugin makes them.",
	},
	{
		href: "/deploy",
		title: "Deploy your own",
		blurb: "Run the site on your machine or on Cloudflare Workers with D1, R2 and Worker Loader.",
	},
] as const;
