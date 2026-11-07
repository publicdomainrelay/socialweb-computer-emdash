import { integrationRoutes } from "atproto-oauth-sandbox";
import type { SandboxedPlugin } from "emdash/plugin";
import { integration } from "./integration";
import { handleRequester } from "./requester";

const plugin: SandboxedPlugin = {
	routes: integrationRoutes(integration, handleRequester),
};

export default plugin;
