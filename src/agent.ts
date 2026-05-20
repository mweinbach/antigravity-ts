import { LocalAgentConfig, BuiltinTools } from './config.js';
import { Conversation } from './conversation.js';
import { ToolRunner } from './tools/tool_runner.js';
import { ToolContext } from './tools/tool_context.js';
import { HookRunner, TurnContext } from './hooks/hook_runner.js';
import { enforce } from './hooks/policy.js';
import { McpBridge } from './mcp/index.js';
import { TriggerRunner } from './triggers/trigger_runner.js';
import { Trigger } from './triggers/index.js';
import { ChatResponse, ToolCall } from './types.js';
import { LocalConnectionStrategy } from './connections/local/local_connection.js';

export interface AgentHookContext {
  agent: Agent;
  toolCall?: import('./types.js').ToolCall;
  error?: any;
}

export class Agent {
  private _conversation?: Conversation;
  private _strategy?: LocalConnectionStrategy;
  public toolRunner = new ToolRunner();
  public hookRunner = new HookRunner();
  public isConnected = false;

  /** @deprecated Use toolRunner */
  get registry() {
    return this.toolRunner;
  }

  private triggerRunner?: TriggerRunner;
  private mcpBridge = new McpBridge();
  private pendingHooks: any[] = [];
  private pendingTriggers: Trigger[] = [];

  /**
   * Opens a started agent session (Python `async with Agent(...)`).
   * @example await using agent = await Agent.open(config);
   */
  static async open(config: LocalAgentConfig = new LocalAgentConfig()): Promise<Agent> {
    const agent = new Agent(config);
    await agent.start();
    return agent;
  }

  /**
   * Async context manager yielding a started agent.
   * @example for await (const agent of Agent.create(config)) { ... }
   */
  static async *create(config: LocalAgentConfig = new LocalAgentConfig()): AsyncGenerator<Agent> {
    const agent = new Agent(config);
    await agent.start();
    try {
      yield agent;
    } finally {
      await agent.stop();
    }
  }

  /**
   * Runs a callback with a started agent, stopping on completion.
   */
  static async run<T>(
    config: LocalAgentConfig,
    fn: (agent: Agent) => Promise<T>
  ): Promise<T> {
    const agent = await Agent.open(config);
    try {
      return await fn(agent);
    } finally {
      await agent.stop();
    }
  }

  constructor(config: LocalAgentConfig = new LocalAgentConfig()) {
    // Shallow-copy config (policies contain functions; structuredClone would fail).
    const originalHooks = config.hooks;
    const originalTriggers = config.triggers;
    this.config = shallowCopyConfig(config);
    this.config.hooks = [...originalHooks];
    this.config.triggers = [...originalTriggers];

    if (this.config.responseSchema && !this.config.capabilities.finishToolSchemaJson) {
      this.config.capabilities.finishToolSchemaJson =
        typeof this.config.responseSchema === 'string'
          ? this.config.responseSchema
          : JSON.stringify(this.config.responseSchema);
    }
    this.pendingHooks = [...this.config.hooks];
    this.pendingTriggers = [...this.config.triggers];
  }

  public config: LocalAgentConfig;

  get isStarted(): boolean {
    return this._conversation != null;
  }

  get is_started(): boolean {
    return this.isStarted;
  }

  get conversation_id(): string | null {
    return this.conversationId;
  }

  /** @deprecated Use hookRunner */
  get _hook_runner() {
    return this.hookRunner;
  }

  /** @deprecated Use config */
  get _config() {
    return this.config;
  }

  get conversation(): Conversation {
    if (!this._conversation) {
      throw new Error("Agent session not started. Use 'await agent.start()' or 'await using agent'.");
    }
    return this._conversation;
  }

  get conversationId(): string | null {
    if (!this._conversation) return null;
    return this._conversation.conversationId || null;
  }

  registerHook(hook: any) {
    if (!this.isConnected) {
      this.pendingHooks.push(hook);
      return;
    }
    this.hookRunner.registerHook(hook);
  }

  register_hook(hook: any) {
    return this.registerHook(hook);
  }

  registerTrigger(trigger: Trigger) {
    if (this.isConnected) {
      throw new Error('Cannot register triggers after the agent has started.');
    }
    this.pendingTriggers.push(trigger);
  }

  register_trigger(trigger: Trigger) {
    return this.registerTrigger(trigger);
  }

  async start() {
    if (this.isConnected) return;

    for (const hook of this.pendingHooks) {
      this.hookRunner.registerHook(hook);
    }
    this.pendingHooks = [];

    this.validateSafetyPolicies();

    if (this.config.policies.length > 0) {
      this.hookRunner.registerHook(enforce(this.config.policies));
    }

    for (const tool of this.config.tools) {
      this.toolRunner.register(tool);
    }

    if (this.config.mcpServers.length > 0) {
      for (const mcpServer of this.config.mcpServers) {
        await this.mcpBridge.connect(mcpServer);
      }
      for (const mcpTool of this.mcpBridge.discoveredTools) {
        this.toolRunner.register(mcpTool);
      }
    }

    this._strategy = this.config.createStrategy(this.toolRunner, this.hookRunner);
    await this._strategy.start();
    this._conversation = new Conversation(this._strategy.connect());
    this.isConnected = true;

    const ctx = new ToolContext(this._conversation.connection);
    ctx.setState('agent', this);
    this.toolRunner.setContext(ctx);

    if (this.pendingTriggers.length > 0) {
      this.triggerRunner = new TriggerRunner(this.pendingTriggers, this._conversation.connection);
      await this.triggerRunner.start();
      this.pendingTriggers = [];
    }
  }

  async stop() {
    if (!this.isConnected) return;
    this.isConnected = false;

    if (this.triggerRunner) {
      await this.triggerRunner.stop();
      this.triggerRunner = undefined;
    }

    await this.mcpBridge.stop();

    if (this._strategy) {
      await this._strategy[Symbol.asyncDispose]();
      this._strategy = undefined;
    }

    this._conversation = undefined;
  }

  async [Symbol.asyncDispose]() {
    await this.stop();
  }

  private validateSafetyPolicies() {
    const cfg = this.config.capabilities;
    const readOnly = new Set(BuiltinTools.readOnly());
    let activeTools: Set<string>;
    if (cfg.enabledTools) {
      activeTools = new Set(cfg.enabledTools);
    } else if (cfg.disabledTools) {
      activeTools = new Set(BuiltinTools.allTools().filter(t => !cfg.disabledTools!.includes(t)));
    } else {
      activeTools = new Set(BuiltinTools.allTools());
    }

    const hasWriteTools = [...activeTools].some(t => !readOnly.has(t as BuiltinTools));
    const hasMcpServers = this.config.mcpServers.length > 0;
    const hasToolDecideHook =
      this.hookRunner.preToolCallDecideHookCount > 0 ||
      this.config.policies.length > 0 ||
      this.pendingHooks.some(h => h.preToolCallDecide || h.hookKind === 'preToolCallDecide');

    if ((hasWriteTools || hasMcpServers) && !hasToolDecideHook) {
      throw new Error(
        'Write tools or MCP servers are enabled without a safety policy. ' +
        "Add policies=[allow_all()] to approve all tool calls, or " +
        "policies=[deny_all(), allow('tool_name')] to selectively allow specific tools."
      );
    }
  }

  async chat(prompt: any): Promise<ChatResponse> {
    if (!this.isConnected) {
      await this.start();
    }
    return await this.conversation.chat(prompt);
  }

  /** Evaluate tool policies via the hook runner (for tests and advanced use). */
  async evaluateSafetyPolicy(tc: ToolCall): Promise<{ action: 'allow' | 'deny' | 'ask'; reason?: string }> {
    const { result } = await this.hookRunner.dispatchPreToolCall(
      new TurnContext(this.hookRunner.sessionContext),
      tc
    );
    if (!result.allow) {
      return { action: 'deny', reason: result.message };
    }
    return { action: 'allow' };
  }
}

function shallowCopyConfig(config: LocalAgentConfig): LocalAgentConfig {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(config)), config);
  copy.capabilities = Object.assign(
    Object.create(Object.getPrototypeOf(config.capabilities)),
    config.capabilities
  );
  copy.geminiConfig = structuredClone(config.geminiConfig);
  copy.tools = [...config.tools];
  copy.policies = [...config.policies];
  copy.hooks = [...config.hooks];
  copy.triggers = [...config.triggers];
  copy.mcpServers = [...config.mcpServers];
  copy.workspaces = [...config.workspaces];
  copy.skillsPaths = [...config.skillsPaths];
  return copy;
}
