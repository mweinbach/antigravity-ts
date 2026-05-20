import * as fs from 'fs';
import * as path from 'path';
import { Agent, LocalAgentConfig, triggerHelpers as trigger } from '../src/index.js';

// Define a periodic trigger that runs every 2 seconds
const periodicCheck = trigger.every('2s', async (ctx) => {
  console.log('\n[Trigger Fired] Checking system health...');
  await ctx.send('Generate a brief status log for system: "All services operational."');
});

// Define a file change trigger
const tempFile = path.resolve('temp_data.txt');
const fileWatcher = trigger.onFileChange(tempFile, async (ctx) => {
  console.log('\n[Trigger Fired] File temp_data.txt has changed!');
  await ctx.send('Explain why data in file has been updated.');
});

async function main() {
  // Create the temp file for the watch demo
  fs.writeFileSync(tempFile, 'Initial data', 'utf-8');

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: 'You are a logging assistant. Keep status logs concise.',
    triggers: [periodicCheck, fileWatcher]
  });

  console.log('Starting Agent with Triggers... (will run for 7 seconds)');
  const agent = new Agent(config);
  await agent.start();

  // Simulate file change after 3 seconds
  setTimeout(() => {
    console.log('\n[Simulating File Change] Writing to temp_data.txt...');
    fs.writeFileSync(tempFile, 'Updated data contents at ' + new Date().toISOString(), 'utf-8');
  }, 3000);

  // Wait 7 seconds then stop the agent session
  await new Promise(resolve => setTimeout(resolve, 7000));

  console.log('\nStopping Agent and cleaning up triggers...');
  await agent.stop();

  // Clean up temp file
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }
  console.log('Demo completed.');
}

main().catch(err => {
  console.error('Error:', err);
});
