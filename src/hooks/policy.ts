import { ToolCall, HookResult } from '../types.js';
import * as path from 'path';

export type Predicate = (args?: any, toolCall?: ToolCall) => boolean | Promise<boolean>;
export type AskUserHandler = (toolCall: ToolCall) => boolean | Promise<boolean>;

export enum Decision {
  APPROVE = 'APPROVE',
  DENY = 'DENY',
  ASK_USER = 'ASK_USER'
}

export interface Policy {
  tool: string;
  decision: Decision;
  when?: Predicate;
  askUser?: AskUserHandler;
  name?: string;
}

// Priority buckets indices
const LEVEL_SPECIFIC_DENY = 0;
const LEVEL_SPECIFIC_ASK = 1;
const LEVEL_SPECIFIC_ALLOW = 2;
const LEVEL_WILDCARD_DENY = 3;
const LEVEL_WILDCARD_ASK = 4;
const LEVEL_WILDCARD_ALLOW = 5;
const NUM_LEVELS = 6;

function getBucketIndex(p: Policy): number {
  const isWildcard = p.tool === '*';
  if (isWildcard) {
    if (p.decision === Decision.DENY) return LEVEL_WILDCARD_DENY;
    if (p.decision === Decision.ASK_USER) return LEVEL_WILDCARD_ASK;
    return LEVEL_WILDCARD_ALLOW;
  } else {
    if (p.decision === Decision.DENY) return LEVEL_SPECIFIC_DENY;
    if (p.decision === Decision.ASK_USER) return LEVEL_SPECIFIC_ASK;
    return LEVEL_SPECIFIC_ALLOW;
  }
}

export function allow(tool: string, options?: { when?: Predicate; name?: string }): Policy {
  return {
    tool,
    decision: Decision.APPROVE,
    when: options?.when,
    name: options?.name || ''
  };
}

export function deny(tool: string, options?: { when?: Predicate; name?: string }): Policy {
  return {
    tool,
    decision: Decision.DENY,
    when: options?.when,
    name: options?.name || ''
  };
}

export function ask_user(tool: string, options: { handler: AskUserHandler; when?: Predicate; name?: string }): Policy {
  return {
    tool,
    decision: Decision.ASK_USER,
    askUser: options.handler,
    when: options.when,
    name: options.name || ''
  };
}

// CamelCase aliases
export const askUser = ask_user;

export function allow_all(): Policy {
  return allow('*', { name: 'allow_all' });
}
export const allowAll = allow_all;

export function deny_all(): Policy {
  return deny('*', { name: 'deny_all' });
}
export const denyAll = deny_all;

export function safe_defaults(handler: (toolCall: ToolCall) => boolean | Promise<boolean>): Policy[] {
  // Read-only tools allowed by default: list_directory, search_directory, find_file, view_file, finish
  const readOnly = ['list_directory', 'search_directory', 'find_file', 'view_file', 'finish'];
  return [
    ...readOnly.map(t => allow(t)),
    ask_user('*', { handler })
  ];
}
export const safeDefaults = safe_defaults;

export function confirm_run_command(handler?: (toolCall: ToolCall) => boolean | Promise<boolean>): Policy[] {
  if (handler) {
    return [
      ask_user('run_command', { handler, name: 'confirm_run_command' }),
      allow('*', { name: 'confirm_run_command' })
    ];
  }
  return [
    deny('run_command', { name: 'confirm_run_command' }),
    allow('*', { name: 'confirm_run_command' })
  ];
}
export const confirmRunCommand = confirm_run_command;

export function workspace_only(workspaces: string[]): Policy[] {
  const absWorkspaces = workspaces.map(w => path.resolve(w));
  const fileTools = ['view_file', 'create_file', 'edit_file'];

  const outsideWorkspace = (args: any, toolCall?: ToolCall) => {
    const targetPath = toolCall?.canonicalPath || toolCall?.canonical_path ||
      args?.TargetFile || args?.path || args?.file_path || args?.directory_path;
    if (!targetPath) return false;
    const absPath = path.resolve(targetPath);
    return !absWorkspaces.some(ws => absPath === ws || absPath.startsWith(ws + path.sep));
  };

  return fileTools.map(tool => deny(tool, {
    when: (args) => outsideWorkspace(args),
    name: 'workspace_only'
  }));
}
export const workspaceOnly = workspace_only;

/**
 * Enforcer class that pre-sorts and executes policy checks.
 */
export class PolicyEnforcer {
  private buckets: Policy[][] = Array.from({ length: NUM_LEVELS }, () => []);

  constructor(policies: Policy[]) {
    for (const p of policies) {
      if (p.decision === Decision.ASK_USER && !p.askUser) {
        throw new Error(`ASK_USER policy for '${p.name || p.tool}' is missing a handler.`);
      }
      this.buckets[getBucketIndex(p)].push(p);
    }
  }

  async evaluate(toolCall: ToolCall): Promise<{ action: 'allow' | 'deny' | 'ask'; handler?: Function; reason?: string }> {
    const name = toolCall.name;
    const args = toolCall.args;

    for (const bucket of this.buckets) {
      for (const p of bucket) {
        if (p.tool !== '*' && p.tool !== name) {
          continue;
        }

        if (p.when) {
          try {
            const matches = await p.when(args, toolCall);
            if (!matches) continue;
          } catch (err) {
            console.error(`Error evaluating policy predicate for ${p.name || p.tool}:`, err);
            return {
              action: 'deny',
              reason: `Policy evaluation error on '${p.name || p.tool}': ${err}`
            };
          }
        }

        // First match in bucket wins
        const label = p.name || p.tool;
        if (p.decision === Decision.DENY) {
          return {
            action: 'deny',
            reason: `Denied by policy '${label}'`
          };
        }
        if (p.decision === Decision.APPROVE) {
          return { action: 'allow' };
        }
        if (p.decision === Decision.ASK_USER) {
          return {
            action: 'ask',
            handler: p.askUser
          };
        }
      }
    }

    return { action: 'allow' };
  }
}

/**
 * PreToolCallDecideHook that enforces a set of policies.
 * Mirrors google.antigravity.hooks.policy._PolicyDecideHook.
 */
export class PolicyDecideHook {
  readonly __isPolicyDecideHook = true;

  constructor(private enforcer: PolicyEnforcer) {}

  async run(_context: any, toolCall: ToolCall): Promise<import('../types.js').HookResult> {
    const decision = await this.enforcer.evaluate(toolCall);
    if (decision.action === 'deny') {
      return { allow: false, message: decision.reason || 'Denied by policy.' };
    }
    if (decision.action === 'ask') {
      const approved = decision.handler ? await decision.handler(toolCall) : false;
      return approved
        ? { allow: true }
        : { allow: false, message: `User denied tool '${toolCall.name}'.` };
    }
    return { allow: true };
  }
}

export function isPolicyDecideHook(hook: any): hook is PolicyDecideHook {
  return hook instanceof PolicyDecideHook || hook?.__isPolicyDecideHook === true;
}

/** Creates a PreToolCallDecideHook from policies (Python policy.enforce). */
export function enforce(policies: Policy[]): PolicyDecideHook {
  return new PolicyDecideHook(new PolicyEnforcer(policies));
}

/** @deprecated Alias for enforce() — returns a hook, not an enforcer. */
export function enforceHook(policies: Policy[]): PolicyDecideHook {
  return enforce(policies);
}

/**
 * Legacy/compatibility function matching original evaluation interface
 */
export async function evaluatePolicies(
  policies: Policy[] | PolicyEnforcer,
  toolCall: { name: string; args: any }
): Promise<{ action: 'allow' | 'deny' | 'ask'; reason?: string; handler?: Function }> {
  const enforcer = policies instanceof PolicyEnforcer ? policies : new PolicyEnforcer(policies);
  return await enforcer.evaluate(toolCall);
}
