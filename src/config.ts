import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  TemplatedSystemInstructions,
  CustomSystemInstructions,
  SystemInstructionSection,
  McpServerConfig,
  AntigravityValidationError,
  GeminiConfig,
  ModelEntry,
  DEFAULT_MODEL
} from './types.js';
import { confirm_run_command, workspace_only } from './hooks/policy.js';
import { LocalConnectionStrategy } from './connections/local/local_connection.js';
import { ToolRunner } from './tools/tool_runner.js';
import { HookRunner } from './hooks/hook_runner.js';

/** Default app data directory (Python DEFAULT_APP_DATA_DIR). */
export const DEFAULT_APP_DATA_DIR = path.join(os.homedir(), '.gemini', 'antigravity');

/**
 * Enums for built-in tools.
 */
export enum BuiltinTools {
  LIST_DIR = 'list_directory',
  SEARCH_DIR = 'search_directory',
  FIND_FILE = 'find_file',
  VIEW_FILE = 'view_file',
  FINISH = 'finish',
  CREATE_FILE = 'create_file',
  EDIT_FILE = 'edit_file',
  RUN_COMMAND = 'run_command',
  ASK_QUESTION = 'ask_question',
  START_SUBAGENT = 'start_subagent',
  GENERATE_IMAGE = 'generate_image'
}

export namespace BuiltinTools {
  export function readOnly(): BuiltinTools[] {
    return [BuiltinTools.LIST_DIR, BuiltinTools.SEARCH_DIR, BuiltinTools.FIND_FILE, BuiltinTools.VIEW_FILE, BuiltinTools.FINISH];
  }
  export function nondestructive(): BuiltinTools[] {
    return [...readOnly(), BuiltinTools.CREATE_FILE, BuiltinTools.EDIT_FILE, BuiltinTools.ASK_QUESTION, BuiltinTools.START_SUBAGENT, BuiltinTools.GENERATE_IMAGE];
  }
  export function allTools(): BuiltinTools[] {
    return Object.values(BuiltinTools).filter(v => typeof v === 'string') as BuiltinTools[];
  }
  export function none(): BuiltinTools[] {
    return [];
  }
  export function fileTools(): BuiltinTools[] {
    return [BuiltinTools.VIEW_FILE, BuiltinTools.CREATE_FILE, BuiltinTools.EDIT_FILE];
  }
}

/**
 * Capabilities configuration for the agent.
 */
export class CapabilitiesConfig {
  public enableSubagents: boolean;
  public enabledTools?: BuiltinTools[];
  public disabledTools?: BuiltinTools[];
  public imageModel?: string;
  public compactionThreshold?: number;
  public finishToolSchemaJson?: string;

  constructor(options: {
    enableSubagents?: boolean;
    enabledTools?: BuiltinTools[];
    disabledTools?: BuiltinTools[];
    imageModel?: string;
    compactionThreshold?: number;
    finishToolSchemaJson?: string;
  } = {}) {
    if (options.enabledTools && options.disabledTools) {
      throw new Error('enabled_tools and disabled_tools should be mutually exclusive.');
    }
    this.enableSubagents = options.enableSubagents ?? true;
    this.enabledTools = options.enabledTools;
    this.disabledTools = options.disabledTools;
    this.imageModel = options.imageModel ?? 'gemini-3.1-flash-image-preview';
    this.compactionThreshold = options.compactionThreshold;
    this.finishToolSchemaJson = options.finishToolSchemaJson;
  }
}

export type SystemInstructions = CustomSystemInstructions | TemplatedSystemInstructions;

function normalizeResponseSchema(schema: any): string | undefined {
  if (schema == null) return undefined;
  if (typeof schema === 'string') {
    JSON.parse(schema);
    return schema;
  }
  if (schema instanceof z.ZodType) {
    return JSON.stringify(zodToJsonSchema(schema as any));
  }
  if (typeof schema === 'object') {
    return JSON.stringify(schema);
  }
  throw new Error('Unsupported response_schema format. Expected JSON string, object, or Zod schema.');
}

/**
 * Abstract base for agent configuration (mirrors Python AgentConfig).
 */
export abstract class AgentConfig {
  public systemInstructions?: string | SystemInstructions;
  public capabilities: CapabilitiesConfig;
  public tools: any[];
  public policies: any[];
  public hooks: any[];
  public triggers: any[];
  public mcpServers: McpServerConfig[];
  public workspaces: string[];
  public conversationId?: string;
  public saveDir?: string;
  public appDataDir?: string;
  public responseSchema?: any;
  public skillsPaths: string[];

  constructor(options: {
    systemInstructions?: string | SystemInstructions;
    capabilities?: CapabilitiesConfig;
    tools?: any[];
    policies?: any[];
    hooks?: any[];
    triggers?: any[];
    mcpServers?: McpServerConfig[];
    workspaces?: string[];
    conversationId?: string;
    saveDir?: string;
    appDataDir?: string;
    responseSchema?: any;
    skillsPaths?: string[];
  } = {}) {
    this.systemInstructions = options.systemInstructions;
    this.capabilities = options.capabilities ?? new CapabilitiesConfig({ enabledTools: BuiltinTools.readOnly() });
    this.tools = options.tools ?? [];
    this.policies = options.policies ?? [];
    this.hooks = options.hooks ?? [];
    this.triggers = options.triggers ?? [];
    this.mcpServers = options.mcpServers ?? [];
    this.workspaces = options.workspaces ?? [];
    this.conversationId = options.conversationId;
    this.saveDir = options.saveDir;
    this.appDataDir = options.appDataDir;
    this.responseSchema = options.responseSchema;
    this.skillsPaths = options.skillsPaths ?? [];
  }
}

/**
 * Interface for LocalAgentConfig options.
 */
export interface LocalAgentConfigOptions {
  model?: string;
  apiKey?: string;
  geminiConfig?: GeminiConfig;
  appDataDir?: string;
  saveDir?: string;
  conversationId?: string;
  systemInstructions?: string | SystemInstructions;
  tools?: any[];
  capabilities?: CapabilitiesConfig;
  policies?: any[];
  hooks?: any[];
  triggers?: any[];
  responseSchema?: any;
  mcpServers?: McpServerConfig[];
  workspaces?: string[];
  skillsPaths?: string[];
}

/**
 * LocalAgentConfig holds the complete settings for the Agent run.
 */
export class LocalAgentConfig extends AgentConfig {
  public geminiConfig: GeminiConfig;

  /** Resolved default model name */
  get model(): string {
    return this.geminiConfig.models.default.name;
  }

  /** Resolved API key (config or env) */
  get apiKey(): string | undefined {
    return this.geminiConfig.models.default.apiKey ?? this.geminiConfig.apiKey ?? process.env.GEMINI_API_KEY;
  }

  constructor(options: LocalAgentConfigOptions = {}) {
    super({
      systemInstructions: options.systemInstructions,
      capabilities: options.capabilities ?? new CapabilitiesConfig(),
      tools: options.tools,
      policies: options.policies,
      hooks: options.hooks,
      triggers: options.triggers,
      responseSchema: options.responseSchema,
      mcpServers: options.mcpServers,
      workspaces: options.workspaces,
      conversationId: options.conversationId,
      saveDir: options.saveDir,
      appDataDir: options.appDataDir,
      skillsPaths: options.skillsPaths
    });

    this.geminiConfig = options.geminiConfig
      ? structuredClone(options.geminiConfig)
      : new GeminiConfig({ apiKey: options.apiKey ?? process.env.GEMINI_API_KEY });

    if (options.model) {
      if (options.geminiConfig?.models?.default) {
        throw new Error("Cannot set both 'model' shorthand and 'geminiConfig.models.default'. Use one or the other.");
      }
      this.geminiConfig.models.default = new ModelEntry(options.model);
    } else if (!options.geminiConfig) {
      this.geminiConfig.models.default = new ModelEntry(options.model ?? DEFAULT_MODEL);
    }

    if (options.apiKey && options.geminiConfig?.apiKey) {
      throw new Error("Cannot set both 'apiKey' shorthand and 'geminiConfig.apiKey'. Use one or the other.");
    }
    if (options.apiKey) {
      this.geminiConfig.apiKey = options.apiKey;
    }

    // App Data Directory Setup
    let rawAppDataDir = options.appDataDir;
    if (!rawAppDataDir) {
      this.appDataDir = DEFAULT_APP_DATA_DIR;
    } else {
      if (rawAppDataDir.startsWith('~/') || !path.isAbsolute(rawAppDataDir)) {
        throw new AntigravityValidationError(
          `app_data_dir must be an absolute path. Got: "${rawAppDataDir}"`
        );
      }
      this.appDataDir = rawAppDataDir;
    }

    // Default workspaces
    this.workspaces = options.workspaces ?? [process.cwd()];

    // Default policies: confirm_run_command()
    let initialPolicies = options.policies ?? confirm_run_command();

    // Prepend workspace scoping policies if workspaces are set
    if (this.workspaces.length > 0) {
      const resolvedAppDataDir = path.resolve(this.appDataDir);
      const allowedPaths = [...this.workspaces, resolvedAppDataDir];
      const workspacePolicies = workspace_only(allowedPaths);
      initialPolicies = [...workspacePolicies, ...initialPolicies];
    }
    this.policies = initialPolicies;

    // response_schema → finish_tool_schema_json
    if (this.responseSchema) {
      this.capabilities.finishToolSchemaJson = normalizeResponseSchema(this.responseSchema);
    }
  }

  /** Resolve save_dir, creating a temp directory when unset (Python parity). */
  resolveSaveDir(): string {
    if (this.saveDir) {
      if (!fs.existsSync(this.saveDir)) {
        fs.mkdirSync(this.saveDir, { recursive: true });
      }
      return this.saveDir;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity_'));
    this.saveDir = tmp;
    return tmp;
  }

  /** Normalize string system instructions to TemplatedSystemInstructions. */
  resolveSystemInstructions(): SystemInstructions | undefined {
    if (!this.systemInstructions) return undefined;
    if (typeof this.systemInstructions === 'string') {
      return new TemplatedSystemInstructions(undefined, [
        new SystemInstructionSection(this.systemInstructions)
      ]);
    }
    return this.systemInstructions;
  }

  /**
   * Creates the ConnectionStrategy for this config.
   * Mirrors LocalAgentConfig.create_strategy() in Python.
   */
  createStrategy(toolRunner: ToolRunner, hookRunner: HookRunner): LocalConnectionStrategy {
    return new LocalConnectionStrategy(this, toolRunner, hookRunner);
  }
}
