import {
  HookResult,
  ToolCall,
  ToolResult,
  AskQuestionInteractionSpec,
  QuestionHookResult
} from '../types.js';
import {
  HookContext,
  SessionContext,
  TurnContext,
  OperationContext
} from './hook_runner.js';
import type { PreToolCallDecideHook, HookKind } from './hook_runner.js';

export { HookContext, SessionContext, TurnContext, OperationContext };
export type { HookKind };

/** Read-only, non-blocking hook for observability (Python InspectHook). */
export abstract class InspectHook<T> {
  abstract run(context: HookContext, data: T): Promise<void>;
}

/** Read-only, blocking hook for policy decisions (Python DecideHook). */
export abstract class DecideHook<T> {
  abstract run(context: HookContext, data: T): Promise<HookResult>;
}

/** Modifying, blocking hook for data transformation (Python TransformHook). */
export abstract class TransformHook<T, R> {
  abstract run(context: HookContext, data: T): Promise<R>;
}

export type Hook = InspectHook<any> | DecideHook<any> | TransformHook<any, any>;

export type HookLikeMarked<K extends HookKind = HookKind> = {
  hookKind: K;
  run(context: HookContext, data: any): Promise<any>;
  originalFn: Function;
};

function makeHookDecorator<K extends HookKind>(kind: K, passData: boolean) {
  return function decorator<F extends Function>(fn: F): HookLikeMarked<K> {
    const hook: any = {
      hookKind: kind,
      originalFn: fn,
      async run(context: HookContext, data: any) {
        if (passData) {
          return await fn(data);
        }
        return await fn();
      }
    };

    switch (kind) {
      case 'preTurn':
        hook.preTurn = async (ctx: TurnContext, data: any) => hook.run(ctx, data);
        break;
      case 'postTurn':
        hook.postTurn = async (ctx: TurnContext, data: string) => hook.run(ctx, data);
        break;
      case 'preToolCallDecide':
        hook.preToolCallDecide = async (ctx: OperationContext, data: ToolCall) => hook.run(ctx, data);
        break;
      case 'postToolCall':
        hook.postToolCall = async (ctx: OperationContext, data: ToolResult | any) => hook.run(ctx, data);
        break;
      case 'onToolError':
        hook.onToolError = async (ctx: OperationContext, data: Error) => hook.run(ctx, data);
        break;
      case 'onInteraction':
        hook.onInteraction = async (ctx: OperationContext, data: AskQuestionInteractionSpec) => hook.run(ctx, data);
        break;
      case 'onCompaction':
        hook.onCompaction = async (ctx: OperationContext, data: any) => hook.run(ctx, data);
        break;
      case 'onSessionStart':
        hook.onSessionStart = async (ctx: SessionContext) => hook.run(ctx, null);
        break;
      case 'onSessionEnd':
        hook.onSessionEnd = async (ctx: SessionContext) => hook.run(ctx, null);
        break;
    }

    return hook as HookLikeMarked<K>;
  };
}

/** Decorators matching Python hooks.pre_turn, etc. Wrapped fn receives `data` only (not context). */
export const pre_turn = makeHookDecorator('preTurn', true);
export const preTurn = pre_turn;
export const pre_tool_call_decide = makeHookDecorator('preToolCallDecide', true);
export const preToolCallDecide = pre_tool_call_decide;
export const on_interaction = makeHookDecorator('onInteraction', true);
export const onInteraction = on_interaction;
export const on_compaction = makeHookDecorator('onCompaction', true);
export const onCompaction = on_compaction;
export const on_session_start = makeHookDecorator('onSessionStart', false);
export const onSessionStart = on_session_start;
export const on_session_end = makeHookDecorator('onSessionEnd', false);
export const onSessionEnd = on_session_end;
export const post_turn = makeHookDecorator('postTurn', true);
export const postTurn = post_turn;
export const post_tool_call = makeHookDecorator('postToolCall', true);
export const postToolCall = post_tool_call;
export const on_tool_error = makeHookDecorator('onToolError', true);
export const onToolError = on_tool_error;

// Hook type interfaces (mirrors Python hooks.py)
export interface OnSessionStartHook {
  run(context: SessionContext, data: null): Promise<void>;
}
export interface OnSessionEndHook {
  run(context: SessionContext, data: null): Promise<void>;
}
export interface PreTurnHook {
  run(context: TurnContext, data: any): Promise<HookResult>;
}
export interface PostTurnHook {
  run(context: TurnContext, data: string): Promise<void>;
}
export interface PreToolCallDecideHookType {
  run(context: OperationContext, data: ToolCall): Promise<HookResult>;
}
export interface PostToolCallHook {
  run(context: OperationContext, data: ToolResult | any): Promise<void>;
}
export interface OnToolErrorHook {
  run(context: OperationContext, data: Error): Promise<any>;
}
export interface OnInteractionHook {
  run(context: OperationContext, data: AskQuestionInteractionSpec): Promise<QuestionHookResult>;
}
export interface OnCompactionHook {
  run(context: OperationContext, data: any): Promise<void>;
}

export type { PreToolCallDecideHook };
