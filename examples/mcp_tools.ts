import { Agent, LocalAgentConfig, McpStdioServer } from '../src/index.js';

async function main() {
  // Let's use a standard lightweight stdio MCP server for demonstration,
  // or a mock configuration. In this demo we configure a Stdio MCP server
  // that runs an echo-like command or a dummy node script.
  // We'll configure a stdio client running node to simulate an MCP server,
  // or a mock config.
  const mcpServer = new McpStdioServer('node', [
    '-e',
    // Minimal mock MCP Server in standard JS Stdio protocol
    `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      const request = JSON.parse(line);
      if (request.method === "initialize") {
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "mock-server", version: "1.0.0" }
          }
        }));
      } else if (request.method === "tools/list") {
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [{
              name: "fetch_mcp_system_info",
              description: "Fetches system status information from the MCP server.",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      } else if (request.method === "tools/call") {
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: "System Status: MCP Stdio Server Connected & Healthy." }]
          }
        }));
      }
    });
    `
  ]);

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: 'You are an IT support assistant. Use the fetch_mcp_system_info tool to check status.',
    mcpServers: [mcpServer]
  });

  console.log('Connecting to Mock MCP Server...');
  await using agent = await Agent.open(config);

  const prompt = 'Check the MCP system status and report back.';
  console.log(`\nUser: ${prompt}`);

  const response = await agent.chat(prompt);

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();
}

main().catch(err => {
  console.error('Error:', err);
});
