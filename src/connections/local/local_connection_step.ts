import {
  Step,
  StepType,
  StepSource,
  StepTarget,
  StepStatus,
  ToolCall,
  UsageMetadata
} from '../../types.js';
import { ToolRunner, ToolWithSchema } from '../../tools/tool_runner.js';
import type { ToolDefinition } from '../../tools/tool_definition.js';

export const DEFAULT_HOST_TOOL_NAME = 'pre_request_host_tool_request';

const SOURCE_MAP: Record<string, StepSource> = {
  SOURCE_SYSTEM: StepSource.SYSTEM,
  SOURCE_USER: StepSource.USER,
  SOURCE_MODEL: StepSource.MODEL
};

const STATUS_MAP: Record<string, StepStatus> = {
  STATE_ACTIVE: StepStatus.ACTIVE,
  STATE_DONE: StepStatus.DONE,
  STATE_WAITING_FOR_USER: StepStatus.WAITING_FOR_USER,
  STATE_ERROR: StepStatus.ERROR
};

export const BUILTIN_TOOL_PROTO_FIELDS: Record<string, string> = {
  create_file: 'create_file',
  edit_file: 'edit_file',
  find_file: 'find_file',
  list_directory: 'list_directory',
  run_command: 'run_command',
  search_directory: 'search_directory',
  view_file: 'view_file',
  invoke_subagent: 'invoke_subagent',
  generate_image: 'generate_image',
  finish: 'finish'
};

export const PROTO_FIELDS_TO_BUILTIN_TOOL: Record<string, string> = {
  create_file: 'create_file',
  edit_file: 'edit_file',
  find_file: 'find_file',
  list_directory: 'list_directory',
  run_command: 'run_command',
  search_directory: 'search_directory',
  view_file: 'view_file',
  invoke_subagent: 'start_subagent',
  generate_image: 'generate_image',
  finish: 'finish'
};

/** Normalizes wire-format file paths (mirrors normalize_wire_path in Python). */
export function normalizeWirePath(p: string): string {
  if (p.startsWith('file://')) {
    try {
      const url = new URL(p);
      return decodeURIComponent(url.pathname);
    } catch {
      return p;
    }
  }
  return p;
}

/** @deprecated Use normalizeWirePath */
export const normalize_wire_path = normalizeWirePath;

function makeStepId(trajectoryId: string, stepIndex: number): string {
  return trajectoryId ? `${trajectoryId}:${stepIndex}` : String(stepIndex);
}

export interface LocalConnectionStep extends Step {
  cascadeId?: string;
  cascade_id?: string;
  trajectoryId?: string;
  trajectory_id?: string;
  httpCode?: number;
  http_code?: number;
}

/**
 * Connection-specific step for LocalConnection.
 * Mirrors google.antigravity.connections.local.local_connection.LocalConnectionStep.
 */
export class LocalConnectionStepImpl implements LocalConnectionStep {
  id = '';
  stepIndex = 0;
  step_index?: number;
  type: StepType = StepType.UNKNOWN;
  source: StepSource = StepSource.UNKNOWN;
  target: StepTarget = StepTarget.UNKNOWN;
  status: StepStatus = StepStatus.UNKNOWN;
  content = '';
  contentDelta?: string;
  content_delta?: string;
  thinking = '';
  thinkingDelta?: string;
  thinking_delta?: string;
  toolCalls: ToolCall[] = [];
  tool_calls?: ToolCall[];
  error = '';
  isCompleteResponse?: boolean;
  is_complete_response?: boolean;
  structuredOutput?: any;
  structured_output?: any;
  usageMetadata?: UsageMetadata;
  usage_metadata?: UsageMetadata;
  cascadeId = '';
  cascade_id?: string;
  trajectoryId = '';
  trajectory_id?: string;
  httpCode = 0;
  http_code?: number;
  wireTarget = '';

  static fromDict(stepDict: Record<string, any>, usageMetadata?: Record<string, any>): LocalConnectionStepImpl {
    const trajId = stepDict.trajectory_id || '';
    const stepIdx = stepDict.step_index ?? 0;
    const idStr = makeStepId(trajId, stepIdx);

    let activeToolName = '';
    let activeToolArgs: Record<string, any> = {};
    for (const [protoField, fieldName] of Object.entries(BUILTIN_TOOL_PROTO_FIELDS)) {
      if (stepDict[fieldName] !== undefined && stepDict[fieldName] !== null) {
        activeToolName = PROTO_FIELDS_TO_BUILTIN_TOOL[protoField] || protoField;
        activeToolArgs = stepDict[fieldName];
        break;
      }
    }

    const toolCalls: ToolCall[] = [];
    if (activeToolName) {
      let canonicalPath: string | undefined;
      for (const pathKey of ['path', 'file_path', 'TargetFile', 'directory_path']) {
        if (activeToolArgs[pathKey] && typeof activeToolArgs[pathKey] === 'string') {
          const normalized = normalizeWirePath(activeToolArgs[pathKey]);
          activeToolArgs[pathKey] = normalized;
          canonicalPath = normalized;
        }
      }
      toolCalls.push({
        id: idStr,
        name: activeToolName,
        args: activeToolArgs,
        canonicalPath
      });
    }

    let stepType = StepType.UNKNOWN;
    if (stepDict.compaction !== undefined && stepDict.compaction !== null) {
      stepType = StepType.COMPACTION;
    } else if (stepDict.finish !== undefined && stepDict.finish !== null) {
      stepType = StepType.FINISH;
    } else if (activeToolName || Object.values(BUILTIN_TOOL_PROTO_FIELDS).some(k => stepDict[k] != null)) {
      stepType = StepType.TOOL_CALL;
    } else if (stepDict.text) {
      stepType = StepType.TEXT_RESPONSE;
    }

    const source = SOURCE_MAP[stepDict.source] || StepSource.UNKNOWN;
    const status = STATUS_MAP[stepDict.state] || StepStatus.UNKNOWN;
    const isFromModel = source === StepSource.MODEL;
    const isDone = status === StepStatus.DONE;
    const hasText = !!stepDict.text;
    const isTargetUser = stepDict.target === 'TARGET_USER';
    const isCompleteResponse = isFromModel && isDone && hasText && isTargetUser;

    let structuredOutput: any = null;
    if (stepType === StepType.FINISH) {
      const outputString = stepDict.finish?.output_string;
      if (outputString) {
        try {
          structuredOutput = JSON.parse(outputString);
        } catch {
          // ignore parse errors
        }
      }
    }

    const errorField = stepDict.error || {};
    const errorMsg = errorField.error_message || '';
    const httpCode = errorField.http_code || 0;

    let usage: UsageMetadata | undefined;
    if (usageMetadata) {
      usage = {
        promptTokenCount: usageMetadata.prompt_token_count ?? 0,
        cachedContentTokenCount: usageMetadata.cached_content_token_count ?? 0,
        candidatesTokenCount: usageMetadata.candidates_token_count ?? 0,
        thoughtsTokenCount: usageMetadata.thoughts_token_count ?? 0,
        totalTokenCount: usageMetadata.total_token_count ?? 0
      };
    }

    const step = new LocalConnectionStepImpl();
    step.id = idStr;
    step.stepIndex = stepIdx;
    step.step_index = stepIdx;
    step.type = stepType;
    step.source = source;
    step.target = isTargetUser
      ? StepTarget.USER
      : stepDict.target === 'TARGET_ENVIRONMENT'
        ? StepTarget.ENVIRONMENT
        : StepTarget.UNSPECIFIED;
    step.status = status;
    step.content = stepDict.text || '';
    step.contentDelta = stepDict.text_delta || '';
    step.content_delta = step.contentDelta;
    step.thinking = stepDict.thinking || '';
    step.thinkingDelta = stepDict.thinking_delta || '';
    step.thinking_delta = step.thinkingDelta;
    step.toolCalls = toolCalls;
    step.tool_calls = toolCalls;
    step.error = errorMsg;
    step.isCompleteResponse = isCompleteResponse;
    step.is_complete_response = isCompleteResponse;
    step.structuredOutput = structuredOutput;
    step.structured_output = structuredOutput;
    step.usageMetadata = usage;
    step.usage_metadata = usage;
    step.cascadeId = stepDict.cascade_id || '';
    step.cascade_id = step.cascadeId;
    step.trajectoryId = trajId;
    step.trajectory_id = trajId;
    step.httpCode = httpCode;
    step.http_code = httpCode;
    step.wireTarget = stepDict.target || '';
    return step;
  }
}

/** @deprecated Use LocalConnectionStepImpl.fromDict */
export const LocalConnectionStep = LocalConnectionStepImpl;

/** Converts a callable to a harness Tool proto shape (mirrors callable_to_tool_proto). */
export function callableToToolProto(
  fn: Function | ToolWithSchema | ToolDefinition,
  toolRunner?: ToolRunner
): { name: string; description: string; parameters_json_schema: string } {
  if (toolRunner) {
    const name = (fn as any).name;
    if (name && toolRunner.toolNames.includes(name)) {
      return toolRunner.getHarnessToolProto(toolRunner.getPublicCallable(name));
    }
  }

  const runner = new ToolRunner();
  runner.register(fn as any);
  return runner.getHarnessToolProto(fn as any);
}

/** @deprecated Use callableToToolProto */
export const callable_to_tool_proto = callableToToolProto;
