import { z } from 'zod';
import { ToolContext } from './tool_context.js';

export interface ToolDefinition<T extends z.ZodObject<any> = any> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<any> | any;
}

export function defineTool<T extends z.ZodObject<any>>(config: ToolDefinition<T>): ToolDefinition<T> {
  return config;
}

export function isToolDefinition(tool: any): tool is ToolDefinition {
  return tool && typeof tool === 'object' && 'parameters' in tool && 'execute' in tool;
}
