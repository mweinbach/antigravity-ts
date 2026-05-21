import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HarnessBinaryOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includeDevFallbacks?: boolean;
  includePathFallback?: boolean;
}

const SUPPORTED_ARCHES: Partial<Record<NodeJS.Architecture, string>> = {
  arm64: 'arm64',
  x64: 'x64'
};

export function getCurrentPlatformKey(): string {
  const arch = SUPPORTED_ARCHES[process.arch];
  if (!arch) {
    throw new Error(`Unsupported architecture for localharness: ${process.arch}`);
  }
  return `${process.platform}-${arch}`;
}

export function getHarnessBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'localharness.exe' : 'localharness';
}

function moduleRoot(): string | undefined {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '../../../');
  } catch {
    return undefined;
  }
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function firstExisting(candidates: string[]): string | undefined {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findOnPath(binary: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.PATH;
  if (!pathValue) {
    return undefined;
  }

  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.join(entry, binary);
    if (existsSync(candidate) && isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function bundledCandidates(cwd: string, platform: string, binary: string): string[] {
  const candidates = [path.resolve(cwd, 'vendor/localharness', platform, binary)];
  const root = moduleRoot();
  if (root) {
    candidates.push(path.resolve(root, 'vendor/localharness', platform, binary));
  }
  return candidates;
}

function devCandidates(cwd: string): string[] {
  const candidates = [
    path.resolve(cwd, 'scratch/python-sdk/antigravity/bin/localharness'),
    path.resolve(cwd, 'node_modules/google-antigravity/google/antigravity/bin/localharness')
  ];
  const root = moduleRoot();
  if (root) {
    candidates.push(path.resolve(root, 'scratch/python-sdk/antigravity/bin/localharness'));
  }
  return candidates;
}

export function getBundledHarnessBinaryPath(options: HarnessBinaryOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const platform = getCurrentPlatformKey();
  const binary = getHarnessBinaryName();
  const resolved = firstExisting(bundledCandidates(cwd, platform, binary));

  if (resolved) {
    return resolved;
  }

  throw new Error(
    `No bundled localharness runtime for ${platform}. Run \`npm run sync:localharness\` to download available runtimes.`
  );
}

/**
 * Resolves the localharness binary path.
 * Mirrors google.antigravity.connections.local.local_connection._get_default_binary_path.
 */
export function getDefaultHarnessBinaryPath(options: HarnessBinaryOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.ANTIGRAVITY_HARNESS_PATH) {
    return env.ANTIGRAVITY_HARNESS_PATH;
  }

  const cwd = options.cwd ?? process.cwd();
  const platform = getCurrentPlatformKey();
  const binary = getHarnessBinaryName();
  const candidates = bundledCandidates(cwd, platform, binary);

  if (options.includeDevFallbacks !== false) {
    candidates.push(...devCandidates(cwd));
  }

  const resolved = firstExisting(candidates);
  if (resolved) {
    return resolved;
  }

  if (options.includePathFallback !== false) {
    const pathBinary = findOnPath(binary, env);
    if (pathBinary) {
      return pathBinary;
    }
  }

  throw new Error(
    'Could not find default localharness binary. ' +
    `Set ANTIGRAVITY_HARNESS_PATH, run \`npm run sync:localharness\`, or install a localharness binary for ${platform}.`
  );
}
