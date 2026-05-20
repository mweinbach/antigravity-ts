import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolCall, ToolResult } from '../types.js';
import { ToolContext } from './tool_context.js';
import type { ToolDefinition } from './tool_definition.js';
import { defineTool, isToolDefinition } from './tool_definition.js';

export { ToolContext, defineTool };
export type { ToolDefinition };

export type PythonTool = Function | ToolDefinition | ToolWithSchema;

/**
 * Wrapper for callables with an explicit JSON Schema.
 * Mirrors google.antigravity.tools.tool_runner.ToolWithSchema.
 */
export class ToolWithSchema {
  public readonly name: string;
  public readonly description: string;

  constructor(
    public fn: (...args: any[]) => any,
    public inputSchema: Record<string, any>
  ) {
    this.name = fn.name;
    this.description = (fn as any).description || fn.name;
  }

  async call(args: Record<string, any>, ctx?: ToolContext): Promise<any> {
    return await this.fn(args, ctx);
  }
}

type RegisteredTool = ToolDefinition | Function | ToolWithSchema;

/**
 * Registry and executor for in-process tools.
 * Mirrors google.antigravity.tools.tool_runner.ToolRunner.
 */
export class ToolRunner {
  private toolsMap = new Map<string, RegisteredTool>();
  private contextParams = new Map<string, string>();
  private context?: ToolContext;

  constructor(tools: RegisteredTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  setContext(ctx: ToolContext): void {
    this.context = ctx;
  }

  register(tool: RegisteredTool, name?: string): void {
    const toolName = name || (tool as any).name;
    if (!toolName) {
      throw new Error('Tool must have a name.');
    }
    if (this.toolsMap.has(toolName)) {
      throw new Error(`Tool '${toolName}' is already registered.`);
    }
    this.toolsMap.set(toolName, tool);

    const ctxParam = findContextParam(tool);
    if (ctxParam) {
      this.contextParams.set(toolName, ctxParam);
    }
  }

  unregister(name: string): void {
    if (!this.toolsMap.has(name)) {
      throw new Error(`Tool '${name}' is not registered.`);
    }
    this.toolsMap.delete(name);
    this.contextParams.delete(name);
  }

  get toolNames(): string[] {
    return [...this.toolsMap.keys()];
  }

  /** Python alias */
  get tool_names(): string[] {
    return this.toolNames;
  }

  /** Copy of registered tools (Python ToolRunner.tools). */
  get tools(): Record<string, RegisteredTool> {
    return Object.fromEntries(this.toolsMap);
  }

  getPublicCallable(toolName: string): RegisteredTool {
    if (!this.toolsMap.has(toolName)) {
      throw new Error(`Tool '${toolName}' is not registered.`);
    }
    const tool = this.toolsMap.get(toolName)!;
    const ctxParam = this.contextParams.get(toolName);
    if (!ctxParam) {
      return tool;
    }
    return makePublicCallable(tool, ctxParam, toolName);
  }

  /** Python alias */
  get_public_callable(toolName: string): RegisteredTool {
    return this.getPublicCallable(toolName);
  }

  getHarnessToolProto(tool: RegisteredTool): { name: string; description: string; parameters_json_schema: string } {
    if (tool instanceof ToolWithSchema) {
      return {
        name: tool.name,
        description: tool.description || '',
        parameters_json_schema: JSON.stringify(tool.inputSchema)
      };
    }

    if (isToolDefinition(tool)) {
      const jsonSchema = zodToJsonSchema(tool.parameters, { target: 'openApi3' });
      return {
        name: tool.name,
        description: tool.description || '',
        parameters_json_schema: JSON.stringify(cleanGeminiSchema(jsonSchema))
      };
    }

    const publicTool = this.getPublicCallable((tool as any).name) as Function;
    const name = (tool as any).name;
    const description = (tool as any).description ?? publicTool?.name ?? `Executes function ${name}`;
    const parameters = (tool as any).parameters ?? { type: 'OBJECT', properties: {} };
    return {
      name,
      description,
      parameters_json_schema: JSON.stringify(cleanGeminiSchema(parameters))
    };
  }

  getHarnessToolProtos(): Array<{ name: string; description: string; parameters_json_schema: string }> {
    return [...this.toolsMap.values()].map(t => this.getHarnessToolProto(t));
  }

  async execute(toolName: string, args: Record<string, any> = {}): Promise<any> {
    return this.executeKwargs(toolName, args);
  }

  /** Python-style execute(tool_name, **kwargs) via a kwargs object. */
  async executeKwargs(toolName: string, kwargs: Record<string, any> = {}): Promise<any> {
    if (!this.toolsMap.has(toolName)) {
      throw new Error(`Tool '${toolName}' is not registered.`);
    }
    const injected = injectContext(toolName, kwargs, this.contextParams, this.context);
    return await executeFn(this.toolsMap.get(toolName)!, injected, this.context);
  }

  /** Python alias */
  async process_tool_calls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return this.processToolCalls(toolCalls);
  }

  async processToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map(tc => this.executeOne(tc)));
  }

  private async executeOne(tc: ToolCall): Promise<ToolResult> {
    try {
      if (!this.toolsMap.has(tc.name)) {
        return { name: tc.name, id: tc.id, error: `Unknown tool: '${tc.name}'` };
      }
      const injected = injectContext(tc.name, tc.args ?? {}, this.contextParams, this.context);
      const result = await executeFn(this.toolsMap.get(tc.name)!, injected, this.context);
      return { name: tc.name, id: tc.id, result };
    } catch (err: any) {
      return {
        name: tc.name,
        id: tc.id,
        error: err?.message || String(err),
        exception: err
      };
    }
  }
}

function getFunctionParamNames(fn: Function): string[] {
  if ((fn as any).__paramNames) {
    return (fn as any).__paramNames;
  }
  const src = fn.toString();
  const match = src.match(/\(([^)]*)\)/);
  if (!match || match[1].trim() === '') {
    return [];
  }
  return match[1]
    .split(',')
    .map(p => p.trim().split(':')[0].split('=')[0].trim())
    .filter(Boolean);
}

function findContextParam(tool: RegisteredTool): string | null {
  if (tool instanceof ToolWithSchema) return null;
  if (isToolDefinition(tool)) return 'ctx';

  const fn = tool as Function;
  if ((fn as any).__contextParam) {
    return (fn as any).__contextParam;
  }
  const params = getFunctionParamNames(fn);
  if (params.includes('ctx')) return 'ctx';
  if (params.includes('context')) return 'context';
  return null;
}

function makePublicCallable(tool: RegisteredTool, ctxParam: string, toolName: string): Function {
  const target = tool instanceof ToolWithSchema
    ? tool.fn
    : isToolDefinition(tool)
      ? tool.execute
      : (tool as Function);

  const proxy = async (...args: any[]) => {
    if (tool instanceof ToolWithSchema) {
      return tool.call(args[0] ?? {});
    }
    if (isToolDefinition(tool)) {
      return tool.execute(tool.parameters.parse(args[0] ?? {}), undefined as any);
    }
    const fn = tool as Function;
    const params = getFunctionParamNames(fn);
    if (params.length === 1 && params[0] !== ctxParam) {
      return fn(args[0]);
    }
    const kwargs: Record<string, any> = args[0] ?? {};
    const positional = params
      .filter(p => p !== ctxParam)
      .map(p => kwargs[p] ?? kwargs);
    return fn(...positional);
  };

  Object.defineProperty(proxy, 'name', { value: (target as any).name || toolName });
  if ((tool as any).description) {
    (proxy as any).description = (tool as any).description;
  }
  if ((tool as any).parameters) {
    (proxy as any).parameters = (tool as any).parameters;
  }
  (proxy as any).__hiddenContextParam = ctxParam;
  return proxy;
}

function injectContext(
  toolName: string,
  args: Record<string, any>,
  contextParams: Map<string, string>,
  context?: ToolContext
): Record<string, any> {
  const ctxParam = contextParams.get(toolName);
  if (ctxParam && context && !(ctxParam in args)) {
    return { ...args, [ctxParam]: context };
  }
  return args;
}

async function executeFn(tool: RegisteredTool, args: Record<string, any>, ctx?: ToolContext): Promise<any> {
  if (tool instanceof ToolWithSchema) {
    return await tool.call(args, ctx);
  }
  if (isToolDefinition(tool)) {
    const parsed = tool.parameters.parse(args);
    return await tool.execute(parsed, ctx!);
  }

  const fn = tool as Function;
  const params = getFunctionParamNames(fn);

  if (params.includes('ctx') || params.includes('context')) {
    const positional: any[] = [];
    if (params.length === 1) {
      positional.push(ctx);
    } else {
      for (const param of params) {
        if (param === 'ctx' || param === 'context') {
          positional.push(ctx);
        } else if (param) {
          positional.push(args[param] ?? args);
        }
      }
    }
    return await fn(...positional);
  }

  return await fn(args);
}

function cleanGeminiSchema(schema: any): any {
  const clean = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(clean);
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$schema' || key === 'additionalProperties' || key === '$ref' || key === 'definitions') continue;
      if (key === 'type' && typeof value === 'string') {
        result.type = value.toUpperCase();
      } else {
        result[key] = clean(value);
      }
    }
    return result;
  };
  return clean(schema);
}

/** Backward-compatible alias */
export { ToolRunner as ToolRegistry };
