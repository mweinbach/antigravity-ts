import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { AsyncQueue } from '../../utils/queue.js';
import { Connection, ConnectionStrategy } from '../../connection.js';
import {
  Step,
  StepType,
  StepSource,
  StepTarget,
  StepStatus,
  ToolCall,
  ToolResult,
  AskQuestionInteractionSpec,
  QuestionHookResult,
  UsageMetadata,
  AntigravityConnectionError,
  AntigravityValidationError,
  CustomSystemInstructions,
  TemplatedSystemInstructions
} from '../../types.js';
import { encodeInputConfig, decodeOutputConfig } from './protobuf.js';
import { LocalAgentConfig } from '../../config.js';
import { ToolRunner } from '../../tools/tool_runner.js';
import { HookRunner, TurnContext, OperationContext } from '../../hooks/hook_runner.js';
import { getDefaultHarnessBinaryPath } from './harness_binary.js';
import {
  DEFAULT_HOST_TOOL_NAME,
  LocalConnectionStepImpl,
  normalizeWirePath,
  BUILTIN_TOOL_PROTO_FIELDS,
  PROTO_FIELDS_TO_BUILTIN_TOOL
} from './local_connection_step.js';

function makeStepId(trajectoryId: string, stepIndex: number): string {
  return trajectoryId ? `${trajectoryId}:${stepIndex}` : String(stepIndex);
}

class StepTracker {
  state: string = 'STATE_UNSPECIFIED';
  handledRequests: Set<string> = new Set();

  updateState(newState: string) {
    if (this.state === 'STATE_WAITING_FOR_USER' && newState !== 'STATE_WAITING_FOR_USER') {
      this.handledRequests.clear();
    }
    this.state = newState;
  }

  markHandled(requestType: string): boolean {
    if (this.handledRequests.has(requestType)) {
      return false;
    }
    this.handledRequests.add(requestType);
    return true;
  }
}

const STATUS_MAP: Record<string, StepStatus> = {
  'STATE_ACTIVE': StepStatus.ACTIVE,
  'STATE_DONE': StepStatus.DONE,
  'STATE_WAITING_FOR_USER': StepStatus.WAITING_FOR_USER,
  'STATE_ERROR': StepStatus.ERROR,
};

const IDLE_SENTINEL = Symbol('IDLE_SENTINEL');

function toSnakeCaseKey(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function normalizeWireEvent(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWireEvent(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = toSnakeCaseKey(key);
    if (
      normalizedKey !== key &&
      Object.prototype.hasOwnProperty.call(normalized, normalizedKey)
    ) {
      continue;
    }
    normalized[normalizedKey] = normalizeWireEvent(child);
  }
  return normalized;
}

export class LocalConnection implements Connection {
  public stepQueue = new AsyncQueue<Step | typeof IDLE_SENTINEL | Error>();
  private stepTrackers = new Map<string, StepTracker>();
  private activeSubagentIds = new Set<string>();
  private subagentResponses = new Map<string, string>();
  private parentIdle = true;
  private cascadeId = '';
  private disconnecting = false;
  private isReceiving = false;
  private isIdleResolver?: () => void;
  private isIdlePromise?: Promise<void>;
  private _isIdle = true;
  private stderrLines: string[] = [];
  private pendingBuiltinToolCalls = new Map<string, { toolCall: ToolCall; opContext: OperationContext }>();
  private wsReaderPromise?: Promise<void>;
  private activePrompt: any = null;
  private currentTurnContext: TurnContext | null = null;

  constructor(
    private process: ChildProcess,
    private ws: any,
    private toolRunner?: ToolRunner,
    private hookRunner?: HookRunner
  ) {
    this._isIdle = true;
    this.wsReaderPromise = this.wsReaderLoop();
    this.startStderrReader();
  }

  get isIdle(): boolean {
    return this._isIdle;
  }

  get is_idle(): boolean {
    return this.isIdle;
  }

  get conversationId(): string {
    return this.cascadeId || '';
  }

  get conversation_id(): string {
    return this.conversationId;
  }

  private setIdle(idle: boolean) {
    this._isIdle = idle;
    if (idle && this.isIdleResolver) {
      this.isIdleResolver();
      this.isIdleResolver = undefined;
      this.isIdlePromise = undefined;
    }
  }

  async waitForIdle(): Promise<void> {
    if (this._isIdle) return;
    if (!this.isIdlePromise) {
      this.isIdlePromise = new Promise<void>((resolve) => {
        this.isIdleResolver = resolve;
      });
    }
    await this.isIdlePromise;
  }

  async wait_for_idle(): Promise<void> {
    return this.waitForIdle();
  }

  async waitForWakeup(timeout: number = 300): Promise<boolean> {
    // Harness events are processed reactively
    return false;
  }

  async wait_for_wakeup(timeout: number = 300): Promise<boolean> {
    return this.waitForWakeup(timeout);
  }

  async signalIdle(): Promise<void> {
    this.setIdle(true);
  }

  async signal_idle(): Promise<void> {
    return this.signalIdle();
  }

  private getTurnContext(): TurnContext {
    return this.currentTurnContext ?? new TurnContext(this.hookRunner!.sessionContext);
  }

  private startStderrReader() {
    this.process.stderr?.on('data', (chunk) => {
      const dataStr = chunk.toString('utf8');
      const lines = dataStr.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.stderrLines.push(line.trim());
          if (this.stderrLines.length > 100) {
            this.stderrLines.shift();
          }
        }
      }
    });
  }

  async send(prompt: any, options?: any): Promise<void> {
    this.activePrompt = prompt;
    this.disconnecting = false;
    this.setIdle(false);
    this.parentIdle = false;
    this.activeSubagentIds.clear();
    this.subagentResponses.clear();

    if (this.hookRunner) {
      const { result, turnContext } = await this.hookRunner.dispatchPreTurn(prompt);
      this.currentTurnContext = turnContext;
      if (!result.allow) {
        const reason = result.message || 'Turn execution denied by hook.';
        this.stepQueue.push({
          id: 'pre_turn_denied',
          stepIndex: 0,
          type: StepType.SYSTEM_MESSAGE,
          source: StepSource.SYSTEM,
          target: StepTarget.USER,
          status: StepStatus.CANCELED,
          content: reason,
          thinking: '',
          toolCalls: [],
          error: reason
        });
        this.setIdle(true);
        return;
      }
    }

    let inputEvent: any = {};
    if (prompt === null || prompt === undefined) {
      inputEvent = { user_input: '' };
    } else if (typeof prompt === 'string') {
      inputEvent = { user_input: prompt };
    } else {
      // Support complex content parts
      const parts = Array.isArray(prompt) ? prompt : [prompt];
      const protoParts = parts.map((p) => {
        if (typeof p === 'string') {
          return { text: p };
        }
        if (p && typeof p === 'object' && typeof (p as any).toPart === 'function') {
          const part = (p as any).toPart();
          if (part.inlineData) {
            return {
              media: {
                mime_type: part.inlineData.mimeType,
                data: part.inlineData.data,
                description: part.description || ''
              }
            };
          }
          return part;
        }
        if (p.inlineData) {
          return {
            media: {
              mime_type: p.inlineData.mimeType,
              data: p.inlineData.data,
              description: p.description || ''
            }
          };
        }
        return { text: String(p) };
      });
      inputEvent = {
        complex_user_input: {
          parts: protoParts
        }
      };
    }

    this.ws.send(JSON.stringify(inputEvent));
  }

  async cancel(): Promise<void> {
    this.ws.send(JSON.stringify({ halt_request: true }));
  }

  async delete(): Promise<void> {
    await this.disconnect();
  }

  async disconnect(): Promise<void> {
    this.disconnecting = true;
    if (this.hookRunner) {
      try {
        await this.hookRunner.dispatchSessionEnd();
      } catch (err) {
        console.error('Error in onSessionEnd hook:', err);
      }
    }

    this.stepQueue.close();

    try {
      this.ws.close();
    } catch {}

    if (this.process) {
      try {
        this.process.stdin?.end();
      } catch {}

      // Graceful wait 2 seconds, then kill
      await new Promise<void>((resolve) => {
        let exited = false;
        const timer = setTimeout(() => {
          if (!exited) {
            this.process.kill('SIGTERM');
            const killTimer = setTimeout(() => {
              if (!exited) {
                this.process.kill('SIGKILL');
              }
            }, 1000);
            killTimer.unref();
          }
        }, 2000);
        timer.unref();

        this.process.on('exit', () => {
          exited = true;
          resolve();
        });
      });
    }
  }

  async *receiveSteps(): AsyncIterable<Step> & AsyncIterator<Step> {
    if (this.isReceiving) {
      throw new Error('Concurrent receiveSteps() calls are not supported on this connection.');
    }
    this.isReceiving = true;
    const iterator = this.stepQueue[Symbol.asyncIterator]();

    try {
      while (true) {
        if (this.isIdle && this.stepQueue.length === 0) {
          return;
        }

        const nextRes = await iterator.next();
        if (nextRes.done) {
          return;
        }

        const stepObj = nextRes.value;
        if (stepObj === IDLE_SENTINEL) {
          continue;
        }
        if (stepObj instanceof Error) {
          throw stepObj;
        }

        yield stepObj as Step;

        // Propagate postTurn hook when parent model final step completes
        const isFromModel = (stepObj as Step).source === StepSource.MODEL;
        const isDone = (stepObj as Step).status === StepStatus.DONE;
        const isTerminal = isDone || (stepObj as Step).status === StepStatus.ERROR || (stepObj as Step).status === StepStatus.CANCELED;
        const isTargetUser = (stepObj as Step).target === StepTarget.USER;

        if (isTerminal && isTargetUser && isFromModel) {
          if (this.hookRunner && this.currentTurnContext) {
            await this.hookRunner.dispatchPostTurn(this.currentTurnContext, (stepObj as Step).content);
            this.currentTurnContext = null;
          }
        }
      }
    } finally {
      this.isReceiving = false;
    }
  }

  receive_steps(): AsyncIterable<Step> & AsyncIterator<Step> {
    return this.receiveSteps();
  }

  private async wsReaderLoop() {
    this.ws.onmessage = async (event: any) => {
      try {
        const eventData = JSON.parse(event.data);
        await this.handleOutputEvent(eventData);
      } catch (err) {
        console.error('Error in wsReaderLoop handler:', err);
      }
    };

    this.ws.onerror = (err: any) => {
      if (!this.disconnecting) {
        this.stepQueue.push(new AntigravityConnectionError(`WebSocket error: ${err.message || err}`));
      }
    };

    this.ws.onclose = () => {
      if (!this.disconnecting) {
        const tail = this.stderrLines.join('\n') || '(no stderr output)';
        this.stepQueue.push(
          new AntigravityConnectionError(`Harness process exited unexpectedly.\nStderr:\n${tail}`)
        );
      }
    };
  }

  private async handleOutputEvent(rawEvent: any) {
    const event = normalizeWireEvent(rawEvent);

    if (event.step_update) {
      const su = event.step_update;
      const trajectoryId = su.trajectory_id || '';
      const stepIndex = su.step_index ?? 0;
      const stepKey = `${trajectoryId}:${stepIndex}`;

      if (!this.stepTrackers.has(stepKey)) {
        this.stepTrackers.set(stepKey, new StepTracker());
      }
      const tracker = this.stepTrackers.get(stepKey)!;
      tracker.updateState(su.state || 'STATE_UNSPECIFIED');

      if (su.cascade_id && su.cascade_id === su.trajectory_id) {
        this.cascadeId = su.cascade_id;
      }

      // Parse step
      const parsedStep = this.parseStepUpdate(su, event.usage_metadata);
      this.stepQueue.push(parsedStep);

      if (parsedStep.type === StepType.COMPACTION && this.hookRunner) {
        this.hookRunner.dispatchCompaction(this.getTurnContext(), parsedStep).catch(console.error);
      }

      // Track subagent responses
      const isSubagent = this.cascadeId && trajectoryId && trajectoryId !== this.cascadeId;
      if (isSubagent && parsedStep.source === StepSource.MODEL && parsedStep.content) {
        this.subagentResponses.set(trajectoryId, parsedStep.content);
      }

      // Check approved built-in tool transitions to completed or error
      if (this.pendingBuiltinToolCalls.has(stepKey)) {
        const state = su.state;
        if (state === 'STATE_DONE') {
          const pending = this.pendingBuiltinToolCalls.get(stepKey)!;
          this.pendingBuiltinToolCalls.delete(stepKey);
          if (this.hookRunner) {
            const extracted = this.extractToolResult(su);
            const toolRes: ToolResult = {
              name: pending.toolCall.name,
              id: pending.toolCall.id,
              result: extracted ?? parsedStep.content
            };
            this.hookRunner.dispatchPostToolCall(pending.opContext, toolRes).catch(console.error);
          }
        } else if (state === 'STATE_ERROR') {
          const pending = this.pendingBuiltinToolCalls.get(stepKey)!;
          this.pendingBuiltinToolCalls.delete(stepKey);
          if (this.hookRunner) {
            const errMsg = su.error_message || parsedStep.content || 'Built-in tool failed';
            this.hookRunner.dispatchOnToolError(pending.opContext, new Error(errMsg)).catch(console.error);
          }
        }
      }

      // Process waiting states
      if (su.state === 'STATE_WAITING_FOR_USER') {
        if (su.questions_request) {
          if (tracker.markHandled('questions_request')) {
            this.handleQuestionRequest(su).catch(console.error);
          }
        }
        if (su.tool_confirmation_request) {
          if (tracker.markHandled('tool_confirmation_request')) {
            this.handleToolConfirmationRequest(su).catch(console.error);
          }
        }
      }
    } else if (event.trajectory_state_update) {
      const tsu = event.trajectory_state_update;
      const trajectoryId = tsu.trajectory_id;
      const isSubagent = this.cascadeId && trajectoryId !== this.cascadeId;

      if (tsu.state === 'STATE_RUNNING') {
        if (isSubagent) {
          this.activeSubagentIds.add(trajectoryId);
        }
      } else if (tsu.state === 'STATE_IDLE') {
        if (isSubagent) {
          this.activeSubagentIds.delete(trajectoryId);
          if (this.hookRunner) {
            const subagentResponse = this.subagentResponses.get(trajectoryId) || '';
            this.subagentResponses.delete(trajectoryId);
            const toolRes: ToolResult = {
              name: 'start_subagent',
              result: subagentResponse || trajectoryId
            };
            const opContext = new OperationContext(this.getTurnContext());
            this.hookRunner.dispatchPostToolCall(opContext, toolRes).catch(console.error);
          }
        } else {
          this.parentIdle = true;
        }

        if (this.parentIdle && this.activeSubagentIds.size === 0) {
          this.setIdle(true);
          this.stepQueue.push(IDLE_SENTINEL);
        }
      }
    } else if (event.tool_call) {
      this.handleHostToolCall(event.tool_call).catch(console.error);
    }
  }

  private parseStepUpdate(su: any, usageMetadata?: any): Step {
    return LocalConnectionStepImpl.fromDict(su, usageMetadata);
  }

  private extractToolResult(su: any): any {
    if (su.run_command?.combined_output) {
      return su.run_command.combined_output;
    }
    if (su.list_directory?.results) {
      return {
        entries: su.list_directory.results.map((r: any) => ({
          name: r.name,
          is_directory: !!r.is_directory,
          file_size: r.file_size ?? 0
        }))
      };
    }
    if (su.find_file?.output) {
      return su.find_file.output;
    }
    if (su.search_directory?.num_results !== undefined) {
      return { num_results: su.search_directory.num_results };
    }
    if (su.edit_file?.diff_block) {
      return su.text || '';
    }
    if (su.generate_image?.image_name) {
      return su.generate_image.image_name;
    }
    return null;
  }

  private async handleQuestionRequest(su: any) {
    const questionsList: any[] = [];
    const indicesToHook: number[] = [];

    const reqQuestions = su.questions_request.questions || [];
    reqQuestions.forEach((uq: any, i: number) => {
      if (uq.multiple_choice) {
        const mc = uq.multiple_choice;
        const opts = (mc.choices || []).map((choice: string, j: number) => ({
          id: String(j + 1),
          text: choice
        }));
        questionsList.push({
          question: mc.question,
          options: opts
        });
        indicesToHook.push(i);
      }
    });

    const answers = reqQuestions.map(() => ({ unanswered: true }));

    if (this.hookRunner && questionsList.length > 0) {
      try {
        const { response: finalRes } = await this.hookRunner.dispatchInteraction(
          this.getTurnContext(),
          { questions: questionsList } as AskQuestionInteractionSpec
        );

        if (finalRes && finalRes.responses) {
          finalRes.responses.forEach((r, idx) => {
            const origIdx = indicesToHook[idx];
            if (r.skipped) {
              answers[origIdx] = { unanswered: true };
            } else {
              const selectedIds = r.selectedOptionIds || r.selected_option_ids || [];
              const indices = selectedIds.map(optId => parseInt(optId) - 1).filter(idx => !isNaN(idx));
              const freeform = r.freeformResponse || r.freeform_response || '';

              answers[origIdx] = {
                multiple_choice_answer: {
                  selected_choice_indices: indices,
                  freeform_response: freeform
                }
              } as any;
            }
          });
        }
      } catch (err) {
        console.error('Error handling interaction hook:', err);
      }
    }

    // Send back answers
    const resp = {
      trajectory_id: su.trajectory_id,
      step_index: su.step_index,
      response: {
        answers
      }
    };
    this.ws.send(JSON.stringify({ question_response: resp }));
  }

  private async handleToolConfirmationRequest(su: any) {
    let actionStr = 'unknown';
    let args: any = {};
    let foundAction = false;

    for (const field in BUILTIN_TOOL_PROTO_FIELDS) {
      if (su[field] !== undefined && su[field] !== null) {
        actionStr = PROTO_FIELDS_TO_BUILTIN_TOOL[field] || field;
        foundAction = true;
        args = { ...su[field] };
        break;
      }
    }

    if (!foundAction) {
      actionStr = DEFAULT_HOST_TOOL_NAME;
    }

    if (su.request_text) {
      args.request_text = su.request_text;
    }

    let canonicalPath: string | undefined;
    for (const k of ['path', 'file_path', 'TargetFile', 'directory_path']) {
      if (args[k] && typeof args[k] === 'string') {
        const norm = normalizeWirePath(args[k]);
        args[k] = norm;
        canonicalPath = norm;
      }
    }

    const stepId = makeStepId(su.trajectory_id, su.step_index);
    const tc: ToolCall = {
      id: stepId,
      name: actionStr,
      args,
      canonicalPath
    };

    let allow = true;
    let opContext: OperationContext | undefined;

    if (tc.name === DEFAULT_HOST_TOOL_NAME) {
      allow = true;
    } else if (this.hookRunner) {
      const pre = await this.hookRunner.dispatchPreToolCall(this.getTurnContext(), tc);
      allow = pre.result.allow;
      opContext = pre.opContext;
    }

    if (allow && tc.name !== DEFAULT_HOST_TOOL_NAME && this.hookRunner && opContext) {
      this.pendingBuiltinToolCalls.set(stepId, { toolCall: tc, opContext });
    }

    // Send confirmation
    const resp = {
      trajectory_id: su.trajectory_id,
      step_index: su.step_index,
      accepted: allow
    };
    this.ws.send(JSON.stringify({ tool_confirmation: resp }));
  }

  private async handleHostToolCall(toolCall: any) {
    const args = JSON.parse(toolCall.arguments_json || '{}');
    const tc: ToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      args
    };

    const tcStep: Step = {
      id: toolCall.id,
      stepIndex: 1,
      type: StepType.TOOL_CALL,
      source: StepSource.MODEL,
      target: StepTarget.ENVIRONMENT,
      status: StepStatus.ACTIVE,
      content: '',
      thinking: '',
      toolCalls: [tc],
      error: ''
    };
    this.stepQueue.push(tcStep);

    let opContext: OperationContext | undefined;

    if (this.hookRunner) {
      const pre = await this.hookRunner.dispatchPreToolCall(this.getTurnContext(), tc);
      opContext = pre.opContext;
      if (!pre.result.allow) {
        const reason = pre.result.message || 'No reason provided';
        await this.sendToolResults([{
          name: tc.name,
          id: tc.id,
          error: `Tool execution denied by hook policy: ${reason}`
        }]);
        return;
      }
      tc.name = pre.toolCall.name;
      tc.args = pre.toolCall.args;
    }

    let result: ToolResult;

    if (this.toolRunner) {
      const results = await this.toolRunner.processToolCalls([{ name: tc.name, args: tc.args }]);
      result = { ...results[0], id: toolCall.id };

      if (result.error && this.hookRunner) {
        if (!opContext) {
          opContext = new OperationContext(this.getTurnContext());
        }
        const { recovery } = await this.hookRunner.dispatchOnToolError(
          opContext,
          result.exception || new Error(result.error)
        );
        if (recovery !== null && recovery !== undefined) {
          result = { name: tc.name, id: tc.id, result: recovery };
        }
      } else if (this.hookRunner && opContext) {
        await this.hookRunner.dispatchPostToolCall(opContext, result);
      }
    } else {
      result = {
        name: tc.name,
        id: tc.id,
        error: `Unknown tool: '${tc.name}'`
      };
    }

    await this.sendToolResults([result]);
  }

  async sendToolResults(results: ToolResult[]): Promise<void> {
    for (const res of results) {
      if (!res.id) {
        throw new Error(`ToolResult for '${res.name}' is missing an id.`);
      }

      let responseVal = res.result;
      if (res.error) {
        responseVal = { error: res.error };
      } else if (responseVal && typeof responseVal === 'object') {
        // Already structured
      } else {
        responseVal = { result: responseVal };
      }

      const response = {
        id: res.id,
        response_json: JSON.stringify(responseVal)
      };

      this.ws.send(JSON.stringify({
        tool_response: response
      }));
    }
  }

  async send_tool_results(results: ToolResult[]): Promise<void> {
    return this.sendToolResults(results);
  }

  async sendTriggerNotification(content: string): Promise<void> {
    this.ws.send(JSON.stringify({
      automated_trigger: content
    }));
  }

  async send_trigger_notification(content: string): Promise<void> {
    return this.sendTriggerNotification(content);
  }
}

export class LocalConnectionStrategy implements ConnectionStrategy {
  private childProcess?: ChildProcess;
  private wsClient?: any;
  private connection?: LocalConnection;

  constructor(
    private config: LocalAgentConfig,
    private toolRunner?: ToolRunner,
    private hookRunner?: HookRunner,
    private binaryPath?: string
  ) {}

  connect(): Connection {
    if (!this.connection) {
      throw new Error('Connection not established. Use within async context manager or connect strategy lifecycle.');
    }
    return this.connection;
  }

  async start(): Promise<LocalConnection> {
    const apiKey = this.config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AntigravityValidationError(
        'A Gemini API key is required. Set it via LocalAgentConfig({apiKey: ...}) or the GEMINI_API_KEY environment variable.'
      );
    }

    const saveDir = this.config.resolveSaveDir();
    const toolProtos = this.toolRunner?.getHarnessToolProtos() ?? [];

    let systemInstructionsProto: any = null;
    const sysInstructions = this.config.resolveSystemInstructions();
    if (sysInstructions) {
      if (sysInstructions instanceof CustomSystemInstructions) {
        systemInstructionsProto = {
          custom: {
            part: [{ text: sysInstructions.text }]
          }
        };
      } else if (sysInstructions instanceof TemplatedSystemInstructions) {
        systemInstructionsProto = {
          appended: {
            custom_identity: sysInstructions.identity || '',
            appended_sections: (sysInstructions.sections || []).map((sec) => ({
              title: sec.title,
              content: sec.content
            }))
          }
        };
      } else if (typeof sysInstructions === 'string') {
        systemInstructionsProto = {
          custom: {
            part: [{ text: sysInstructions }]
          }
        };
      }
    }

    const geminiCfg = this.config.geminiConfig;
    const defaultModel = geminiCfg.models.default;
    const geminiConfigProto: any = {
      model_name: defaultModel.name,
      api_key: defaultModel.apiKey || geminiCfg.apiKey || apiKey
    };
    if (defaultModel.generation?.thinkingLevel) {
      geminiConfigProto.thinking_level = defaultModel.generation.thinkingLevel;
    }

    const workspaceProtos = (this.config.workspaces || []).map((p) => ({
      filesystem_workspace: {
        directory: path.resolve(p)
      }
    }));

    const cfg = this.config.capabilities || { enableSubagents: true };
    const allTools = [
      'list_directory', 'search_directory', 'find_file', 'view_file',
      'create_file', 'edit_file', 'run_command', 'ask_question',
      'start_subagent', 'generate_image', 'finish'
    ];
    let activeTools = new Set(allTools);
    if (cfg.enabledTools) {
      activeTools = new Set(cfg.enabledTools);
    } else if (cfg.disabledTools) {
      const disabled = new Set(cfg.disabledTools);
      activeTools = new Set(allTools.filter(t => !disabled.has(t as any)));
    }

    const harnessSideTools = {
      subagents: { enabled: cfg.enableSubagents && activeTools.has('start_subagent') },
      find: { enabled: activeTools.has('find_file') },
      user_questions: { enabled: activeTools.has('ask_question') },
      run_command: { enabled: activeTools.has('run_command') },
      file_edit: { enabled: activeTools.has('edit_file') },
      view_file: { enabled: activeTools.has('view_file') },
      write_to_file: { enabled: activeTools.has('create_file') },
      grep_search: { enabled: activeTools.has('search_directory') },
      list_dir: { enabled: activeTools.has('list_directory') },
      generate_image: {
        enabled: activeTools.has('generate_image'),
        model_name: cfg.imageModel || 'gemini-3.1-flash-image-preview'
      }
    };

    const harnessConfig = {
      tools: toolProtos,
      system_instructions: systemInstructionsProto,
      cascade_id: this.config.conversationId || '',
      gemini_config: geminiConfigProto,
      workspaces: workspaceProtos,
      skills_paths: this.config.skillsPaths || [],
      harness_side_tools: harnessSideTools,
      compaction_threshold: cfg.compactionThreshold || 0,
      finish_tool_schema_json: cfg.finishToolSchemaJson || '',
      app_data_dir: this.config.appDataDir || ''
    };

    const actualBinary = this.binaryPath ?? getDefaultHarnessBinaryPath();

    // Spawn child process
    const child = spawn(actualBinary, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.childProcess = child;

    // Write input config payload
    const payload = encodeInputConfig(saveDir);
    child.stdin?.write(payload);

    // Read 4-byte LE length prefix
    const rawLen = await new Promise<Buffer>((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length >= 4) {
          child.stdout?.removeListener('data', onData);
          resolve(buf);
        }
      };
      child.stdout?.on('data', onData);
      child.on('error', reject);
    });

    if (rawLen.length < 4) {
      throw new Error('Failed to read output config length prefix from harness process.');
    }

    const length = rawLen.readUInt32LE(0);
    let bodyBuf = rawLen.subarray(4);

    while (bodyBuf.length < length) {
      const chunk = await new Promise<Buffer>((resolve) => {
        child.stdout?.once('data', resolve);
      });
      bodyBuf = Buffer.concat([bodyBuf, chunk]);
    }

    const outputConfig = decodeOutputConfig(bodyBuf.subarray(0, length));
    const wsUrl = `ws://localhost:${outputConfig.port}/`;

    // Connect WebSocket with retries
    const maxRetries = 5;
    let ws: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        ws = new (globalThis as any).WebSocket(wsUrl, {
          headers: { 'x-goog-api-key': outputConfig.apiKey }
        });
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = reject;
        });
        break;
      } catch (err) {
        if (attempt === maxRetries - 1) {
          child.kill('SIGKILL');
          throw new Error(`Failed to connect to WebSocket at ${wsUrl} after ${maxRetries} attempts: ${err}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }

    this.wsClient = ws;

    // Send InitializeConversationEvent
    const initEvent = {
      config: harnessConfig
    };
    ws.send(JSON.stringify(initEvent));

    this.connection = new LocalConnection(child, ws, this.toolRunner, this.hookRunner);

    if (this.hookRunner) {
      await this.hookRunner.dispatchSessionStart();
    }

    return this.connection;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = undefined;
    }
  }

  async __aenter__(): Promise<void> {
    await this.start();
  }

  async __aexit__(_excType?: unknown, _excVal?: unknown, _excTb?: unknown): Promise<void> {
    await this[Symbol.asyncDispose]();
  }
}
