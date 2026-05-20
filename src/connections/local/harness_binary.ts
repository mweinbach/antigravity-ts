import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Resolves the localharness binary path.
 * Mirrors google.antigravity.connections.local.local_connection._get_default_binary_path.
 */
export function getDefaultHarnessBinaryPath(): string {
  if (process.env.ANTIGRAVITY_HARNESS_PATH) {
    return process.env.ANTIGRAVITY_HARNESS_PATH;
  }

  const candidates = [
    path.resolve(process.cwd(), 'bin/localharness'),
    path.resolve(process.cwd(), 'scratch/python-sdk/antigravity/bin/localharness'),
    path.resolve(process.cwd(), 'node_modules/google-antigravity/google/antigravity/bin/localharness'),
  ];

  // Relative to this module (works from both src/ and dist/ layouts).
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '../../../bin/localharness'));
    candidates.push(path.resolve(here, '../../../scratch/python-sdk/antigravity/bin/localharness'));
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const which = execSync('which localharness', { encoding: 'utf8' }).trim();
    if (which && fs.existsSync(which)) {
      return which;
    }
  } catch {
    // not in PATH
  }

  throw new Error(
    'Could not find default localharness binary. ' +
    'Set ANTIGRAVITY_HARNESS_PATH, install google-antigravity, or place the binary at scratch/python-sdk/antigravity/bin/localharness.'
  );
}
