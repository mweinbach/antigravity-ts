export * from './policy.js';
export * from './hook_runner.js';
export * from './hooks.js';

import { AgentHookContext } from '../agent.js';
import { HookResult, ToolCall, AskQuestionInteractionSpec, QuestionHookResult } from '../types.js';

/**
 * Flat hook object interface (alternative to Python-style decorators).
 */
export interface Hook {
  onSessionStart?(ctx: AgentHookContext): Promise<void> | void;
  onSessionEnd?(ctx: AgentHookContext): Promise<void> | void;
  preTurn?(ctx: AgentHookContext, prompt: string): Promise<HookResult | void> | HookResult | void;
  postTurn?(ctx: AgentHookContext, responseText: string): Promise<void> | void;
  preToolCallDecide?(ctx: AgentHookContext, toolCall: ToolCall): Promise<HookResult | void> | HookResult | void;
  postToolCall?(ctx: AgentHookContext, result: any): Promise<void> | void;
  onToolError?(ctx: AgentHookContext, error: any): Promise<any | void> | any | void;
  onInteraction?(ctx: AgentHookContext, spec: AskQuestionInteractionSpec): Promise<QuestionHookResult | void> | QuestionHookResult | void;
  onCompaction?(ctx: AgentHookContext, data: any): Promise<void> | void;
}

export function createHook(hooks: Hook): Hook {
  return hooks;
}

// Re-export policy submodule (Python: from google.antigravity.hooks import policy)
export * as policy from './policy.js';
