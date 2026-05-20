import { z } from 'zod';
import { defineTool } from '../registry.js';
import { Agent } from '../../agent.js';
import { LocalAgentConfig } from '../../config.js';

export const startSubagent = defineTool({
  name: 'start_subagent',
  description: 'Spawns a new subagent to delegate a complex task in a separate context.',
  parameters: z.object({
    prompt: z.string().describe('The task instruction for the subagent.'),
    role: z.string().describe('The role or persona of the subagent (e.g. "Researcher", "Tester").'),
    typeName: z.string().optional().describe('The model name or type to use (defaults to parent model).')
  }),
  execute: async ({ prompt, role, typeName }, ctx) => {
    const parentAgent = ctx.getState('agent') as Agent | undefined;
    if (!parentAgent) {
      throw new Error('Subagent execution failed: Parent agent context is missing.');
    }

    // Clone configuration from parent agent
    const parentConfig = parentAgent.config;
    
    // Build subagent instructions combining role and parent custom instructions
    const subagentInstructions = `You are a subagent working on behalf of a parent agent.
Your designated role is: ${role}.
Your task is: ${prompt}.
Please accomplish the task and return the results.`;

    const subagentConfig = new LocalAgentConfig({
      model: typeName || parentConfig.model,
      apiKey: parentConfig.apiKey,
      appDataDir: parentConfig.appDataDir,
      systemInstructions: subagentInstructions,
      // Don't inherit triggers to avoid infinite loops, but inherit basic tools and capabilities
      capabilities: parentConfig.capabilities,
      tools: parentConfig.tools,
      policies: parentConfig.policies
    });

    // Spawn subagent
    const subagent = new Agent(subagentConfig);
    
    try {
      await subagent.start();
      const responseStream = await subagent.chat(prompt);
      const text = await responseStream.text();
      return {
        status: 'completed',
        role,
        output: text,
        usage: subagent.conversation.totalUsage
      };
    } finally {
      await subagent.stop();
    }
  }
});
