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
  export function read_only(): BuiltinTools[] {
    return readOnly();
  }
  export function nondestructive(): BuiltinTools[] {
    return [...readOnly(), BuiltinTools.CREATE_FILE, BuiltinTools.EDIT_FILE, BuiltinTools.ASK_QUESTION, BuiltinTools.START_SUBAGENT, BuiltinTools.GENERATE_IMAGE];
  }
  export function allTools(): BuiltinTools[] {
    return Object.values(BuiltinTools).filter(v => typeof v === 'string') as BuiltinTools[];
  }
  export function all_tools(): BuiltinTools[] {
    return allTools();
  }
  export function none(): BuiltinTools[] {
    return [];
  }
  export function fileTools(): BuiltinTools[] {
    return [BuiltinTools.VIEW_FILE, BuiltinTools.CREATE_FILE, BuiltinTools.EDIT_FILE];
  }
  export function file_tools(): BuiltinTools[] {
    return fileTools();
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
    enable_subagents?: boolean;
    enabledTools?: BuiltinTools[];
    enabled_tools?: BuiltinTools[];
    disabledTools?: BuiltinTools[];
    disabled_tools?: BuiltinTools[];
    imageModel?: string;
    image_model?: string;
    compactionThreshold?: number;
    compaction_threshold?: number;
    finishToolSchemaJson?: string;
    finish_tool_schema_json?: string;
  } = {}) {
    const enabledTools = options.enabledTools ?? options.enabled_tools;
    const disabledTools = options.disabledTools ?? options.disabled_tools;
    if (enabledTools && disabledTools) {
      throw new Error('enabled_tools and disabled_tools should be mutually exclusive.');
    }
    this.enableSubagents = options.enableSubagents ?? options.enable_subagents ?? true;
    this.enabledTools = enabledTools;
    this.disabledTools = disabledTools;
    this.imageModel = options.imageModel ?? options.image_model ?? 'gemini-3.1-flash-image-preview';
    this.compactionThreshold = options.compactionThreshold ?? options.compaction_threshold;
    this.finishToolSchemaJson = options.finishToolSchemaJson ?? options.finish_tool_schema_json;
  }

  get enable_subagents(): boolean {
    return this.enableSubagents;
  }
  set enable_subagents(value: boolean) {
    this.enableSubagents = value;
  }

  get enabled_tools(): BuiltinTools[] | undefined {
    return this.enabledTools;
  }
  set enabled_tools(value: BuiltinTools[] | undefined) {
    this.enabledTools = value;
  }

  get disabled_tools(): BuiltinTools[] | undefined {
    return this.disabledTools;
  }
  set disabled_tools(value: BuiltinTools[] | undefined) {
    this.disabledTools = value;
  }

  get image_model(): string | undefined {
    return this.imageModel;
  }
  set image_model(value: string | undefined) {
    this.imageModel = value;
  }

  get compaction_threshold(): number | undefined {
    return this.compactionThreshold;
  }
  set compaction_threshold(value: number | undefined) {
    this.compactionThreshold = value;
  }

  get finish_tool_schema_json(): string | undefined {
    return this.finishToolSchemaJson;
  }
  set finish_tool_schema_json(value: string | undefined) {
    this.finishToolSchemaJson = value;
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
    system_instructions?: string | SystemInstructions;
    capabilities?: CapabilitiesConfig;
    tools?: any[];
    policies?: any[];
    hooks?: any[];
    triggers?: any[];
    mcpServers?: McpServerConfig[];
    mcp_servers?: McpServerConfig[];
    workspaces?: string[];
    conversationId?: string;
    conversation_id?: string;
    saveDir?: string;
    save_dir?: string;
    appDataDir?: string;
    app_data_dir?: string;
    responseSchema?: any;
    response_schema?: any;
    skillsPaths?: string[];
    skills_paths?: string[];
  } = {}) {
    this.systemInstructions = options.systemInstructions ?? options.system_instructions;
    this.capabilities = options.capabilities ?? new CapabilitiesConfig({ enabledTools: BuiltinTools.readOnly() });
    this.tools = options.tools ?? [];
    this.policies = options.policies ?? [];
    this.hooks = options.hooks ?? [];
    this.triggers = options.triggers ?? [];
    this.mcpServers = options.mcpServers ?? options.mcp_servers ?? [];
    this.workspaces = options.workspaces ?? [];
    this.conversationId = options.conversationId ?? options.conversation_id;
    this.saveDir = options.saveDir ?? options.save_dir;
    this.appDataDir = options.appDataDir ?? options.app_data_dir;
    this.responseSchema = options.responseSchema ?? options.response_schema;
    this.skillsPaths = options.skillsPaths ?? options.skills_paths ?? [];
  }

  get system_instructions(): string | SystemInstructions | undefined {
    return this.systemInstructions;
  }
  set system_instructions(value: string | SystemInstructions | undefined) {
    this.systemInstructions = value;
  }

  get mcp_servers(): McpServerConfig[] {
    return this.mcpServers;
  }
  set mcp_servers(value: McpServerConfig[]) {
    this.mcpServers = value;
  }

  get conversation_id(): string | undefined {
    return this.conversationId;
  }
  set conversation_id(value: string | undefined) {
    this.conversationId = value;
  }

  get save_dir(): string | undefined {
    return this.saveDir;
  }
  set save_dir(value: string | undefined) {
    this.saveDir = value;
  }

  get app_data_dir(): string | undefined {
    return this.appDataDir;
  }
  set app_data_dir(value: string | undefined) {
    this.appDataDir = value;
  }

  get response_schema(): any {
    return this.responseSchema;
  }
  set response_schema(value: any) {
    this.responseSchema = value;
  }

  get skills_paths(): string[] {
    return this.skillsPaths;
  }
  set skills_paths(value: string[]) {
    this.skillsPaths = value;
  }
}

/**
 * Interface for LocalAgentConfig options.
 */
export interface LocalAgentConfigOptions {
  model?: string;
  apiKey?: string;
  api_key?: string;
  geminiConfig?: GeminiConfig;
  gemini_config?: GeminiConfig;
  appDataDir?: string;
  app_data_dir?: string;
  saveDir?: string;
  save_dir?: string;
  conversationId?: string;
  conversation_id?: string;
  systemInstructions?: string | SystemInstructions;
  system_instructions?: string | SystemInstructions;
  tools?: any[];
  capabilities?: CapabilitiesConfig;
  policies?: any[];
  hooks?: any[];
  triggers?: any[];
  responseSchema?: any;
  response_schema?: any;
  mcpServers?: McpServerConfig[];
  mcp_servers?: McpServerConfig[];
  workspaces?: string[];
  skillsPaths?: string[];
  skills_paths?: string[];
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

  get api_key(): string | undefined {
    return this.apiKey;
  }
  set api_key(value: string | undefined) {
    this.geminiConfig.apiKey = value;
  }

  get gemini_config(): GeminiConfig {
    return this.geminiConfig;
  }
  set gemini_config(value: GeminiConfig) {
    this.geminiConfig = value;
  }

  constructor(options: LocalAgentConfigOptions = {}) {
    super({
      systemInstructions: options.systemInstructions ?? options.system_instructions,
      capabilities: options.capabilities ?? new CapabilitiesConfig(),
      tools: options.tools,
      policies: options.policies,
      hooks: options.hooks,
      triggers: options.triggers,
      responseSchema: options.responseSchema ?? options.response_schema,
      mcpServers: options.mcpServers ?? options.mcp_servers,
      workspaces: options.workspaces,
      conversationId: options.conversationId ?? options.conversation_id,
      saveDir: options.saveDir ?? options.save_dir,
      appDataDir: options.appDataDir ?? options.app_data_dir,
      skillsPaths: options.skillsPaths ?? options.skills_paths
    });

    const geminiConfig = options.geminiConfig ?? options.gemini_config;
    const apiKey = options.apiKey ?? options.api_key;
    this.geminiConfig = geminiConfig
      ? structuredClone(geminiConfig)
      : new GeminiConfig({ apiKey: apiKey ?? process.env.GEMINI_API_KEY });

    if (options.model) {
      if (geminiConfig?.models?.default) {
        throw new Error("Cannot set both 'model' shorthand and 'geminiConfig.models.default'. Use one or the other.");
      }
      this.geminiConfig.models.default = new ModelEntry(options.model);
    } else if (!geminiConfig) {
      this.geminiConfig.models.default = new ModelEntry(options.model ?? DEFAULT_MODEL);
    }

    if (apiKey && geminiConfig?.apiKey) {
      throw new Error("Cannot set both 'apiKey' shorthand and 'geminiConfig.apiKey'. Use one or the other.");
    }
    if (apiKey) {
      this.geminiConfig.apiKey = apiKey;
    }

    // App Data Directory Setup
    let rawAppDataDir = options.appDataDir ?? options.app_data_dir;
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

  create_strategy(toolRunner: ToolRunner, hookRunner: HookRunner): LocalConnectionStrategy {
    return this.createStrategy(toolRunner, hookRunner);
  }
}
