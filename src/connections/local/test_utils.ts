import { LocalConnection } from './local_connection.js';
import { ToolRunner } from '../../tools/tool_runner.js';
import { HookRunner } from '../../hooks/hook_runner.js';

type MessageHandler = (event: { data: string }) => void | Promise<void>;

export class TestWebSocket {
  sentMessages: string[] = [];
  onmessage?: MessageHandler;
  onerror?: (error: unknown) => void;
  onclose?: () => void;
  private sentWaiters: Array<(message: string) => void> = [];

  send(message: string): void {
    this.sentMessages.push(message);
    const waiter = this.sentWaiters.shift();
    if (waiter) {
      waiter(message);
    }
  }

  async putEvent(event: unknown): Promise<void> {
    const data = typeof event === 'string' ? event : JSON.stringify(event);
    await this.onmessage?.({ data });
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  waitForSentMessage(timeout = 10_000): Promise<string> {
    const existing = this.sentMessages.shift();
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for sent message.')), timeout);
      this.sentWaiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }
}

export class TestLocalHarness {
  ws: TestWebSocket;
  conn: LocalConnection;

  constructor(
    process: any,
    ws: TestWebSocket = new TestWebSocket(),
    toolRunner?: ToolRunner,
    hookRunner?: HookRunner
  ) {
    this.ws = ws;
    this.conn = new LocalConnection(process, ws, toolRunner, hookRunner);
  }

  async disconnectSdk(): Promise<void> {
    await this.conn.disconnect();
  }

  async disconnect_sdk(): Promise<void> {
    return this.disconnectSdk();
  }

  async closeFromHarnessSide(): Promise<void> {
    await this.ws.close();
  }

  async close_from_harness_side(): Promise<void> {
    return this.closeFromHarnessSide();
  }

  async waitForResponse(timeout = 10_000): Promise<Record<string, unknown>> {
    return JSON.parse(await this.ws.waitForSentMessage(timeout));
  }

  async wait_for_response(timeout = 10_000): Promise<Record<string, unknown>> {
    return this.waitForResponse(timeout);
  }

  async sendEvent(event: unknown): Promise<void> {
    await this.ws.putEvent(event);
  }

  async send_event(event: unknown): Promise<void> {
    return this.sendEvent(event);
  }

  async sendToolCall(id: string, name: string, argumentsJson: string): Promise<void> {
    await this.sendEvent({
      tool_call: {
        id,
        name,
        arguments_json: argumentsJson
      }
    });
  }

  async send_tool_call(id: string, name: string, argumentsJson: string): Promise<void> {
    return this.sendToolCall(id, name, argumentsJson);
  }

  async sendToolConfirmationRequest(trajectoryId: string, stepIndex: number, extra: Record<string, unknown> = {}): Promise<void> {
    await this.sendEvent({
      step_update: {
        trajectory_id: trajectoryId,
        step_index: stepIndex,
        state: 'STATE_WAITING_FOR_USER',
        tool_confirmation_request: {},
        ...extra
      }
    });
  }

  async send_tool_confirmation_request(trajectoryId: string, stepIndex: number, extra: Record<string, unknown> = {}): Promise<void> {
    return this.sendToolConfirmationRequest(trajectoryId, stepIndex, extra);
  }
}
