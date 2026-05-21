import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  Agent,
  Audio,
  BuiltinTools,
  CapabilitiesConfig,
  Conversation,
  Document,
  GeminiConfig,
  GenerationConfig,
  HookRunner,
  Image,
  LocalAgentConfig,
  McpBridge,
  ModelConfig,
  ModelEntry,
  ToolRunner,
  Video,
  Text,
  Thought,
  from_file,
  policy
} from '../src/index.js';
import {
  getBundledHarnessBinaryPath,
  getCurrentPlatformKey,
  getDefaultHarnessBinaryPath,
  getHarnessBinaryName,
  getPlatformKey,
  LocalAgentConfig as LocalAgentConfigFromLocal,
  TestLocalHarness,
  TestWebSocket
} from '../src/connections/local/index.js';
import { async_input, run_interactive_loop } from '../src/utils/interactive.js';
import { on_file_change, trigger } from '../src/triggers/index.js';

function createTestHarnessProcess(): any {
  const process = new EventEmitter() as any;
  process.stderr = new EventEmitter();
  process.stdin = { end() {} };
  process.kill = () => {
    process.emit('exit');
    return true;
  };
  return process;
}

function hasBundledHarnessRuntime(): boolean {
  try {
    getBundledHarnessBinaryPath();
    return true;
  } catch {
    return false;
  }
}

test('platform keys and binary names include Windows runtimes', () => {
  assert.equal(getPlatformKey('win32', 'x64'), 'win32-x64');
  assert.equal(getPlatformKey('win32', 'arm64'), 'win32-arm64');
  assert.equal(getPlatformKey('linux', 'x64'), 'linux-x64');
  assert.equal(getPlatformKey('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(getHarnessBinaryName('win32'), 'localharness.exe');
  assert.equal(getHarnessBinaryName('linux'), 'localharness');
  assert.equal(getHarnessBinaryName('darwin'), 'localharness');
  assert.match(getCurrentPlatformKey(), /^[^-]+-(arm64|x64)$/);
});

test('Windows localharness is resolved from bundled and development locations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-win-harness-'));
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const windowsPlatform = getPlatformKey('win32');

    const bundled = path.join(dir, 'vendor', 'localharness', windowsPlatform, 'localharness.exe');
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, '');
    assert.equal(getDefaultHarnessBinaryPath({ cwd: dir, env: {}, includePathFallback: false }), bundled);

    fs.rmSync(path.join(dir, 'vendor'), { recursive: true, force: true });
    const dev = path.join(dir, 'node_modules', 'google-antigravity', 'google', 'antigravity', 'bin', 'localharness.exe');
    fs.mkdirSync(path.dirname(dev), { recursive: true });
    fs.writeFileSync(dev, '');
    assert.equal(getDefaultHarnessBinaryPath({ cwd: dir, env: {}, includePathFallback: false }), dev);
  } finally {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bundled localharness is resolved from platform vendor directory', { skip: !hasBundledHarnessRuntime() }, () => {
  const binaryPath = getBundledHarnessBinaryPath();
  const expectedBinary = getHarnessBinaryName();
  assert.equal(path.basename(binaryPath), expectedBinary);
  assert.equal(path.basename(path.dirname(binaryPath)), getCurrentPlatformKey());
  assert.equal(path.basename(path.dirname(path.dirname(binaryPath))), 'localharness');
  assert.equal(path.basename(path.dirname(path.dirname(path.dirname(binaryPath)))), 'vendor');
  assert.ok(fs.existsSync(binaryPath));
  if (process.platform !== 'win32') {
    assert.ok((fs.statSync(binaryPath).mode & 0o111) !== 0);
  }
  assert.equal(getDefaultHarnessBinaryPath({ env: {}, includePathFallback: false }), binaryPath);
});

test('bundled localharness can be invoked as a CLI binary', { skip: !hasBundledHarnessRuntime() }, () => {
  const result = spawnSync(getDefaultHarnessBinaryPath(), ['--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Usage of/);
});

test('root and subpackage exports match Python-style import paths', () => {
  assert.equal(typeof policy.allow, 'function');
  assert.equal(LocalAgentConfigFromLocal, LocalAgentConfig);
  assert.equal(typeof TestWebSocket, 'function');
  assert.equal(typeof TestLocalHarness, 'function');
});

test('local harness lower-camel stream events produce chunks and idle', async () => {
  const harness = new TestLocalHarness(createTestHarnessProcess());
  const conversation = new Conversation(harness.conn);
  await conversation.send('prompt');
  const chunksPromise = (async () => {
    const chunks: unknown[] = [];
    for await (const chunk of conversation.receiveChunks()) {
      chunks.push(chunk);
    }
    return chunks;
  })();

  await harness.sendEvent({
    stepUpdate: {
      cascadeId: 'traj-1',
      trajectoryId: 'traj-1',
      stepIndex: 1,
      state: 'STATE_ACTIVE',
      source: 'SOURCE_MODEL',
      target: 'TARGET_USER',
      thinking: 'thinking',
      thinkingDelta: 'thinking',
      text: 'answer',
      textDelta: 'answer'
    },
    usageMetadata: {
      promptTokenCount: 10,
      cachedContentTokenCount: 0,
      candidatesTokenCount: 2,
      thoughtsTokenCount: 1,
      totalTokenCount: 13
    }
  });
  await harness.sendEvent({
    trajectoryStateUpdate: {
      trajectoryId: 'traj-1',
      state: 'STATE_IDLE'
    }
  });

  const chunks = await chunksPromise;
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0] instanceof Thought);
  assert.equal((chunks[0] as Thought).text, 'thinking');
  assert.ok(chunks[1] instanceof Text);
  assert.equal((chunks[1] as Text).text, 'answer');
  assert.equal(harness.conn.isIdle, true);
});

test('Python-style aliases are available on public APIs', async () => {
  assert.deepEqual(BuiltinTools.read_only(), BuiltinTools.readOnly());
  assert.deepEqual(BuiltinTools.all_tools(), BuiltinTools.allTools());
  assert.deepEqual(BuiltinTools.file_tools(), BuiltinTools.fileTools());

  const capabilities = new CapabilitiesConfig({ enabledTools: [BuiltinTools.VIEW_FILE] });
  assert.deepEqual(capabilities.enabled_tools, [BuiltinTools.VIEW_FILE]);
  capabilities.finish_tool_schema_json = '{"type":"object"}';
  assert.equal(capabilities.finishToolSchemaJson, '{"type":"object"}');

  const generation = new GenerationConfig();
  generation.thinking_level = undefined;
  const modelEntry = new ModelEntry('gemini-test');
  modelEntry.api_key = 'model-key';
  assert.equal(modelEntry.apiKey, 'model-key');
  const modelConfig = new ModelConfig({ default: modelEntry });
  modelConfig.image_generation = 'image-test';
  assert.equal(modelConfig.imageGeneration.name, 'image-test');
  const gemini = new GeminiConfig();
  gemini.api_key = 'config-key';
  assert.equal(gemini.apiKey, 'config-key');

  const config = new LocalAgentConfig({ geminiConfig: gemini, capabilities });
  config.system_instructions = 'hello';
  config.mcp_servers = [];
  config.skills_paths = ['skills'];
  assert.equal(config.systemInstructions, 'hello');
  assert.deepEqual(config.mcpServers, []);
  assert.deepEqual(config.skillsPaths, ['skills']);
  assert.equal(config.api_key, 'config-key');

  const agent = new Agent(config);
  const hook = { preTurn: async () => ({ allow: true }) };
  agent.register_hook(hook);
  agent.register_trigger(async () => {});
  assert.equal(agent.is_started, false);

  const runner = new HookRunner();
  runner.register_hook(hook);
  assert.equal(runner.has_hooks, true);
  const preTurn = await runner.dispatch_pre_turn('prompt');
  assert.equal(preTurn.result.allow, true);
  await runner.dispatch_post_turn(preTurn.turnContext, 'response');

  const toolRunner = new ToolRunner();
  toolRunner.set_context({} as any);

  const mcpBridge = new McpBridge();
  assert.equal(typeof mcpBridge.connect_stdio, 'function');
  assert.equal(typeof mcpBridge.connect_sse, 'function');
  assert.equal(typeof mcpBridge.connect_streamable_http, 'function');

  assert.equal(async_input, async_input);
  assert.equal(run_interactive_loop, run_interactive_loop);
  assert.equal(on_file_change, on_file_change);
  assert.equal((trigger(async (_ctx) => {}) as any).__is_trigger__, true);
});

test('from_file resolves every supported media category by extension', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-types-'));
  try {
    const cases: Array<[string, string, Function]> = [
      ['image.bmp', 'image/bmp', Image],
      ['image.jpeg', 'image/jpeg', Image],
      ['image.png', 'image/png', Image],
      ['image.webp', 'image/webp', Image],
      ['doc.pdf', 'application/pdf', Document],
      ['doc.json', 'application/json', Document],
      ['doc.css', 'text/css', Document],
      ['doc.csv', 'text/csv', Document],
      ['doc.html', 'text/html', Document],
      ['doc.js', 'text/javascript', Document],
      ['doc.txt', 'text/plain', Document],
      ['doc.rtf', 'text/rtf', Document],
      ['doc.xml', 'text/xml', Document],
      ['audio.wav', 'audio/wav', Audio],
      ['audio.mp3', 'audio/mp3', Audio],
      ['audio.aac', 'audio/aac', Audio],
      ['audio.ogg', 'audio/ogg', Audio],
      ['audio.flac', 'audio/flac', Audio],
      ['audio.opus', 'audio/opus', Audio],
      ['audio.mpga', 'audio/mpeg', Audio],
      ['audio.m4a', 'audio/m4a', Audio],
      ['audio.l16', 'audio/l16', Audio],
      ['video.3gp', 'video/3gpp', Video],
      ['video.avi', 'video/avi', Video],
      ['video.mp4', 'video/mp4', Video],
      ['video.mpeg', 'video/mpeg', Video],
      ['video.mpg', 'video/mpg', Video],
      ['video.mov', 'video/quicktime', Video],
      ['video.webm', 'video/webm', Video],
      ['video.wmv', 'video/wmv', Video],
      ['video.flv', 'video/x-flv', Video]
    ];

    for (const [filename, mimeType, klass] of cases) {
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, 'x');
      const value = from_file(filePath);
      assert.ok(value instanceof (klass as any), filename);
      assert.equal(value.mime_type, mimeType, filename);
    }

    const unknownPath = path.join(dir, 'unknown.bin');
    fs.writeFileSync(unknownPath, 'x');
    assert.throws(() => from_file(unknownPath), /Could not infer a valid MIME type|Unsupported MIME type/);
    assert.throws(() => Image.from_file(unknownPath), /Unsupported Image MIME type/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
