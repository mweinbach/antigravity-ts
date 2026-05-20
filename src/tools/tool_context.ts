import { Connection } from '../connection.js';

/**
 * Conversation-aware context for custom tools.
 * Mirrors google.antigravity.tools.tool_context.ToolContext.
 */
export class ToolContext {
  private state: Record<string, any> = {};

  constructor(private connection: Connection) {}

  get conversationId(): string {
    return this.connection.conversationId ?? this.connection.conversation_id ?? '';
  }

  /** Python alias */
  get conversation_id(): string {
    return this.conversationId;
  }

  get isIdle(): boolean {
    return this.connection.isIdle ?? Boolean(this.connection.is_idle);
  }

  /** Python alias */
  get is_idle(): boolean {
    return this.isIdle;
  }

  async send(message: string): Promise<void> {
    await (this.connection.sendTriggerNotification?.(message) ?? this.connection.send_trigger_notification?.(message));
  }

  getState(key: string, defaultValue?: any): any {
    return this.state[key] ?? defaultValue;
  }

  /** Python alias */
  get_state(key: string, defaultValue?: any): any {
    return this.getState(key, defaultValue);
  }

  setState(key: string, value: any): void {
    this.state[key] = value;
  }

  /** Python alias */
  set_state(key: string, value: any): void {
    this.setState(key, value);
  }
}
