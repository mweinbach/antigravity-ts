import * as chokidar from 'chokidar';
import * as path from 'path';
import { FileChange, FileChangeKind } from '../types.js';

export interface TriggerContext {
  send(message: string): Promise<void>;
}

export type Trigger = (ctx: TriggerContext) => Promise<void>;

/**
 * Validates and marks a function as a Trigger (mirrors Python @trigger decorator).
 */
export function trigger(fn: Trigger): Trigger {
  if (fn.constructor.name === 'AsyncFunction' || fn.length !== 1) {
    // Best-effort validation — TS cannot inspect coroutine as reliably as Python
    if (fn.length !== 1) {
      throw new Error('Trigger must accept exactly one parameter (TriggerContext).');
    }
  }
  (fn as any).__isTrigger = true;
  return fn;
}

function parseInterval(expr: string): number {
  const match = expr.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    const num = parseInt(expr, 10);
    if (!isNaN(num)) return num;
    throw new Error(`Invalid interval expression: "${expr}"`);
  }
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    default: return val;
  }
}

/**
 * Creates a trigger that runs callback on a fixed interval.
 * Mirrors triggers.helpers.every().
 */
export function every(
  intervalSeconds: number,
  callback: (ctx: TriggerContext) => Promise<void>
): Trigger {
  if (intervalSeconds <= 0) {
    throw new Error(`interval_seconds must be positive, got ${intervalSeconds}`);
  }
  return trigger(async (ctx) => {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
      await callback(ctx);
    }
  });
}

/**
 * Creates a trigger that calls callback when files at path change.
 * Mirrors triggers.helpers.on_file_change().
 */
export function onFileChange(
  watchPath: string,
  callback: (ctx: TriggerContext, changes: FileChange[]) => Promise<void>
): Trigger {
  return trigger(async (ctx) => {
    const absPath = path.resolve(watchPath);
    const watcher = chokidar.watch(absPath, { persistent: true, ignoreInitial: true });

    await new Promise<void>((resolve, reject) => {
      watcher.on('add', (p) => callback(ctx, [new FileChange(FileChangeKind.ADDED, p)]).catch(console.error));
      watcher.on('change', (p) => callback(ctx, [new FileChange(FileChangeKind.MODIFIED, p)]).catch(console.error));
      watcher.on('unlink', (p) => callback(ctx, [new FileChange(FileChangeKind.DELETED, p)]).catch(console.error));
      watcher.on('error', reject);
      // Keep running until trigger runner cancels the task
    });
  });
}

/** Legacy object-style trigger helpers */
export const triggerHelpers = {
  every(intervalExpr: string | number, callback: (ctx: TriggerContext) => Promise<void> | void) {
    const seconds = typeof intervalExpr === 'number' ? intervalExpr / 1000 : parseInterval(String(intervalExpr)) / 1000;
    return every(seconds, async (ctx) => { await callback(ctx); });
  },
  onFileChange(filePath: string, callback: (ctx: TriggerContext) => Promise<void> | void) {
    return onFileChange(filePath, async (ctx) => { await callback(ctx); });
  }
};

export { TriggerRunner } from './trigger_runner.js';
