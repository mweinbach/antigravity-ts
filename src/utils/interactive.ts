import * as readline from 'readline';
import { Agent } from '../agent.js';
import { ToolCall, AskQuestionInteractionSpec, QuestionHookResult, HookResult } from '../types.js';
import { Hook } from '../hooks/index.js';
import { AgentHookContext } from '../agent.js';
import { Policy, Decision, ask_user, enforce, isPolicyDecideHook } from '../hooks/policy.js';

export async function asyncInput(prompt: string = ''): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise<string>((resolve, reject) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });

    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('Interrupted'));
    });
  });
}

export const async_input = asyncInput;

export class ToolConfirmationHook implements Hook {
  async preToolCallDecide(ctx: AgentHookContext, data: ToolCall): Promise<HookResult> {
    console.log(`\nTool execution requested: ${data.name}`);
    if (data.args) {
      console.log(`Arguments: ${JSON.stringify(data.args, null, 2)}`);
    }

    try {
      const ans = await asyncInput('Allow execution? (y/n) [n]: ');
      if (ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes') {
        return { allow: true };
      }
    } catch {
      // Interrupted or closed
    }

    return { allow: false, message: 'User denied tool call.' };
  }
}

export async function askUserHandler(tc: ToolCall): Promise<boolean> {
  console.log(`\nPolicy check: Tool execution requested: ${tc.name}`);
  if (tc.args) {
    console.log(`Arguments: ${JSON.stringify(tc.args, null, 2)}`);
  }

  try {
    const ans = await asyncInput('Allow execution? (y/n) [n]: ');
    return ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes';
  } catch {
    return false;
  }
}

/** Python alias */
export const ask_user_handler = askUserHandler;

export class AskQuestionHook implements Hook {
  async onInteraction(ctx: AgentHookContext, data: AskQuestionInteractionSpec): Promise<QuestionHookResult> {
    const questions = data.questions || [];
    const responses: any[] = [];

    try {
      for (const q of questions) {
        console.log(`\nQuestion: ${q.question}`);
        const options = q.options || [];
        options.forEach((opt, idx) => {
          console.log(`  ${idx + 1}. ${opt.text}`);
        });

        const ans = (await asyncInput('Response: ')).trim();
        if (!ans) {
          responses.push({ skipped: true });
          continue;
        }

        // Try to match by option number
        let matchedId: string | null = null;
        if (options.length > 0) {
          const selectedIdx = parseInt(ans) - 1;
          if (!isNaN(selectedIdx) && selectedIdx >= 0 && selectedIdx < options.length) {
            matchedId = options[selectedIdx].id;
          }

          if (!matchedId) {
            for (const opt of options) {
              if (
                ans.toLowerCase() === opt.text.toLowerCase() ||
                ans.toLowerCase() === opt.id.toLowerCase()
              ) {
                matchedId = opt.id;
                break;
              }
            }
          }
        }

        if (matchedId) {
          responses.push({ selectedOptionIds: [matchedId] });
        } else {
          responses.push({ freeformResponse: ans });
        }
      }
    } catch {
      return { responses, cancelled: true };
    }

    return { responses };
  }
}

export function upgradeToInteractiveConfirmation(agent: Agent): void {
  const config = (agent as any).config;
  if (!config || !config.policies) {
    return;
  }

  const upgraded: Policy[] = [];
  for (const p of config.policies) {
    if (
      p &&
      p.tool === 'run_command' &&
      p.decision === Decision.DENY &&
      !p.when
    ) {
      // Replace with ask_user
      upgraded.push(
        ask_user('run_command', {
          handler: askUserHandler,
          name: p.name || 'interactive_confirm'
        })
      );
    } else {
      upgraded.push(p);
    }
  }

  config.policies = upgraded;

  // Replace the existing policy-enforce hook in-place so the old deny hook
  // doesn't fire first and short-circuit (Python parity).
  const newHook = enforce(upgraded);
  if (!agent.hookRunner) {
    throw new Error('Agent must be started before upgrading policies.');
  }
  agent.hookRunner.replacePolicyEnforceHook(newHook, isPolicyDecideHook);
}

/** Python alias */
export const _upgrade_to_interactive_confirmation = upgradeToInteractiveConfirmation;

export async function runInteractiveLoop(agent: Agent): Promise<void> {
  if (!agent.isStarted) {
    throw new Error('Agent session not started. Call await agent.start() first.');
  }

  // Register interactive hooks
  agent.registerHook(new AskQuestionHook());
  upgradeToInteractiveConfirmation(agent);

  console.log('Starting interactive loop. Type "exit" or "quit" to end.');
  while (true) {
    try {
      const userRaw = await asyncInput('User: ');
      const userInput = userRaw.trim();
      if (!userInput) continue;

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        break;
      }

      await agent.conversation.send(userInput);

      for await (const step of agent.conversation.receiveSteps()) {
        if (step.isCompleteResponse) {
          console.log(`Agent: ${step.content}`);
        }
      }
    } catch (err: any) {
      if (err.message === 'Interrupted') {
        console.log('\nGoodbye!');
        break;
      }
      console.error('Error during interaction:', err);
    }
  }
}

export const run_interactive_loop = runInteractiveLoop;
