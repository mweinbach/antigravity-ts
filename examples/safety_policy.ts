import { Agent, LocalAgentConfig, SafetyPolicy } from '../src/index.js';

async function main() {
  const policy = new SafetyPolicy();

  // 1. Block command execution containing 'rm'
  policy.deny('run_command', (args) => {
    const cmd = args.commandLine || args.command || args.CommandLine || '';
    return cmd.includes('rm');
  });

  // 2. Ask user confirmation for other shell commands
  policy.askUser('run_command', {
    handler: async (tc: any) => {
      const cmd = tc.args?.commandLine || tc.args?.command || tc.args?.CommandLine || '';
      console.log(`\n[Safety Policy Handler] tc: ${JSON.stringify(tc)}`);
      console.log(`\n[Safety Policy Handler] Reviewing command: "${cmd}"`);
      // Auto-approve for demo, or prompt. We'll approve commands starting with 'echo' or 'ls'
      const approved = cmd.trim().startsWith('echo') || cmd.trim().startsWith('ls');
      console.log(`[Safety Policy Handler] Decision: ${approved ? 'APPROVED' : 'REJECTED'}`);
      return approved;
    }
  });

  // 3. Restrict file tools to the temporary or project directory
  policy.workspaceOnly('create_file', [process.cwd()]);

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: 'You are a devops engineer helper. Run echo commands to report status.',
    policies: [policy]
  });

  await using agent = await Agent.open(config);

  // Test 1: Allowed / Ask user (approved command)
  const prompt1 = 'Run a command to print "Hello from container" using echo.';
  console.log(`\nUser: ${prompt1}`);
  const response1 = await agent.chat(prompt1);
  for await (const chunk of response1) {
    process.stdout.write(chunk);
  }
  console.log();

  // Test 2: Blocked command (contains 'rm')
  const prompt2 = 'Run command: rm -rf dist';
  console.log(`\nUser: ${prompt2}`);
  const response2 = await agent.chat(prompt2);
  for await (const chunk of response2) {
    process.stdout.write(chunk);
  }
  console.log();
}

main().catch(err => {
  console.error('Error:', err);
});
