import { z } from 'zod';
import { Agent, LocalAgentConfig, defineTool } from '../src/index.js';

// Define a custom tool with Zod schema parameters
const getTemperature = defineTool({
  name: 'get_current_temperature',
  description: 'Gets the current temperature for a given location.',
  parameters: z.object({
    location: z.string().describe('The city and state, e.g. San Francisco, CA')
  }),
  execute: async ({ location }) => {
    console.log(`\n[Tool Executing] get_current_temperature for "${location}"`);
    // Mock temperature values
    const tempMap: Record<string, string> = {
      'san francisco, ca': '62°F',
      'new york, ny': '75°F',
      'london, uk': '58°F',
      'tokyo, japan': '68°F'
    };
    const key = location.toLowerCase();
    return tempMap[key] || '72°F (default)';
  }
});

async function main() {
  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: 'You are a weather assistant. Use tools to find temperature.',
    tools: [getTemperature]
  });

  await using agent = await Agent.open(config);

  const prompt = 'What is the temperature in San Francisco, CA right now?';
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
