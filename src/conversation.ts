import { Connection, ConnectionStrategy } from './connection.js';
import { Step, StepType, StepSource, StepTarget, StreamChunk, Thought, Text, ToolCall, UsageMetadata, ChatResponse } from './types.js';
import { LocalConnectionStrategy } from './connections/local/local_connection.js';

const DEFAULT_MAX_HISTORY_SIZE = 10_000;

function connectionIsIdle(conn: Connection): boolean {
  return conn.isIdle ?? Boolean(conn.is_idle);
}

function zeroUsage(): UsageMetadata {
  return {
    promptTokenCount: 0,
    cachedContentTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    totalTokenCount: 0
  };
}

function addUsage(target: UsageMetadata, source: UsageMetadata): void {
  target.promptTokenCount = (target.promptTokenCount ?? 0) + (source.promptTokenCount ?? source.prompt_token_count ?? 0);
  target.cachedContentTokenCount = (target.cachedContentTokenCount ?? 0) + (source.cachedContentTokenCount ?? source.cached_content_token_count ?? 0);
  target.candidatesTokenCount = (target.candidatesTokenCount ?? 0) + (source.candidatesTokenCount ?? source.candidates_token_count ?? 0);
  target.thoughtsTokenCount = (target.thoughtsTokenCount ?? 0) + (source.thoughtsTokenCount ?? source.thoughts_token_count ?? 0);
  target.totalTokenCount = (target.totalTokenCount ?? 0) + (source.totalTokenCount ?? source.total_token_count ?? 0);
}

export class Conversation {
  private _steps: Step[] = [];
  private _turnStartIndices: number[] = [];
  private _compactionIndices: number[] = [];
  private _maxHistorySize: number;
  private _cumulativeUsage: UsageMetadata = zeroUsage();
  private _turnUsage: UsageMetadata | null = null;

  constructor(
    private _connection: Connection,
    options: { maxHistorySize?: number } = {}
  ) {
    this._maxHistorySize = options.maxHistorySize ?? DEFAULT_MAX_HISTORY_SIZE;
  }

  /**
   * Creates a conversation scoped to a connection strategy lifecycle.
   * Mirrors Conversation.create() in the Python SDK.
   */
  static async *create(strategy: ConnectionStrategy): AsyncGenerator<Conversation, void, unknown> {
    const local = strategy as LocalConnectionStrategy;
    if (typeof local.start !== 'function') {
      throw new Error('ConnectionStrategy must implement start() for Conversation.create().');
    }
    await local.start();
    try {
      yield new Conversation(strategy.connect());
    } finally {
      await strategy[Symbol.asyncDispose]();
    }
  }

  /** Convenience wrapper around create() for try/finally usage. */
  static async withStrategy<T>(
    strategy: ConnectionStrategy,
    fn: (conversation: Conversation) => Promise<T>
  ): Promise<T> {
    const gen = Conversation.create(strategy);
    const { value: conversation, done } = await gen.next();
    if (done || !conversation) {
      throw new Error('Failed to create conversation.');
    }
    try {
      return await fn(conversation);
    } finally {
      await gen.return(undefined);
    }
  }

  get connection(): Connection {
    return this._connection;
  }

  get history(): Step[] {
    return [...this._steps];
  }

  get lastResponse(): string {
    for (let i = this._steps.length - 1; i >= 0; i--) {
      if (this._steps[i].isCompleteResponse || this._steps[i].is_complete_response) {
        return this._steps[i].content;
      }
    }
    return '';
  }

  /** Python alias */
  get last_response(): string {
    return this.lastResponse;
  }

  get turnCount(): number {
    return this._turnStartIndices.length;
  }

  /** Python alias */
  get turn_count(): number {
    return this.turnCount;
  }

  get compactionIndices(): number[] {
    return [...this._compactionIndices];
  }

  /** Python alias */
  get compaction_indices(): number[] {
    return this.compactionIndices;
  }

  get isIdle(): boolean {
    return connectionIsIdle(this._connection);
  }

  /** Python alias */
  get is_idle(): boolean {
    return this.isIdle;
  }

  get conversationId(): string {
    return this._connection.conversationId ?? this._connection.conversation_id ?? '';
  }

  /** Python alias */
  get conversation_id(): string {
    return this.conversationId;
  }

  get totalUsage(): UsageMetadata {
    return { ...this._cumulativeUsage };
  }

  /** Python alias */
  get total_usage(): UsageMetadata {
    return this.totalUsage;
  }

  get lastTurnUsage(): UsageMetadata | null {
    return this._turnUsage ? { ...this._turnUsage } : null;
  }

  /** Python alias */
  get last_turn_usage(): UsageMetadata | null {
    return this.lastTurnUsage;
  }

  clearHistory(): void {
    this._steps = [];
    this._turnStartIndices = [];
    this._compactionIndices = [];
    this._cumulativeUsage = zeroUsage();
    this._turnUsage = null;
  }

  /** Python alias */
  clear_history(): void {
    this.clearHistory();
  }

  private enforceMaxHistory(): void {
    if (this._maxHistorySize && this._steps.length > this._maxHistorySize) {
      const overflow = this._steps.length - this._maxHistorySize;
      this._steps = this._steps.slice(overflow);
      this._turnStartIndices = this._turnStartIndices
        .map((i) => i - overflow)
        .filter((i) => i >= 0);
      this._compactionIndices = this._compactionIndices
        .map((i) => i - overflow)
        .filter((i) => i >= 0);
    }
  }

  private accumulateUsage(usage: UsageMetadata): void {
    addUsage(this._cumulativeUsage, usage);

    if (!this._turnUsage) {
      this._turnUsage = zeroUsage();
    }
    addUsage(this._turnUsage, usage);
  }

  getLastStructuredOutput(): any | null {
    for (let i = this._steps.length - 1; i >= 0; i--) {
      if (this._steps[i].type === StepType.FINISH) {
        return this._steps[i].structuredOutput || this._steps[i].structured_output || null;
      }
    }
    return null;
  }

  /** Python alias */
  get_last_structured_output(): any | null {
    return this.getLastStructuredOutput();
  }

  async send(prompt: any, options?: any): Promise<void> {
    if (!connectionIsIdle(this._connection)) {
      try {
        const iter = this.receiveSteps();
        while (true) {
          const next = await iter.next();
          if (next.done) break;
        }
      } catch {
        await this._connection.waitForIdle();
      }
    }

    this._turnStartIndices.push(this._steps.length);
    this._turnUsage = null;
    await this._connection.send(prompt, options);
  }

  async *receiveSteps(): AsyncGenerator<Step, void, unknown> {
    const stream = this._connection.receiveSteps?.() ?? this._connection.receive_steps!();
    for await (const step of stream) {
      this._steps.push(step);
      if (step.type === StepType.COMPACTION) {
        this._compactionIndices.push(this._steps.length - 1);
      }
      const usage = step.usageMetadata || step.usage_metadata;
      if (usage) {
        this.accumulateUsage(usage);
      }
      this.enforceMaxHistory();
      yield step;
    }
  }

  /** Python alias */
  receive_steps(): AsyncGenerator<Step, void, unknown> {
    return this.receiveSteps();
  }

  async *receiveChunks(): AsyncGenerator<StreamChunk | ToolCall, void, unknown> {
    const seenToolIds = new Set<string>();
    for await (const step of this.receiveSteps()) {
      const isModel = step.source === StepSource.MODEL;
      const isTargetUser = step.target === StepTarget.USER;

      if (isModel && isTargetUser) {
        const thinkingDelta = step.thinkingDelta || step.thinking_delta;
        if (thinkingDelta) {
          yield new Thought(step.stepIndex, thinkingDelta);
        }
        const contentDelta = step.contentDelta || step.content_delta;
        if (contentDelta) {
          yield new Text(step.stepIndex, contentDelta);
        }
      }

      const toolCalls = step.toolCalls || step.tool_calls || [];
      if (toolCalls.length > 0) {
        for (const call of toolCalls) {
          if (!call.id || !seenToolIds.has(call.id)) {
            if (call.id) {
              seenToolIds.add(call.id);
            }
            yield call;
          }
        }
      }
    }
  }

  /** Python alias */
  receive_chunks(): AsyncGenerator<StreamChunk | ToolCall, void, unknown> {
    return this.receiveChunks();
  }

  async chat(prompt: any, options?: any): Promise<ChatResponse> {
    await this.send(prompt, options);
    const iterator = this.receiveChunks();
    return new ChatResponse(iterator, this);
  }

  async cancel(): Promise<void> {
    await this._connection.cancel();
  }

  async delete(): Promise<void> {
    await this._connection.delete();
  }

  async signalIdle(): Promise<void> {
    await (this._connection.signalIdle?.() ?? this._connection.signal_idle!());
  }

  /** Python alias */
  async signal_idle(): Promise<void> {
    return this.signalIdle();
  }

  async waitForIdle(): Promise<void> {
    await (this._connection.waitForIdle?.() ?? this._connection.wait_for_idle!());
  }

  /** Python alias */
  async wait_for_idle(): Promise<void> {
    return this.waitForIdle();
  }

  async waitForWakeup(timeout?: number): Promise<boolean> {
    return await (this._connection.waitForWakeup?.(timeout) ?? this._connection.wait_for_wakeup!(timeout));
  }

  /** Python alias */
  async wait_for_wakeup(timeout?: number): Promise<boolean> {
    return this.waitForWakeup(timeout);
  }

  async disconnect(): Promise<void> {
    await this._connection.disconnect();
  }
}
