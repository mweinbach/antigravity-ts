import * as readline from 'readline';
import { z } from 'zod';
import { defineTool } from '../registry.js';

export const askQuestion = defineTool({
  name: 'ask_question',
  description: 'Asks the user one or more multiple-choice questions or opens a text input prompt.',
  parameters: z.object({
    question: z.string().describe('The question or prompt to display to the user.'),
    options: z.array(z.string()).optional().describe('A list of selectable options (optional).'),
    isMultiSelect: z.boolean().optional().describe('If true, the user can select multiple options.')
  }),
  execute: async ({ question, options, isMultiSelect }, ctx) => {
    // 1. Check if the agent has an onInteraction hook registered and delegate
    if (ctx.getState('agent')) {
      const agent = ctx.getState('agent');
      const hookResults = await agent.runHooks('onInteraction', { question, options, isMultiSelect });
      // Find first non-empty hook result
      for (const res of hookResults) {
        if (res && res.responses) {
          return res.responses;
        }
      }
    }

    // 2. Default terminal interaction fallback
    console.log(`\n💬 Question: ${question}`);
    if (options && options.length > 0) {
      options.forEach((opt, idx) => {
        console.log(`  ${idx + 1}. ${opt}`);
      });
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      const promptText = options && options.length > 0
        ? (isMultiSelect ? 'Select options (comma separated, e.g. 1,3): ' : 'Select option number: ')
        : 'Your answer: ';

      rl.question(promptText, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });

    if (options && options.length > 0) {
      if (isMultiSelect) {
        const selections = answer.split(',')
          .map(s => parseInt(s.trim(), 10) - 1)
          .filter(idx => idx >= 0 && idx < options.length)
          .map(idx => options[idx]);
        return { responses: selections };
      } else {
        const idx = parseInt(answer, 10) - 1;
        if (idx >= 0 && idx < options.length) {
          return { responses: [options[idx]] };
        }
      }
    }

    return { responses: [answer] };
  }
});
