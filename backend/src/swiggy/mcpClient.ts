import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logger } from "../logger.js";

export const swiggyServers = ["food", "im", "dineout", "scenes"] as const;
export type SwiggyServer = (typeof swiggyServers)[number];

/** The one operation the rest of the app needs from MCP: call a tool and get the raw result. */
export interface ToolTransport {
  callTool(server: SwiggyServer, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

/** Keeps one connected MCP client per Swiggy server and reconnects on demand. */
export class McpClientManager implements ToolTransport {
  private clients = new Map<SwiggyServer, Promise<Client>>();

  constructor(
    private readonly opts: {
      urls: Record<SwiggyServer, string>;
      authProvider: OAuthClientProvider;
      fetch?: FetchLike;
      requestTimeoutMs?: number;
    },
  ) {}

  private connect(server: SwiggyServer): Promise<Client> {
    let pending = this.clients.get(server);
    if (!pending) {
      pending = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(this.opts.urls[server]), {
          authProvider: this.opts.authProvider,
          ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        });
        const client = new Client({ name: "cook-or-click", version: "1.0.0" });
        await client.connect(transport);
        logger.info({ server }, "Connected to Swiggy MCP");
        return client;
      })();
      // A failed connection must not be cached, or every later call would fail too.
      pending.catch(() => this.clients.delete(server));
      this.clients.set(server, pending);
    }
    return pending;
  }

  async callTool(server: SwiggyServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.connect(server);
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: this.opts.requestTimeoutMs ?? 30_000,
    });
    return result as CallToolResult;
  }

  /** Lists tools with their input schemas. Used by the debug route to check argument shapes. */
  async listTools(server: SwiggyServer): Promise<Array<{ name: string; inputSchema: unknown }>> {
    const client = await this.connect(server);
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
  }

  /** Drops cached connections, e.g. after login or logout. */
  async reset(): Promise<void> {
    const pending = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(pending.map((p) => p.then((c) => c.close()).catch(() => undefined)));
  }
}
