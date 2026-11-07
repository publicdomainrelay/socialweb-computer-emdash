export const guides = [
	{
		href: "/how-it-works",
		title: "How it works",
		blurb: "Records become OAuth clients, modules run in isolates, and tokens never leave the plugin.",
	},
	{
		href: "/use",
		title: "Use it",
		blurb: "Sign in, add the examples or your own records, connect them, and run modules from the page or your terminal.",
	},
	{
		href: "/modules",
		title: "Write a module",
		blurb: "Rust or AssemblyScript with a JSON ABI. It plans XRPC calls, the plugin makes them, and its source is published beside it.",
	},
	{
		href: "/lexicons",
		title: "Lexicons",
		blurb: "The five com.fedfork.exec schemas, field by field, and how the site uses each one.",
	},
	{
		href: "/deploy",
		title: "Deploy your own",
		blurb: "Run the site on your machine or on Cloudflare Workers with D1, R2 and Worker Loader.",
	},
] as const;
