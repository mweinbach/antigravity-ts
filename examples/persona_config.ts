import {
  Agent,
  LocalAgentConfig,
  TemplatedSystemInstructions,
  CustomSystemInstructions
} from '../src/index.js';

async function testTemplatedPersona() {
  console.log('--- Testing TemplatedSystemInstructions ---');
  // Define persona (identity) while retaining safety & operational guidelines
  const templatedSI = new TemplatedSystemInstructions(
    'You are a helpful assistant that speaks like a pirate.'
  );

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: templatedSI
  });

  await using agent = await Agent.open(config);
  const response = await agent.chat('Hello! Who are you?');

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

async function testAppendedStringPersona() {
  console.log('--- Testing Simple String System Instructions (Append) ---');
  // Simple string gets appended to the default instructions
  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: 'Always respond in pirate slang.'
  });

  await using agent = await Agent.open(config);
  const response = await agent.chat('Hello!');

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

async function testCustomPersona() {
  console.log('--- Testing CustomSystemInstructions (Overwrite) ---');
  // Custom system instructions completely overwrite default safety and mandates
  const customSI = new CustomSystemInstructions(
    "You are a minimal assistant. You only answer with 'Yes' or 'No'."
  );

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: customSI
  });

  await using agent = await Agent.open(config);
  const response = await agent.chat('Is the sky blue?');

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

async function testTemplatedWithSections() {
  console.log('--- Testing TemplatedSystemInstructions with Sections ---');
  // Templated instructions using both identity override and appended sections
  const sections = [
    { title: 'tone_guideline', content: 'Always respond in pirate slang and end with Yo-ho-ho!' }
  ];
  const templatedSI = new TemplatedSystemInstructions(
    'You are a sailing advisor.',
    sections
  );

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: templatedSI
  });

  await using agent = await Agent.open(config);
  const response = await agent.chat('Hello!');

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

async function main() {
  await testTemplatedPersona();
  await testAppendedStringPersona();
  await testCustomPersona();
  await testTemplatedWithSections();
}

main().catch(err => {
  console.error('Error:', err);
});
