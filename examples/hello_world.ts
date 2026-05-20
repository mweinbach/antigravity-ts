import { Agent, LocalAgentConfig } from '../src/index.js';

async function main() {
  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: 'You are a helpful assistant.'
  });

  console.log('Initializing Agent...');
  await using agent = await Agent.open(config);

  console.log('\nSending message: "Explain quantum computing in one short sentence."\n');
  const response = await agent.chat('Explain quantum computing in one short sentence.');

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  // Print final usage metadata
  const usage = agent.conversation.totalUsage;
  console.log('\nUsage Stats:');
  console.log(`- Prompt Tokens: ${usage.promptTokenCount}`);
  console.log(`- Candidates Tokens: ${usage.candidatesTokenCount}`);
  console.log(`- Thinking Tokens: ${usage.thoughtsTokenCount}`);
  console.log(`- Total Tokens: ${usage.totalTokenCount}`);
}

main().catch(err => {
  console.error('Error:', err);
});
