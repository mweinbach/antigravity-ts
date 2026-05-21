#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const PYPI_PACKAGE = 'google-antigravity';
const DEFAULT_VERSION = '0.1.0';
const WHEEL_BINARY_DIR = 'google/antigravity/bin';

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

function readZipEntry(zip: Buffer, member: string): Buffer {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const maxCommentLength = 0xffff;
  const minEocdSize = 22;
  const start = Math.max(0, zip.length - minEocdSize - maxCommentLength);

  let eocdOffset = -1;
  for (let offset = zip.length - minEocdSize; offset >= start; offset--) {
    if (zip.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Could not find ZIP central directory.');
  }

  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let centralOffset = zip.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(centralOffset) !== centralSignature) {
      throw new Error('Invalid ZIP central directory entry.');
    }

    const compressionMethod = zip.readUInt16LE(centralOffset + 10);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const uncompressedSize = zip.readUInt32LE(centralOffset + 24);
    const fileNameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = zip.readUInt32LE(centralOffset + 42);
    const fileName = zip.toString('utf8', centralOffset + 46, centralOffset + 46 + fileNameLength);

    if (fileName === member) {
      if (zip.readUInt32LE(localHeaderOffset) !== localSignature) {
        throw new Error(`Invalid local ZIP header for ${member}.`);
      }
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);

      if (compressionMethod === 0) {
        return Buffer.from(compressed);
      }
      if (compressionMethod === 8) {
        const inflated = inflateRawSync(compressed);
        if (inflated.length !== uncompressedSize) {
          throw new Error(`Unexpected extracted size for ${member}: expected ${uncompressedSize}, got ${inflated.length}`);
        }
        return inflated;
      }
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${member}.`);
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`Could not find ${member} in wheel.`);
}

function wheelBinaryMember(platform: string): string {
  const binaryName = platform.startsWith('win32-') ? 'localharness.exe' : 'localharness';
  return `${WHEEL_BINARY_DIR}/${binaryName}`;
}

async function extractWheel(wheelPath: string, platform: string, destination: string): Promise<void> {
  const zip = await readFile(wheelPath);
  const data = readZipEntry(zip, wheelBinaryMember(platform));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
  if (!platform.startsWith('win32-')) {
    await chmod(destination, 0o755);
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
        await extractWheel(wheelPath, platform, binaryPath);

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
