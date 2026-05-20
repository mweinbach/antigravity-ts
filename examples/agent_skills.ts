import * as fs from 'fs';
import * as path from 'path';
import { Agent, LocalAgentConfig, Skill } from '../src/index.js';

async function main() {
  const skillDir = path.resolve('temp_skill_demo');
  const skillMd = path.join(skillDir, 'SKILL.md');

  // Create temporary skill directory and SKILL.md
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  fs.writeFileSync(skillMd, `---
name: MathTutorSkill
description: A specialized skill for explaining math problems to students step by step.
version: 1.0.0
---
You are a friendly math tutor.
When explained a math problem:
1. Break down the solution step by step.
2. End with an encouraging message.
`, 'utf-8');

  console.log(`Loading Skill from folder: ${skillDir}...`);
  const mathSkill = new Skill(skillDir);

  console.log(`Loaded Skill Name: ${mathSkill.name}`);
  console.log(`Loaded Skill Description: ${mathSkill.description}`);

  const config = new LocalAgentConfig({
    model: 'gemini-3.5-flash',
    systemInstructions: mathSkill.instructions
  });

  await using agent = await Agent.open(config);

  const prompt = 'Solve 2x + 5 = 15';
  console.log(`\nUser: ${prompt}`);

  const response = await agent.chat(prompt);

  process.stdout.write('Agent: ');
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  // Clean up temporary skill dir
  if (fs.existsSync(skillMd)) {
    fs.unlinkSync(skillMd);
  }
  if (fs.existsSync(skillDir)) {
    fs.rmdirSync(skillDir);
  }
  console.log('\nDemo completed.');
}

main().catch(err => {
  console.error('Error:', err);
});
