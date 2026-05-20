import { exec } from 'child_process';
import { z } from 'zod';
import { defineTool } from '../registry.js';

export const runCommand = defineTool({
  name: 'run_command',
  description: 'Execute a shell command on the user\'s local system.',
  parameters: z.object({
    commandLine: z.string().optional().describe('The command to run in the shell.'),
    command: z.string().optional().describe('The command to run in the shell (alternative name).'),
    CommandLine: z.string().optional().describe('The command to run in the shell (alternative name).'),
    cwd: z.string().optional().describe('The working directory in which to execute the command.')
  }),
  execute: async (args: any) => {
    const cmd = args.commandLine || args.command || args.CommandLine;
    if (!cmd) {
      throw new Error('No command provided to run_command.');
    }
    return new Promise((resolve, reject) => {
      exec(
        cmd,
        { cwd: args.cwd || process.cwd() },
        (error, stdout, stderr) => {
          // Resolve even if command exits with error, matching normal terminal behavior
          // where stderr and exit code are returned as part of the execution result.
          const output = `stdout:\n${stdout}\nstderr:\n${stderr}`;
          if (error) {
            resolve(`${output}\n[Command exited with error code: ${error.code}]`);
          } else {
            resolve(output);
          }
        }
      );
    });
  }
});
