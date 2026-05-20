import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function writeVarint(value: number): Buffer {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

function readVarint(buffer: Buffer, offset: { value: number }): number {
  let result = 0;
  let shift = 0;
  while (true) {
    const byte = buffer[offset.value++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      break;
    }
    shift += 7;
  }
  return result;
}

// InputConfig:
// field 1: storage_directory (string)
// field 2: port (uint32)
// field 3: bind_address (string)
function encodeInputConfig(storageDirectory: string): Buffer {
  const dirBytes = Buffer.from(storageDirectory, 'utf-8');
  // Tag for field 1, type 2 (length-delimited): (1 << 3) | 2 = 10 (0x0a)
  const tag = Buffer.from([0x0a]);
  const len = writeVarint(dirBytes.length);
  const payload = Buffer.concat([tag, len, dirBytes]);
  
  // Length prefix (4-byte little-endian)
  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32LE(payload.length, 0);
  
  return Buffer.concat([lenPrefix, payload]);
}

// OutputConfig:
// field 1: port (int32)
// field 2: api_key (string)
function decodeOutputConfig(buffer: Buffer): { port: number; apiKey: string } {
  let port = 0;
  let apiKey = '';
  const offset = { value: 0 };
  
  while (offset.value < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    
    if (fieldNumber === 1 && wireType === 0) {
      port = readVarint(buffer, offset);
    } else if (fieldNumber === 2 && wireType === 2) {
      const len = readVarint(buffer, offset);
      apiKey = buffer.toString('utf-8', offset.value, offset.value + len);
      offset.value += len;
    } else {
      // Skip unknown fields
      if (wireType === 0) {
        readVarint(buffer, offset);
      } else if (wireType === 2) {
        const len = readVarint(buffer, offset);
        offset.value += len;
      } else if (wireType === 1) {
        offset.value += 8;
      } else if (wireType === 5) {
        offset.value += 4;
      } else {
        throw new Error(`Unsupported wire type: ${wireType}`);
      }
    }
  }
  
  return { port, apiKey };
}

async function test() {
  const binaryPath = '/tmp/antigravity-extracted/google/antigravity/bin/localharness';
  const saveDir = path.resolve('temp_harness_test');
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir);
  }
  
  console.log(`Spawning localharness: ${binaryPath}`);
  const child = spawn(binaryPath, [], {
    stdio: ['pipe', 'pipe', 'inherit']
  });
  
  const payload = encodeInputConfig(saveDir);
  console.log(`Writing InputConfig: ${payload.toString('hex')}`);
  child.stdin.write(payload);
  
  // Read length prefix
  const lenBuf = await new Promise<Buffer>((resolve) => {
    child.stdout.once('data', (chunk) => {
      resolve(chunk);
    });
  });
  
  if (lenBuf.length < 4) {
    console.error('Failed to read length prefix');
    child.kill();
    return;
  }
  
  const len = lenBuf.readUInt32LE(0);
  console.log(`OutputConfig length: ${len}`);
  
  // Read the rest if needed, or parse what we got
  let bodyBuf = lenBuf.subarray(4);
  while (bodyBuf.length < len) {
    const chunk = await new Promise<Buffer>((resolve) => {
      child.stdout.once('data', (chunk) => {
        resolve(chunk);
      });
    });
    bodyBuf = Buffer.concat([bodyBuf, chunk]);
  }
  
  const outputConfig = decodeOutputConfig(bodyBuf.subarray(0, len));
  console.log('Decoded OutputConfig:', outputConfig);
  
  child.kill();
  if (fs.existsSync(saveDir)) {
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
}

test().catch(console.error);
