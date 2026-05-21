#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { getDefaultHarnessBinaryPath } from '../connections/local/harness_binary.js';

const child = spawn(
  getDefaultHarnessBinaryPath({ includePathFallback: false }),
  process.argv.slice(2),
  { stdio: 'inherit' }
);

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
