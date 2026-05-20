#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function platformKey() {
  const archMap = {
    x64: 'x64',
    arm64: 'arm64'
  };
  const arch = archMap[process.arch];
  if (!arch) {
    throw new Error(`Unsupported architecture for localharness: ${process.arch}`);
  }
  return `${process.platform}-${arch}`;
}

function binaryName() {
  return process.platform === 'win32' ? 'localharness.exe' : 'localharness';
}

function resolveBundledHarness() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '..', 'vendor', 'localharness', platformKey(), binaryName());
  if (existsSync(candidate)) {
    return candidate;
  }
  throw new Error(
    `No bundled localharness runtime for ${platformKey()}. ` +
    'Run `npm run sync:localharness` to download available runtimes.'
  );
}

const child = spawn(resolveBundledHarness(), process.argv.slice(2), {
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
