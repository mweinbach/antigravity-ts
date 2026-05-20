import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { defineTool } from '../registry.js';

/**
 * Helper to check if file/directory is inside allowed workspaces (to be used by safety policy).
 */
export function isPathInWorkspaces(targetPath: string, workspaces: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);
  return workspaces.some(workspace => {
    const resolvedWorkspace = path.resolve(workspace);
    const relative = path.relative(resolvedWorkspace, resolvedTarget);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}

export const listDirectory = defineTool({
  name: 'list_directory',
  description: 'List contents of a directory (files and subdirectories).',
  parameters: z.object({
    directoryPath: z.string().describe('The absolute path of the directory to list.')
  }),
  execute: async ({ directoryPath }) => {
    const absPath = path.resolve(directoryPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Directory does not exist: ${absPath}`);
    }
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${absPath}`);
    }

    const files = fs.readdirSync(absPath);
    const results = files.map(file => {
      const filePath = path.join(absPath, file);
      try {
        const fileStat = fs.statSync(filePath);
        return {
          name: file,
          isDirectory: fileStat.isDirectory(),
          sizeBytes: fileStat.size,
          mtime: fileStat.mtime
        };
      } catch (err) {
        return {
          name: file,
          isDirectory: false,
          sizeBytes: 0,
          error: 'Permission denied'
        };
      }
    });

    return results;
  }
});

export const searchDirectory = defineTool({
  name: 'search_directory',
  description: 'Searches for a specific query or regex pattern within text files in a directory.',
  parameters: z.object({
    directoryPath: z.string().describe('The absolute path of the directory to search.'),
    query: z.string().describe('The text query or regex pattern to search for.'),
    recursive: z.boolean().optional().default(true).describe('Whether to search subdirectories recursively.')
  }),
  execute: async ({ directoryPath, query, recursive }) => {
    const absPath = path.resolve(directoryPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Directory does not exist: ${absPath}`);
    }

    const matches: Array<{ file: string; line: number; content: string }> = [];
    const regex = new RegExp(query, 'i');

    const search = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            if (recursive) search(filePath);
          } else {
            // Check if text file (simplistic extension check)
            const ext = path.extname(filePath).toLowerCase();
            const isText = ['.txt', '.js', '.ts', '.json', '.md', '.py', '.html', '.css', '.yaml', '.yml', '.toml'].includes(ext);
            if (isText) {
              const content = fs.readFileSync(filePath, 'utf-8');
              const lines = content.split('\n');
              lines.forEach((line, index) => {
                if (regex.test(line)) {
                  matches.push({
                    file: path.relative(absPath, filePath),
                    line: index + 1,
                    content: line.trim()
                  });
                }
              });
            }
          }
        } catch (err) {
          // Ignore files we cannot access
        }
      }
    };

    search(absPath);
    return matches.slice(0, 100); // limit to 100 matches
  }
});

export const findFile = defineTool({
  name: 'find_file',
  description: 'Finds files in a directory that match a glob or name pattern.',
  parameters: z.object({
    directoryPath: z.string().describe('The absolute path of the directory to search.'),
    pattern: z.string().describe('The filename pattern (e.g. "*.json" or "config").')
  }),
  execute: async ({ directoryPath, pattern }) => {
    const absPath = path.resolve(directoryPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Directory does not exist: ${absPath}`);
    }

    const matches: string[] = [];
    const cleanPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(`^${cleanPattern}$`, 'i');

    const search = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            search(filePath);
          } else {
            if (regex.test(file) || file.toLowerCase().includes(pattern.toLowerCase())) {
              matches.push(path.relative(absPath, filePath));
            }
          }
        } catch (err) {
          // Ignore
        }
      }
    };

    search(absPath);
    return matches;
  }
});

export const viewFile = defineTool({
  name: 'view_file',
  description: 'View the contents of a file. Supports viewing a specific line range.',
  parameters: z.object({
    filePath: z.string().describe('The absolute path to the file to view.'),
    startLine: z.number().optional().describe('The starting line number to view (1-indexed).'),
    endLine: z.number().optional().describe('The ending line number to view (1-indexed).')
  }),
  execute: async ({ filePath, startLine, endLine }) => {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`File does not exist: ${absPath}`);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    const start = startLine ? Math.max(0, startLine - 1) : 0;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;

    return lines.slice(start, end).join('\n');
  }
});

export const createFile = defineTool({
  name: 'create_file',
  description: 'Creates a new file with the specified content.',
  parameters: z.object({
    filePath: z.string().describe('The absolute path to the file to create.'),
    content: z.string().describe('The text content to write to the file.')
  }),
  execute: async ({ filePath, content }) => {
    const absPath = path.resolve(filePath);
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(absPath, content, 'utf-8');
    return `File created successfully at ${absPath}`;
  }
});

export const editFile = defineTool({
  name: 'edit_file',
  description: 'Edits an existing file by replacing a unique block of target content with replacement content.',
  parameters: z.object({
    filePath: z.string().describe('The absolute path of the file to edit.'),
    targetContent: z.string().describe('The exact block of text to be replaced (must match exactly and be unique).'),
    replacementContent: z.string().describe('The content to replace the target content with.')
  }),
  execute: async ({ filePath, targetContent, replacementContent }) => {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`File does not exist: ${absPath}`);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    
    // Check if targetContent exists uniquely
    const occurrences = content.split(targetContent).length - 1;
    if (occurrences === 0) {
      throw new Error('Target content was not found in the file. Ensure whitespace, indentation and characters match exactly.');
    }
    if (occurrences > 1) {
      throw new Error(`Target content was found ${occurrences} times. It must be unique to avoid incorrect edits.`);
    }

    const newContent = content.replace(targetContent, replacementContent);
    fs.writeFileSync(absPath, newContent, 'utf-8');
    return `File edited successfully at ${absPath}`;
  }
});
