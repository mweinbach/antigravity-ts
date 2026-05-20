import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface SkillMetadata {
  name: string;
  description: string;
  [key: string]: any;
}

/**
 * Skill represents a loaded Antigravity agent skill from a local directory.
 */
export class Skill {
  public name!: string;
  public description!: string;
  public instructions!: string;
  public metadata!: SkillMetadata;

  constructor(public skillDirectoryPath: string) {
    this.load();
  }

  /**
   * Load the skill from the directory.
   */
  private load() {
    const absPath = path.resolve(this.skillDirectoryPath);
    const skillMdPath = path.join(absPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`SKILL.md file not found in skill directory: ${absPath}`);
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8');

    // Regex to split YAML frontmatter from markdown body
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      throw new Error(`Invalid format in ${skillMdPath}. Frontmatter block --- must be present.`);
    }

    const frontmatterText = match[1];
    const instructionsText = match[2];

    try {
      const parsedYaml = yaml.load(frontmatterText) as SkillMetadata;
      if (!parsedYaml || !parsedYaml.name || !parsedYaml.description) {
        throw new Error('Skill name and description must be specified in frontmatter.');
      }
      this.metadata = parsedYaml;
      this.name = parsedYaml.name;
      this.description = parsedYaml.description;
      this.instructions = instructionsText.trim();
    } catch (err: any) {
      throw new Error(`Error parsing frontmatter in ${skillMdPath}: ${err.message}`);
    }
  }
}
