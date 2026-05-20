import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../src/agent.js';
import { LocalAgentConfig, CapabilitiesConfig, BuiltinTools } from '../src/config.js';
import { StepSource, StepStatus } from '../src/types.js';
import { allow, deny } from '../src/hooks/policy.js';

// Load .env manually if process.env.GEMINI_API_KEY is not set
if (!process.env.GEMINI_API_KEY) {
  try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/GEMINI_API_KEY=(.*)/);
      if (match && match[1]) {
        process.env.GEMINI_API_KEY = match[1].trim();
      }
    }
  } catch (err) {
    console.warn('Could not read .env file:', err);
  }
}

const runLiveAgentTests = Boolean(process.env.GEMINI_API_KEY) && process.env.RUN_LIVE_ANTIGRAVITY_TESTS === '1';

test('Agent lifecycle and connection handshake', { skip: !runLiveAgentTests }, async (t) => {
  const saveDir = path.resolve('temp_test_session');
  if (fs.existsSync(saveDir)) {
    fs.rmSync(saveDir, { recursive: true, force: true });
  }

  const config = new LocalAgentConfig({
    apiKey: process.env.GEMINI_API_KEY,
    saveDir,
    capabilities: new CapabilitiesConfig({
      enableSubagents: false,
      disabledTools: [BuiltinTools.RUN_COMMAND] // Disable run_command by default
    })
  });

  const agent = new Agent(config);
  
  // Record hook invocations
  const hookCalls: string[] = [];
  agent.registerHook({
    onSessionStart() {
      hookCalls.push('onSessionStart');
    },
    onSessionEnd() {
      hookCalls.push('onSessionEnd');
    },
    preTurn(ctx: any, prompt: string) {
      hookCalls.push(`preTurn:${prompt}`);
    },
    postTurn(ctx: any, responseText: string) {
      hookCalls.push(`postTurn:${responseText}`);
    }
  });

  await t.test('Should start session, run onSessionStart, and connect', async () => {
    await agent.start();
    assert.strictEqual(agent.isStarted, true);
    assert.ok(hookCalls.includes('onSessionStart'));
  });

  await t.test('Should execute a simple chat prompt', async () => {
    // Send a simple prompt that shouldn't require tool calls
    const response = await agent.chat('Respond with exactly "Hello from Test Suite!"');
    const text = await response.text();
    console.log('Agent Response:', text);
    assert.ok(text.toLowerCase().includes('hello'));
    
    // Check hook execution
    assert.ok(hookCalls.some(h => h.startsWith('preTurn:')));
    assert.ok(hookCalls.some(h => h.startsWith('postTurn:')));
  });

  await t.test('Should stop session, run onSessionEnd, and clean up', async () => {
    await agent.stop();
    assert.strictEqual(agent.isStarted, false);
    assert.ok(hookCalls.includes('onSessionEnd'));
    
    if (fs.existsSync(saveDir)) {
      fs.rmSync(saveDir, { recursive: true, force: true });
    }
  });
});

test('Agent policy engine evaluation', { skip: !runLiveAgentTests }, async (t) => {
  const saveDir = path.resolve('temp_policy_test');
  if (fs.existsSync(saveDir)) {
    fs.rmSync(saveDir, { recursive: true, force: true });
  }

  const config = new LocalAgentConfig({
    apiKey: process.env.GEMINI_API_KEY,
    saveDir,
    policies: [
      deny('run_command'), // Block run_command
      allow('view_file')   // Allow view_file
    ]
  });

  const agent = new Agent(config);
  await agent.start();

  await t.test('Should block denied tool calls', async () => {
    const decision = await agent.evaluateSafetyPolicy({
      id: 'test-1',
      name: 'run_command',
      args: { CommandLine: 'ls' }
    });
    assert.strictEqual(decision.action, 'deny');
  });

  await t.test('Should allow explicitly approved tool calls', async () => {
    const decision = await agent.evaluateSafetyPolicy({
      id: 'test-2',
      name: 'view_file',
      args: { AbsolutePath: '/foo/bar' }
    });
    assert.strictEqual(decision.action, 'allow');
  });

  await agent.stop();
  if (fs.existsSync(saveDir)) {
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});
