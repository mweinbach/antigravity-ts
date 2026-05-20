import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolContext } from './tool_context.js';
import { ToolWithSchema, PythonTool } from './tool_runner.js';
import { defineTool, ToolDefinition } from './tool_definition.js';

export type { PythonTool };

/**
 * Attach JSON schema metadata to a plain function (Python-style custom tool).
 */
export function attachToolSchema(
  fn: Function,
  options: { name: string; description: string; parameters: Record<string, any> }
): Function {
  Object.defineProperty(fn, 'name', { value: options.name });
  (fn as any).description = options.description;
  (fn as any).parameters = options.parameters;
  return fn;
}

/**
 * Create a custom tool from a plain async function + JSON schema.
 * Mirrors passing a Python callable to LocalAgentConfig.tools.
 */
export function tool(
  name: string,
  description: string,
  parameters: Record<string, any>,
  fn: (args: Record<string, any>, ctx?: ToolContext) => any
): Function {
  return attachToolSchema(fn, { name, description, parameters });
}

/**
 * Create a custom tool from a Zod schema (TypeScript extension).
 */
export function zodTool<T extends z.ZodObject<any>>(
  name: string,
  description: string,
  parameters: T,
  fn: (args: z.infer<T>, ctx: ToolContext) => any
): ToolDefinition<T> {
  return defineTool({ name, description, parameters, execute: fn });
}

/**
 * Wrap a function with explicit JSON schema (mirrors ToolWithSchema).
 */
export function toolWithSchema(
  fn: (args: Record<string, any>, ctx?: ToolContext) => any,
  inputSchema: Record<string, any>,
  name?: string,
  description?: string
): ToolWithSchema {
  if (name) Object.defineProperty(fn, 'name', { value: name });
  if (description) (fn as any).description = description;
  return new ToolWithSchema(fn, inputSchema);
}

export function schemaFromZod(schema: z.ZodObject<any>): Record<string, any> {
  return zodToJsonSchema(schema as any, { target: 'openApi3' }) as Record<string, any>;
}
