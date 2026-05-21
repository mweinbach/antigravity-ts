#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PYPI_PACKAGE = 'google-antigravity';
const DEFAULT_VERSION = '0.1.0';
const WHEEL_BINARY_PATH = 'google/antigravity/bin/localharness';

interface PyPiFile {
  filename: string;
  packagetype: string;
  url: string;
  digests?: {
    sha256?: string;
  };
}

interface PyPiMetadata {
  urls: PyPiFile[];
}

interface WheelPlatformPattern {
  pattern: RegExp;
  platform?: string;
  platforms?: string[];
}

interface SupportedWheel extends PyPiFile {
  platforms: string[];
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RuntimeManifest {
  source: string;
  version: string;
  generatedAt: string;
  runtimes: Record<string, {
    filename: string;
    wheelSha256: string;
    binary: string;
  }>;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.env.GOOGLE_ANTIGRAVITY_VERSION || DEFAULT_VERSION;
const outDir = path.join(rootDir, 'vendor', 'localharness');

const WHEEL_PLATFORM_PATTERNS: WheelPlatformPattern[] = [
  { pattern: /macosx_[^/]+_arm64\.whl$/, platform: 'darwin-arm64' },
  { pattern: /macosx_[^/]+_(x86_64|amd64)\.whl$/, platform: 'darwin-x64' },
  { pattern: /macosx_[^/]+_universal2\.whl$/, platforms: ['darwin-arm64', 'darwin-x64'] },
  { pattern: /(manylinux|musllinux)_[^/]+_x86_64\.whl$/, platform: 'linux-x64' },
  { pattern: /(manylinux|musllinux)_[^/]+_aarch64\.whl$/, platform: 'linux-arm64' },
  { pattern: /win_amd64\.whl$/, platform: 'win32-x64' },
  { pattern: /win_arm64\.whl$/, platform: 'win32-arm64' }
];

function platformsFromWheel(filename: string): string[] {
  const match = WHEEL_PLATFORM_PATTERNS.find(({ pattern }) => pattern.test(filename));
  if (!match) {
    return [];
  }
  return match.platforms ?? (match.platform ? [match.platform] : []);
}

async function fetchJson(url: string): Promise<PyPiMetadata> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<PyPiMetadata>;
}

async function download(url: string, destination: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes;
}

function spawnForOutput(command: string, args: string[]): Promise<SpawnResult> {
  const chunks = { stdout: '', stderr: '' };
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve) => {
    child.stdout?.on('data', (data: Buffer) => {
      chunks.stdout += data.toString('utf8');
    });
    child.stderr?.on('data', (data: Buffer) => {
      chunks.stderr += data.toString('utf8');
    });
    child.on('close', (status) => {
      resolve({ status, ...chunks });
    });
  });
}

async function extractWheel(wheelPath: string, destination: string): Promise<void> {
  const script = [
    'import pathlib, stat, sys, zipfile',
    'wheel = pathlib.Path(sys.argv[1])',
    'dest = pathlib.Path(sys.argv[2])',
    'dest.parent.mkdir(parents=True, exist_ok=True)',
    `member = ${JSON.stringify(WHEEL_BINARY_PATH)}`,
    'with zipfile.ZipFile(wheel) as zf:',
    '    data = zf.read(member)',
    'dest.write_bytes(data)',
    'dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)',
    ''
  ].join('\n');

  const child = await spawnForOutput('python3', ['-c', script, wheelPath, destination]);
  if (child.status !== 0) {
    throw new Error(`python3 extraction failed for ${wheelPath}:\n${child.stderr || child.stdout}`);
  }
}

async function main(): Promise<void> {
  const metadata = await fetchJson(`https://pypi.org/pypi/${PYPI_PACKAGE}/${version}/json`);
  const wheels: SupportedWheel[] = metadata.urls
    .filter((file) => file.packagetype === 'bdist_wheel')
    .map((file) => ({ ...file, platforms: platformsFromWheel(file.filename) }))
    .filter((file) => file.platforms.length > 0);

  if (wheels.length === 0) {
    throw new Error(`No supported platform wheels found for ${PYPI_PACKAGE}@${version}`);
  }

  const tmp = await mkdtemp(path.join(tmpdir(), 'antigravity-localharness-'));
  const manifest: RuntimeManifest = {
    source: PYPI_PACKAGE,
    version,
    generatedAt: new Date().toISOString(),
    runtimes: {}
  };

  try {
    await mkdir(outDir, { recursive: true });

    for (const wheel of wheels) {
      const wheelPath = path.join(tmp, wheel.filename);
      const bytes = await download(wheel.url, wheelPath);
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      const expectedSha256 = wheel.digests?.sha256;
      if (expectedSha256 && actualSha256 !== expectedSha256) {
        throw new Error(`SHA256 mismatch for ${wheel.filename}: expected ${expectedSha256}, got ${actualSha256}`);
      }

      for (const platform of wheel.platforms) {
        const platformDir = path.join(outDir, platform);
        const binaryName = platform.startsWith('win32-') ? 'localharness.exe' : 'localharness';
        const binaryPath = path.join(platformDir, binaryName);
        await extractWheel(wheelPath, binaryPath);

        manifest.runtimes[platform] = {
          filename: wheel.filename,
          wheelSha256: actualSha256,
          binary: `${platform}/${binaryName}`
        };
        console.log(`synced ${platform} from ${wheel.filename}`);
      }
    }

    await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
