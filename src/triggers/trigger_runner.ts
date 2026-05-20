import { Connection } from '../connection.js';
import { TriggerContext } from './index.js';

export type Trigger = (ctx: TriggerContext) => Promise<void>;

/**
 * Manages registration, startup, and shutdown of triggers.
 * Mirrors google.antigravity.triggers.trigger_runner.TriggerRunner.
 */
export class TriggerRunner {
  private tasks: Promise<void>[] = [];
  private abortControllers: AbortController[] = [];
  private running = false;

  constructor(
    private triggers: Trigger[],
    private connection: Connection
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('TriggerRunner is already started.');
    }
    this.running = true;

    for (const trigger of this.triggers) {
      const ctx: TriggerContext = {
        send: async (content: string) => {
          await this.connection.sendTriggerNotification?.(content);
        }
      };
      const ac = new AbortController();
      this.abortControllers.push(ac);
      this.tasks.push(this.runTrigger(trigger, ctx, ac.signal));
    }
  }

  async stop(): Promise<void> {
    for (const ac of this.abortControllers) {
      ac.abort();
    }
    await Promise.allSettled(this.tasks);
    this.tasks = [];
    this.abortControllers = [];
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running && this.tasks.some(t => t !== undefined);
  }

  /** Python alias */
  get is_running(): boolean {
    return this.isRunning;
  }

  private async runTrigger(trigger: Trigger, ctx: TriggerContext, signal: AbortSignal): Promise<void> {
    const name = trigger.name || 'unknown';
    try {
      await trigger(ctx);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') {
        console.info(`Trigger '${name}' cancelled.`);
        return;
      }
      console.error(`Trigger '${name}' failed with unhandled exception:`, err);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
