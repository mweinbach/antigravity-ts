// Root package exports (mirrors google.antigravity __init__.py + common submodules)
export * from './types.js';
export * from './config.js';
export * from './agent.js';
export * from './connection.js';
export * from './conversation.js';
export * from './tools/index.js';
export * from './hooks/index.js';
export * from './triggers/index.js';
export * from './mcp/index.js';
export * from './skills/index.js';
export * from './utils/interactive.js';
export * from './connections/local/index.js';

export { ToolContext } from './tools/tool_context.js';
export { ToolRunner, ToolWithSchema, PythonTool } from './tools/tool_runner.js';
export { defineTool, type ToolDefinition } from './tools/tool_definition.js';
export { tool, zodTool, toolWithSchema, attachToolSchema, schemaFromZod } from './tools/custom_tool.js';
export { HookRunner } from './hooks/hook_runner.js';
export {
  InspectHook,
  DecideHook,
  TransformHook,
  preTurn,
  pre_turn,
  postTurn,
  post_turn,
  preToolCallDecide,
  pre_tool_call_decide,
  postToolCall,
  post_tool_call,
  onToolError,
  on_tool_error,
  onInteraction,
  on_interaction,
  onCompaction,
  on_compaction,
  onSessionStart,
  on_session_start,
  onSessionEnd,
  on_session_end,
  type HookKind,
  type Hook as HookBase,
  type PreToolCallDecideHook,
  type PreTurnHook,
  type PostTurnHook,
  type PostToolCallHook,
  type OnToolErrorHook,
  type OnInteractionHook,
  type OnCompactionHook,
  type OnSessionStartHook,
  type OnSessionEndHook
} from './hooks/hooks.js';
export {
  PolicyDecideHook,
  PolicyEnforcer,
  isPolicyDecideHook,
  enforce,
  enforceHook,
  allow,
  deny,
  ask_user,
  askUser,
  allow_all,
  allowAll,
  deny_all,
  denyAll,
  safe_defaults,
  safeDefaults,
  confirm_run_command,
  confirmRunCommand,
  workspace_only,
  workspaceOnly,
  Decision,
  type Policy
} from './hooks/policy.js';
export { TriggerRunner } from './triggers/trigger_runner.js';
export { McpBridge, getMcpTools, get_mcp_tools } from './mcp/index.js';
export { getDefaultHarnessBinaryPath } from './connections/local/harness_binary.js';

// Explicit re-exports matching Python google.antigravity.__all__
export { Agent } from './agent.js';
export { AgentConfig, LocalAgentConfig, CapabilitiesConfig, BuiltinTools, DEFAULT_APP_DATA_DIR } from './config.js';
export {
  GeminiConfig,
  GenerationConfig,
  ModelConfig,
  ModelEntry,
  ThinkingLevel,
  UsageMetadata,
  DEFAULT_MODEL,
  DEFAULT_IMAGE_GENERATION_MODEL,
  SUPPORTED_IMAGE_MIMES,
  SUPPORTED_DOCUMENT_MIMES,
  SUPPORTED_AUDIO_MIMES,
  SUPPORTED_VIDEO_MIMES,
  fromFile,
  from_file
} from './types.js';
export { Conversation } from './conversation.js';
