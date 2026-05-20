import {
  HookResult,
  ToolCall,
  ToolResult,
  AskQuestionInteractionSpec,
  QuestionHookResult
} from '../types.js';

export type HookKind =
  | 'onSessionStart'
  | 'onSessionEnd'
  | 'preTurn'
  | 'postTurn'
  | 'preToolCallDecide'
  | 'postToolCall'
  | 'onToolError'
  | 'onInteraction'
  | 'onCompaction';

export class HookContext {
  parent: HookContext | null;
  private store: Record<string, any> = {};

  constructor(parent: HookContext | null = null) {
    this.parent = parent;
  }

  get(key: string, defaultValue?: any): any {
    if (key in this.store) return this.store[key];
    if (this.parent) return this.parent.get(key, defaultValue);
    return defaultValue;
  }

  set(key: string, value: any): void {
    this.store[key] = value;
  }
}

export class SessionContext extends HookContext {
  constructor() {
    super(null);
  }
}

export class TurnContext extends HookContext {
  constructor(sessionContext: SessionContext) {
    super(sessionContext);
  }
}

export class OperationContext extends HookContext {
  constructor(turnContext: TurnContext) {
    super(turnContext);
  }
}

export interface PreToolCallDecideHook {
  run(context: OperationContext, data: ToolCall): Promise<HookResult>;
}

export interface HookLike {
  hookKind?: HookKind;
  onSessionStart?(context: SessionContext, data?: null): Promise<void>;
  onSessionEnd?(context: SessionContext, data?: null): Promise<void>;
  preTurn?(context: TurnContext, data: any): Promise<HookResult | void>;
  postTurn?(context: TurnContext, data: string): Promise<void>;
  preToolCallDecide?(context: OperationContext, data: ToolCall): Promise<HookResult>;
  postToolCall?(context: OperationContext, data: ToolResult | any): Promise<void>;
  onToolError?(context: OperationContext, data: Error): Promise<any>;
  onInteraction?(context: OperationContext, data: AskQuestionInteractionSpec): Promise<QuestionHookResult | void>;
  onCompaction?(context: OperationContext, data: any): Promise<void>;
  run?(context: HookContext, data: any): Promise<any>;
}

type RunnableHook = { run(context: HookContext, data: any): Promise<any> };

/**
 * Manages registration and dispatch of Antigravity SDK hooks.
 * Mirrors google.antigravity.hooks.hook_runner.HookRunner.
 */
export class HookRunner {
  private _onSessionStartHooks: RunnableHook[] = [];
  private _onSessionEndHooks: RunnableHook[] = [];
  private _preTurnHooks: RunnableHook[] = [];
  private _postTurnHooks: RunnableHook[] = [];
  private _preToolCallDecideHooks: PreToolCallDecideHook[] = [];
  private _postToolCallHooks: RunnableHook[] = [];
  private _onToolErrorHooks: RunnableHook[] = [];
  private _onInteractionHooks: RunnableHook[] = [];
  private _onCompactionHooks: RunnableHook[] = [];

  sessionContext = new SessionContext();

  get hasHooks(): boolean {
    return (
      this._onSessionStartHooks.length > 0 ||
      this._onSessionEndHooks.length > 0 ||
      this._preTurnHooks.length > 0 ||
      this._postTurnHooks.length > 0 ||
      this._preToolCallDecideHooks.length > 0 ||
      this._postToolCallHooks.length > 0 ||
      this._onToolErrorHooks.length > 0 ||
      this._onInteractionHooks.length > 0 ||
      this._onCompactionHooks.length > 0
    );
  }

  get has_hooks(): boolean {
    return this.hasHooks;
  }

  get preToolCallDecideHookCount(): number {
    return this._preToolCallDecideHooks.length;
  }

  get onSessionStartHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._onSessionStartHooks]);
  }
  get on_session_start_hooks(): readonly RunnableHook[] {
    return this.onSessionStartHooks;
  }

  get onSessionEndHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._onSessionEndHooks]);
  }
  get on_session_end_hooks(): readonly RunnableHook[] {
    return this.onSessionEndHooks;
  }

  get preTurnHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._preTurnHooks]);
  }
  get pre_turn_hooks(): readonly RunnableHook[] {
    return this.preTurnHooks;
  }

  get postTurnHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._postTurnHooks]);
  }
  get post_turn_hooks(): readonly RunnableHook[] {
    return this.postTurnHooks;
  }

  get preToolCallDecideHooks(): readonly PreToolCallDecideHook[] {
    return Object.freeze([...this._preToolCallDecideHooks]);
  }
  get pre_tool_call_decide_hooks(): readonly PreToolCallDecideHook[] {
    return this.preToolCallDecideHooks;
  }

  /** @internal Exposed for interactive policy upgrade (Python `_pre_tool_call_decide_hooks`). */
  get _pre_tool_call_decide_hooks(): PreToolCallDecideHook[] {
    return this._preToolCallDecideHooks;
  }

  get postToolCallHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._postToolCallHooks]);
  }
  get post_tool_call_hooks(): readonly RunnableHook[] {
    return this.postToolCallHooks;
  }

  get onToolErrorHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._onToolErrorHooks]);
  }
  get on_tool_error_hooks(): readonly RunnableHook[] {
    return this.onToolErrorHooks;
  }

  get onInteractionHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._onInteractionHooks]);
  }
  get on_interaction_hooks(): readonly RunnableHook[] {
    return this.onInteractionHooks;
  }

  get onCompactionHooks(): readonly RunnableHook[] {
    return Object.freeze([...this._onCompactionHooks]);
  }
  get on_compaction_hooks(): readonly RunnableHook[] {
    return this.onCompactionHooks;
  }

  registerHook(hook: HookLike | PreToolCallDecideHook): void {
    if ((hook as HookLike).hookKind) {
      this.registerDecoratedHook(hook as HookLike);
      return;
    }

    if (typeof (hook as PreToolCallDecideHook).run === 'function' && !this.isFlatHook(hook as HookLike)) {
      this._preToolCallDecideHooks.push(hook as PreToolCallDecideHook);
      return;
    }

    const h = hook as HookLike;
    let registered = false;

    if (h.onSessionStart) {
      this._onSessionStartHooks.push({ run: (ctx) => h.onSessionStart!(ctx as SessionContext, null) });
      registered = true;
    }
    if (h.onSessionEnd) {
      this._onSessionEndHooks.push({ run: (ctx) => h.onSessionEnd!(ctx as SessionContext, null) });
      registered = true;
    }
    if (h.preTurn) {
      this._preTurnHooks.push({ run: (ctx, data) => h.preTurn!(ctx as TurnContext, data) });
      registered = true;
    }
    if (h.postTurn) {
      this._postTurnHooks.push({ run: (ctx, data) => h.postTurn!(ctx as TurnContext, data) });
      registered = true;
    }
    if (h.preToolCallDecide) {
      this._preToolCallDecideHooks.push({ run: (ctx, data) => h.preToolCallDecide!(ctx as OperationContext, data) });
      registered = true;
    }
    if (h.postToolCall) {
      this._postToolCallHooks.push({ run: (ctx, data) => h.postToolCall!(ctx as OperationContext, data) });
      registered = true;
    }
    if (h.onToolError) {
      this._onToolErrorHooks.push({ run: (ctx, data) => h.onToolError!(ctx as OperationContext, data) });
      registered = true;
    }
    if (h.onInteraction) {
      this._onInteractionHooks.push({ run: (ctx, data) => h.onInteraction!(ctx as OperationContext, data) });
      registered = true;
    }
    if (h.onCompaction) {
      this._onCompactionHooks.push({ run: (ctx, data) => h.onCompaction!(ctx as OperationContext, data) });
      registered = true;
    }

    if (!registered) {
      throw new Error(`Unknown hook type: ${typeof hook}`);
    }
  }

  register_hook(hook: HookLike | PreToolCallDecideHook): void {
    return this.registerHook(hook);
  }

  replacePolicyEnforceHook(newHook: PreToolCallDecideHook, isPolicyHook: (h: PreToolCallDecideHook) => boolean): boolean {
    for (let i = 0; i < this._preToolCallDecideHooks.length; i++) {
      if (isPolicyHook(this._preToolCallDecideHooks[i])) {
        this._preToolCallDecideHooks[i] = newHook;
        return true;
      }
    }
    this._preToolCallDecideHooks.push(newHook);
    return false;
  }

  private registerDecoratedHook(hook: HookLike): void {
    if (!hook.run) {
      throw new Error(`Decorated hook '${hook.hookKind}' is missing run().`);
    }
    const runnable = { run: hook.run.bind(hook) };
    switch (hook.hookKind) {
      case 'onSessionStart':
        this._onSessionStartHooks.push(runnable);
        return;
      case 'onSessionEnd':
        this._onSessionEndHooks.push(runnable);
        return;
      case 'preTurn':
        this._preTurnHooks.push(runnable);
        return;
      case 'postTurn':
        this._postTurnHooks.push(runnable);
        return;
      case 'preToolCallDecide':
        this._preToolCallDecideHooks.push(hook as PreToolCallDecideHook);
        return;
      case 'postToolCall':
        this._postToolCallHooks.push(runnable);
        return;
      case 'onToolError':
        this._onToolErrorHooks.push(runnable);
        return;
      case 'onInteraction':
        this._onInteractionHooks.push(runnable);
        return;
      case 'onCompaction':
        this._onCompactionHooks.push(runnable);
        return;
      default:
        throw new Error(`Unknown decorated hook kind: ${hook.hookKind}`);
    }
  }

  private isFlatHook(hook: HookLike): boolean {
    return !!(
      hook.onSessionStart ||
      hook.onSessionEnd ||
      hook.preTurn ||
      hook.postTurn ||
      hook.preToolCallDecide ||
      hook.postToolCall ||
      hook.onToolError ||
      hook.onInteraction ||
      hook.onCompaction
    );
  }

  async dispatchSessionStart(): Promise<void> {
    for (const hook of this._onSessionStartHooks) {
      await hook.run(this.sessionContext, null);
    }
  }

  async dispatch_session_start(): Promise<void> {
    return this.dispatchSessionStart();
  }

  async dispatchSessionEnd(): Promise<void> {
    for (const hook of this._onSessionEndHooks) {
      await hook.run(this.sessionContext, null);
    }
  }

  async dispatch_session_end(): Promise<void> {
    return this.dispatchSessionEnd();
  }

  async dispatchPreTurn(prompt: any): Promise<{ result: HookResult; turnContext: TurnContext }> {
    const turnContext = new TurnContext(this.sessionContext);
    const normalizedPrompt = prompt ?? '';
    for (const hook of this._preTurnHooks) {
      const res = await hook.run(turnContext, normalizedPrompt);
      if (res && res.allow === false) {
        return { result: res, turnContext };
      }
    }
    return { result: { allow: true }, turnContext };
  }

  async dispatch_pre_turn(prompt: any): Promise<{ result: HookResult; turnContext: TurnContext }> {
    return this.dispatchPreTurn(prompt);
  }

  async dispatchPostTurn(turnContext: TurnContext, response: string): Promise<void> {
    for (const hook of this._postTurnHooks) {
      await hook.run(turnContext, response);
    }
  }

  async dispatch_post_turn(turnContext: TurnContext, response: string): Promise<void> {
    return this.dispatchPostTurn(turnContext, response);
  }

  async dispatchPreToolCall(
    turnContext: TurnContext,
    toolCall: ToolCall
  ): Promise<{ result: HookResult; toolCall: ToolCall; opContext: OperationContext }> {
    const opContext = new OperationContext(turnContext);
    for (const hook of this._preToolCallDecideHooks) {
      const res = await hook.run(opContext, toolCall);
      if (!res.allow) {
        return { result: res, toolCall, opContext };
      }
    }
    return { result: { allow: true }, toolCall, opContext };
  }

  async dispatch_pre_tool_call(
    turnContext: TurnContext,
    toolCall: ToolCall
  ): Promise<{ result: HookResult; toolCall: ToolCall; opContext: OperationContext }> {
    return this.dispatchPreToolCall(turnContext, toolCall);
  }

  async dispatchPostToolCall(opContext: OperationContext, result: any): Promise<void> {
    for (const hook of this._postToolCallHooks) {
      await hook.run(opContext, result);
    }
  }

  async dispatch_post_tool_call(opContext: OperationContext, result: any): Promise<void> {
    return this.dispatchPostToolCall(opContext, result);
  }

  async dispatchOnToolError(opContext: OperationContext, error: Error): Promise<{ result: HookResult; recovery: any }> {
    for (const hook of this._onToolErrorHooks) {
      try {
        const res = await hook.run(opContext, error);
        if (res !== undefined && res !== null) {
          return { result: { allow: true }, recovery: res };
        }
      } catch (e) {
        return {
          result: { allow: false, message: `Error recovery failed: ${e}` },
          recovery: null
        };
      }
    }
    return { result: { allow: false }, recovery: null };
  }

  async dispatch_on_tool_error(opContext: OperationContext, error: Error): Promise<{ result: HookResult; recovery: any }> {
    return this.dispatchOnToolError(opContext, error);
  }

  async dispatchInteraction(
    turnContext: TurnContext,
    interactionSpec: AskQuestionInteractionSpec
  ): Promise<{ result: HookResult; response: QuestionHookResult | null; opContext: OperationContext }> {
    const opContext = new OperationContext(turnContext);
    for (const hook of this._onInteractionHooks) {
      const res = await hook.run(opContext, interactionSpec);
      if (res) {
        return { result: { allow: true }, response: res, opContext };
      }
    }
    return {
      result: { allow: false, message: 'No interaction hook handled the request' },
      response: null,
      opContext
    };
  }

  async dispatch_interaction(
    turnContext: TurnContext,
    interactionSpec: AskQuestionInteractionSpec
  ): Promise<{ result: HookResult; response: QuestionHookResult | null; opContext: OperationContext }> {
    return this.dispatchInteraction(turnContext, interactionSpec);
  }

  async dispatchCompaction(turnContext: TurnContext, data: any): Promise<void> {
    const opContext = new OperationContext(turnContext);
    for (const hook of this._onCompactionHooks) {
      await hook.run(opContext, data);
    }
  }

  async dispatch_compaction(turnContext: TurnContext, data: any): Promise<void> {
    return this.dispatchCompaction(turnContext, data);
  }
}
