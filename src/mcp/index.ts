import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  McpServerConfig,
  McpStdioServer,
  McpSseServer,
  McpStreamableHttpServer
} from '../types.js';
import { ToolWithSchema } from '../tools/tool_runner.js';

/**
 * Fetches tools from an MCP client and returns them as ToolWithSchema.
 * Mirrors google.antigravity.mcp.bridge.get_mcp_tools().
 */
export async function getMcpTools(client: Client): Promise<ToolWithSchema[]> {
  const response = await client.listTools();
  const tools: ToolWithSchema[] = [];
  for (const tool of response.tools) {
    const wrapper = new ToolWithSchema(
      async (args: any) => {
        const res = await client.callTool({ name: tool.name, arguments: args });
        if (res.isError) {
          throw new Error(`MCP Tool error: ${JSON.stringify(res.content)}`);
        }
        const content = res.content as any[];
        return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      },
      tool.inputSchema as Record<string, any>
    );
    Object.defineProperty(wrapper.fn, 'name', { value: tool.name });
    Object.defineProperty(wrapper, 'description', { value: tool.description || '', writable: true });
    tools.push(wrapper);
  }
  return tools;
}

/** Python alias */
export const get_mcp_tools = getMcpTools;

/**
 * Bridge between MCP services and the SDK ToolRunner.
 * Mirrors google.antigravity.mcp.bridge.McpBridge.
 */
export class McpBridge {
  private clients: Client[] = [];

  get tools(): ToolWithSchema[] {
    return [...this.registeredTools];
  }

  private registeredTools: ToolWithSchema[] = [];

  async connect(serverCfg: McpServerConfig): Promise<void> {
    if ((serverCfg as McpStdioServer).command || (serverCfg as any).type === 'stdio') {
      const cfg = serverCfg as McpStdioServer;
      await this.connectStdio(cfg.command, cfg.args);
    } else if ((serverCfg as McpSseServer).url && (serverCfg as any).type === 'sse') {
      const cfg = serverCfg as McpSseServer;
      await this.connectSse(cfg.url, cfg.headers);
    } else if ((serverCfg as McpStreamableHttpServer).url || (serverCfg as any).type === 'http') {
      const cfg = serverCfg as McpStreamableHttpServer;
      await this.connectStreamableHttp(cfg.url, cfg.headers, cfg.timeout, cfg.sseReadTimeout, cfg.terminateOnClose);
    } else if ((serverCfg as any).command) {
      await this.connectStdio((serverCfg as any).command, (serverCfg as any).args || []);
    } else if ((serverCfg as any).url) {
      await this.connectSse((serverCfg as any).url, (serverCfg as any).headers);
    } else {
      throw new Error(`Unsupported MCP server config: ${JSON.stringify(serverCfg)}`);
    }
  }

  async connectStdio(command: string, args: string[] = []): Promise<void> {
    const transport = new StdioClientTransport({ command, args });
    await this.connectTransport(transport);
  }

  async connectSse(url: string, headers?: Record<string, string>): Promise<void> {
    const transport = new SSEClientTransport(new URL(url), {
      eventSourceInit: headers ? { headers } as any : undefined
    });
    await this.connectTransport(transport);
  }

  async connectStreamableHttp(
    url: string,
    headers?: Record<string, string>,
    timeout = 30,
    sseReadTimeout = 300,
    terminateOnClose = true
  ): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: headers ? { headers } : undefined,
      reconnectionOptions: {
        maxReconnectionDelay: sseReadTimeout * 1000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 2
      }
    });
    await this.connectTransport(transport);
  }

  private async connectTransport(transport: any): Promise<void> {
    const client = new Client({ name: 'antigravity-ts-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    this.clients.push(client);

    const tools = await getMcpTools(client);
    this.registeredTools.push(...tools);
  }

  /** Tools discovered from all connected MCP servers */
  get discoveredTools(): ToolWithSchema[] {
    return [...this.registeredTools];
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
    this.clients = [];
    this.registeredTools = [];
  }
}

/** @deprecated Use McpBridge */
export class McpClientManager extends McpBridge {
  async connectServer(config: McpServerConfig) {
    await this.connect(config);
    return this.discoveredTools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      execute: (args: any) => t.call(args)
    }));
  }

  async closeAll() {
    await this.stop();
  }
}

export type { ToolWithSchema as McpTool };
