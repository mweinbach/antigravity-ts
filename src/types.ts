import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const DEFAULT_IMAGE_GENERATION_MODEL = 'gemini-3.1-flash-image-preview';

export enum ThinkingLevel {
  MINIMAL = 'minimal',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export class GenerationConfig {
  constructor(public thinkingLevel?: ThinkingLevel) {}

  get thinking_level(): ThinkingLevel | undefined {
    return this.thinkingLevel;
  }
  set thinking_level(value: ThinkingLevel | undefined) {
    this.thinkingLevel = value;
  }
}

export class ModelEntry {
  constructor(
    public name: string,
    public apiKey?: string,
    public generation: GenerationConfig = new GenerationConfig()
  ) {}

  get api_key(): string | undefined {
    return this.apiKey;
  }
  set api_key(value: string | undefined) {
    this.apiKey = value;
  }

  static from(value: ModelEntry | string): ModelEntry {
    return typeof value === 'string' ? new ModelEntry(value) : value;
  }
}

export class ModelConfig {
  public default: ModelEntry;
  public imageGeneration: ModelEntry;

  constructor(options?: { default?: ModelEntry | string; imageGeneration?: ModelEntry | string; image_generation?: ModelEntry | string }) {
    this.default = ModelEntry.from(options?.default ?? DEFAULT_MODEL);
    this.imageGeneration = ModelEntry.from(options?.imageGeneration ?? options?.image_generation ?? DEFAULT_IMAGE_GENERATION_MODEL);
  }

  get image_generation(): ModelEntry {
    return this.imageGeneration;
  }
  set image_generation(value: ModelEntry | string) {
    this.imageGeneration = ModelEntry.from(value);
  }
}

export class GeminiConfig {
  public apiKey?: string;
  public models: ModelConfig;

  constructor(options?: { apiKey?: string; api_key?: string; models?: ModelConfig }) {
    this.apiKey = options?.apiKey ?? options?.api_key;
    this.models = options?.models ?? new ModelConfig();
  }

  get api_key(): string | undefined {
    return this.apiKey;
  }
  set api_key(value: string | undefined) {
    this.apiKey = value;
  }
}

const SUPPORTED_IMAGE_MIMES = new Set(['image/bmp', 'image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_DOCUMENT_MIMES = new Set([
  'application/pdf', 'application/json', 'text/css', 'text/csv', 'text/html',
  'text/javascript', 'text/plain', 'text/rtf', 'text/xml'
]);
const SUPPORTED_AUDIO_MIMES = new Set([
  'audio/wav', 'audio/mp3', 'audio/aac', 'audio/ogg', 'audio/flac',
  'audio/opus', 'audio/mpeg', 'audio/m4a', 'audio/l16'
]);
const SUPPORTED_VIDEO_MIMES = new Set([
  'video/3gpp', 'video/avi', 'video/mp4', 'video/mpeg', 'video/mpg',
  'video/quicktime', 'video/webm', 'video/wmv', 'video/x-flv'
]);

export {
  SUPPORTED_IMAGE_MIMES,
  SUPPORTED_DOCUMENT_MIMES,
  SUPPORTED_AUDIO_MIMES,
  SUPPORTED_VIDEO_MIMES
};

function readFileSafely(filePath: string): Buffer {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: '${absolutePath}'`);
  }
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: '${absolutePath}'`);
  }
  return fs.readFileSync(absolutePath);
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.bmp': 'image/bmp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.txt': 'text/plain',
    '.rtf': 'text/rtf',
    '.xml': 'text/xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
    '.mpga': 'audio/mpeg',
    '.mp2': 'audio/mpeg',
    '.mp2a': 'audio/mpeg',
    '.m2a': 'audio/mpeg',
    '.m3a': 'audio/mpeg',
    '.m4a': 'audio/m4a',
    '.l16': 'audio/l16',
    '.3gp': 'video/3gpp',
    '.3gpp': 'video/3gpp',
    '.avi': 'video/avi',
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpg',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.wmv': 'video/wmv',
    '.flv': 'video/x-flv'
  };
  return map[ext] || '';
}

abstract class BaseMedia {
  constructor(
    public data: Buffer,
    public mimeType: string,
    public description?: string
  ) {}

  get mime_type(): string {
    return this.mimeType;
  }
  set mime_type(value: string) {
    this.mimeType = value;
  }

  toPart() {
    return {
      inlineData: {
        mimeType: this.mimeType,
        data: this.data.toString('base64')
      },
      description: this.description || ''
    };
  }
}

/**
 * Represents an Image input for multimodal prompts.
 */
export class Image extends BaseMedia {
  constructor(mimeType: string, data: string | Buffer, description?: string) {
    const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Image MIME type: '${mimeType}'`);
    }
    super(buf, mimeType, description);
  }

  static fromFile(filePath: string, description?: string): Image {
    const data = readFileSafely(filePath);
    const mimeType = guessMimeType(filePath);
    if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Image MIME type: '${mimeType}'`);
    }
    return new Image(mimeType, data, description);
  }

  static from_file(filePath: string, description?: string): Image {
    return Image.fromFile(filePath, description);
  }
}

/**
 * Represents a Document input (e.g. PDF) for multimodal prompts.
 */
export class Document extends BaseMedia {
  constructor(mimeType: string, data: string | Buffer, description?: string) {
    const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    if (!SUPPORTED_DOCUMENT_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Document MIME type: '${mimeType}'`);
    }
    super(buf, mimeType, description);
  }

  static fromFile(filePath: string, description?: string): Document {
    const data = readFileSafely(filePath);
    const mimeType = guessMimeType(filePath);
    if (!SUPPORTED_DOCUMENT_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Document MIME type: '${mimeType}'`);
    }
    return new Document(mimeType, data, description);
  }

  static from_file(filePath: string, description?: string): Document {
    return Document.fromFile(filePath, description);
  }
}

export class Audio extends BaseMedia {
  constructor(mimeType: string, data: string | Buffer, description?: string) {
    const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    if (!SUPPORTED_AUDIO_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Audio MIME type: '${mimeType}'`);
    }
    super(buf, mimeType, description);
  }

  static fromFile(filePath: string, description?: string): Audio {
    const data = readFileSafely(filePath);
    const mimeType = guessMimeType(filePath);
    if (!SUPPORTED_AUDIO_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Audio MIME type: '${mimeType}'`);
    }
    return new Audio(mimeType, data, description);
  }

  static from_file(filePath: string, description?: string): Audio {
    return Audio.fromFile(filePath, description);
  }
}

export class Video extends BaseMedia {
  constructor(mimeType: string, data: string | Buffer, description?: string) {
    const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    if (!SUPPORTED_VIDEO_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Video MIME type: '${mimeType}'`);
    }
    super(buf, mimeType, description);
  }

  static fromFile(filePath: string, description?: string): Video {
    const data = readFileSafely(filePath);
    const mimeType = guessMimeType(filePath);
    if (!SUPPORTED_VIDEO_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Video MIME type: '${mimeType}'`);
    }
    return new Video(mimeType, data, description);
  }

  static from_file(filePath: string, description?: string): Video {
    return Video.fromFile(filePath, description);
  }
}

export type ContentPrimitive = string | Image | Document | Audio | Video;
export type Content = ContentPrimitive | ContentPrimitive[];

export function fromFile(filePath: string, description?: string): Image | Document | Audio | Video {
  const mimeType = guessMimeType(filePath);
  if (!mimeType) {
    throw new Error(`Could not infer a valid MIME type for extension: '${path.extname(filePath)}'`);
  }
  if (SUPPORTED_IMAGE_MIMES.has(mimeType)) return Image.fromFile(filePath, description);
  if (SUPPORTED_DOCUMENT_MIMES.has(mimeType)) return Document.fromFile(filePath, description);
  if (SUPPORTED_AUDIO_MIMES.has(mimeType)) return Audio.fromFile(filePath, description);
  if (SUPPORTED_VIDEO_MIMES.has(mimeType)) return Video.fromFile(filePath, description);
  throw new Error(`Unsupported MIME type: '${mimeType}'`);
}

/** @deprecated Use fromFile */
export const from_file = fromFile;

export enum TriggerDelivery {
  SEND_IMMEDIATELY = 'send_immediately',
  WAIT_IDLE = 'wait_idle'
}

export enum FileChangeKind {
  ADDED = 'added',
  MODIFIED = 'modified',
  DELETED = 'deleted'
}

export class FileChange {
  constructor(public kind: FileChangeKind, public path: string) {}
}

/**
 * Tracks token usage for the conversation session.
 */
export interface UsageMetadata {
  promptTokenCount?: number;
  prompt_token_count?: number;
  cachedContentTokenCount?: number;
  cached_content_token_count?: number;
  candidatesTokenCount?: number;
  candidates_token_count?: number;
  thoughtsTokenCount?: number;
  thoughts_token_count?: number;
  totalTokenCount?: number;
  total_token_count?: number;
}

/**
 * Result returned by Hook checks.
 */
export interface HookResult {
  allow: boolean;
  message?: string;
  reason?: string; // Support both Python's message and TS's reason field
}

/**
 * Result returned by interaction hooks.
 */
export interface QuestionHookResult {
  responses: QuestionResponse[];
  cancelled?: boolean;
}

export interface QuestionResponse {
  skipped?: boolean;
  selected_option_ids?: string[];
  selectedOptionIds?: string[];
  freeform_response?: string;
  freeformResponse?: string;
}

/**
 * Definition of a Tool Call.
 */
export interface ToolCall {
  name: string;
  args: any;
  id?: string;
  canonicalPath?: string;
  canonical_path?: string;
}

/**
 * Result of a single tool execution.
 */
export interface ToolResult {
  name: string;
  id?: string;
  result?: any;
  error?: string;
  exception?: any;
}

export interface AskQuestionOption {
  id: string;
  text: string;
}

export interface AskQuestionEntry {
  question: string;
  options?: AskQuestionOption[];
}

/**
 * Spec for the ask_question interaction.
 */
export interface AskQuestionInteractionSpec {
  questions: AskQuestionEntry[];
}

export class SystemInstructionSection {
  constructor(
    public content: string,
    public title: string = 'user_system_instructions'
  ) {}
}

export class TemplatedSystemInstructions {
  constructor(
    public identity: string | null = null,
    public sections: SystemInstructionSection[] = []
  ) {}
}

export class CustomSystemInstructions {
  constructor(public text: string) {}
}

/**
 * MCP Server Configuration types.
 */
export class McpStdioServer {
  readonly type = 'stdio' as const;
  constructor(
    public command: string,
    public args: string[] = []
  ) {}
}

export class McpSseServer {
  readonly type = 'sse' as const;
  constructor(
    public url: string,
    public headers?: Record<string, string>
  ) {}
}

export class McpStreamableHttpServer {
  readonly type = 'http' as const;
  constructor(
    public url: string,
    public headers?: Record<string, string>,
    public timeout: number = 30,
    public sseReadTimeout: number = 300,
    public terminateOnClose: boolean = true
  ) {}
}

export type McpServerConfig = McpStdioServer | McpSseServer | McpStreamableHttpServer;

export class AntigravityValidationError extends Error {
  errors: any[];

  constructor(message: string, errors: any[] = []) {
    super(message);
    this.name = 'AntigravityValidationError';
    this.message = message;
    this.errors = errors;
  }

  static fromZod(err: import('zod').ZodError): AntigravityValidationError {
    return new AntigravityValidationError(err.message, err.issues);
  }

  /** Alias matching Python AntigravityValidationError.from_pydantic */
  static fromPydantic(err: { message: string; errors?: () => any[] }): AntigravityValidationError {
    const issues = typeof err.errors === 'function' ? err.errors() : [];
    return new AntigravityValidationError(String(err.message), issues);
  }
}

export class AntigravityConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityConnectionError';
  }
}

export interface GenerateParams {
  contents: any[];
  systemInstruction?: any;
  tools?: any[];
  responseSchema?: any;
}

export interface GenerateResult {
  text: string;
  thoughts?: string;
  toolCalls?: any[];
  usageMetadata?: any;
  rawResponse: any;
}

export interface GenerateChunk {
  text?: string;
  thought?: string;
  toolCalls?: any[];
  usageMetadata?: any;
  rawChunk: any;
}

export interface MessagePart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: any;
  };
  functionResponse?: {
    name: string;
    response: any;
  };
  thought?: boolean;
}

export interface Message {
  role: 'user' | 'model';
  parts: MessagePart[];
}

export enum StepType {
  TEXT_RESPONSE = 'TEXT_RESPONSE',
  TOOL_CALL = 'TOOL_CALL',
  SYSTEM_MESSAGE = 'SYSTEM_MESSAGE',
  COMPACTION = 'COMPACTION',
  FINISH = 'FINISH',
  UNKNOWN = 'UNKNOWN'
}

export enum StepSource {
  SYSTEM = 'SYSTEM',
  USER = 'USER',
  MODEL = 'MODEL',
  UNKNOWN = 'UNKNOWN'
}

export enum StepTarget {
  USER = 'TARGET_USER',
  ENVIRONMENT = 'TARGET_ENVIRONMENT',
  UNSPECIFIED = 'TARGET_UNSPECIFIED',
  UNKNOWN = 'UNKNOWN'
}

export enum StepStatus {
  ACTIVE = 'ACTIVE',
  DONE = 'DONE',
  WAITING_FOR_USER = 'WAITING_FOR_USER',
  ERROR = 'ERROR',
  CANCELED = 'CANCELED',
  UNKNOWN = 'UNKNOWN'
}

export interface Step {
  id: string;
  stepIndex: number;
  step_index?: number;
  type: StepType;
  source: StepSource;
  target: StepTarget;
  status: StepStatus;
  content: string;
  contentDelta?: string;
  content_delta?: string;
  thinking: string;
  thinkingDelta?: string;
  thinking_delta?: string;
  toolCalls: ToolCall[];
  tool_calls?: ToolCall[];
  error: string;
  isCompleteResponse?: boolean;
  is_complete_response?: boolean;
  structuredOutput?: any;
  structured_output?: any;
  usageMetadata?: UsageMetadata;
  usage_metadata?: UsageMetadata;
}

export interface StreamChunk {
  stepIndex: number;
  text: string;
}

export class Thought implements StreamChunk {
  constructor(
    public stepIndex: number,
    public text: string,
    public signature?: Buffer
  ) {}
}

export class Text implements StreamChunk {
  constructor(public stepIndex: number, public text: string) {}
}

export class ChatResponse implements AsyncIterable<string> {
  private bufferedChunks: any[] = [];
  private isDone = false;
  private streamError: any = null;
  private pulling: Promise<void> | null = null;

  constructor(
    private chunkStream: AsyncIterator<any>,
    private conversation: any
  ) {}

  get chunks(): AsyncIterable<any> {
    return this.getChunks();
  }

  get usageMetadata(): UsageMetadata | null {
    return this.conversation.lastTurnUsage ?? null;
  }

  /** Python alias */
  get usage_metadata(): UsageMetadata | null {
    return this.usageMetadata;
  }

  get thoughts(): AsyncIterable<string> {
    const self = this;
    async function* gen() {
      for await (const chunk of self.getChunks()) {
        if (chunk instanceof Thought) yield chunk.text;
      }
    }
    return gen();
  }

  get toolCalls(): AsyncIterable<ToolCall> {
    const self = this;
    async function* gen() {
      for await (const chunk of self.getChunks()) {
        if (chunk && typeof chunk === 'object' && 'name' in chunk && 'args' in chunk && !(chunk instanceof Text) && !(chunk instanceof Thought)) {
          yield chunk as ToolCall;
        }
      }
    }
    return gen();
  }

  /** Python alias */
  get tool_calls(): AsyncIterable<ToolCall> {
    return this.toolCalls;
  }

  async *getChunks(): AsyncGenerator<any> {
    let pos = 0;
    while (true) {
      if (pos < this.bufferedChunks.length) {
        yield this.bufferedChunks[pos];
        pos++;
      } else if (this.isDone) {
        if (this.streamError) {
          throw this.streamError;
        }
        return;
      } else {
        if (this.pulling) {
          await this.pulling;
          continue;
        }
        let resolvePulling: () => void = () => {};
        this.pulling = new Promise<void>((r) => { resolvePulling = r; });
        try {
          if (pos < this.bufferedChunks.length || this.isDone) {
            resolvePulling();
            this.pulling = null;
            continue;
          }
          const next = await this.chunkStream.next();
          if (next.done) {
            this.isDone = true;
          } else {
            this.bufferedChunks.push(next.value);
          }
        } catch (err) {
          this.isDone = true;
          this.streamError = err;
          throw err;
        } finally {
          this.pulling = null;
          resolvePulling!();
        }
      }
    }
  }

  async resolve(): Promise<any[]> {
    const list: any[] = [];
    for await (const chunk of this.getChunks()) {
      list.push(chunk);
    }
    return list;
  }

  async text(): Promise<string> {
    const chunks = await this.resolve();
    return chunks
      .filter((c) => c instanceof Text)
      .map((c) => c.text)
      .join('');
  }

  async structuredOutput(): Promise<any> {
    if (!this.isDone) {
      await this.resolve();
    }
    return this.conversation.getLastStructuredOutput();
  }

  /** Python alias */
  async structured_output(): Promise<any> {
    return this.structuredOutput();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for await (const chunk of this.getChunks()) {
      if (chunk instanceof Text) {
        yield chunk.text;
      }
    }
  }
}




