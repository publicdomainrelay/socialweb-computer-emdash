import type { APIRoute } from "astro";
import { examplesBundle } from "../../studio/examples";

export const prerender = true;

export const GET: APIRoute = async () => Response.json(await examplesBundle());
