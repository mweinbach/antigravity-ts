import { GoogleGenAI } from '@google/genai';
import { AntigravityConnectionError } from './types.js';

export interface Connection {
  isIdle: boolean;
  is_idle?: boolean;
  conversationId: string;
  conversation_id?: string;
  send(prompt: any, options?: any): Promise<void>;
  receiveSteps(): AsyncIterable<any> & AsyncIterator<any>;
  receive_steps?(): AsyncIterable<any> & AsyncIterator<any>;
  disconnect(): Promise<void>;
  cancel(): Promise<void>;
  delete(): Promise<void>;
  signalIdle(): Promise<void>;
  signal_idle?(): Promise<void>;
  waitForIdle(): Promise<void>;
  wait_for_idle?(): Promise<void>;
  waitForWakeup(timeout?: number): Promise<boolean>;
  wait_for_wakeup?(timeout?: number): Promise<boolean>;
  sendToolResults?(results: any[]): Promise<void>;
  send_tool_results?(results: any[]): Promise<void>;
  sendTriggerNotification?(content: string): Promise<void>;
  send_trigger_notification?(content: string): Promise<void>;
}

export interface ConnectionStrategy {
  connect(): Connection;
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Connection implementation that talks to the Google Gemini API.
 */
export class GeminiAPIConnection {
  private client?: GoogleGenAI;

  constructor(private config: any) {}

  async connect() {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Please set the environment variable or pass apiKey in LocalAgentConfig.');
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async disconnect() {
    // No-op for HTTP-based API client
  }

  /**
   * Helper to build the generation config for Gemini API.
   */
  private buildGenConfig(params: any): any {
    const genConfig: any = {};
    if (params.systemInstruction) {
      genConfig.systemInstruction = params.systemInstruction;
    }
    if (params.tools && params.tools.length > 0) {
      genConfig.tools = params.tools;
    }
    if (params.responseSchema) {
      genConfig.responseSchema = params.responseSchema;
      genConfig.responseMimeType = 'application/json';
    }

    // Configure thinking budget for compatible models.
    const modelLower = (this.config.model || '').toLowerCase();
    const isThinkingModel = modelLower.includes('gemini-2.5') ||
      modelLower.includes('gemini-3') ||
      modelLower.includes('gemini-3.5') ||
      modelLower.includes('thinking');

    if (isThinkingModel) {
      if (modelLower.includes('gemini-3') || modelLower.includes('gemini-3.5')) {
        genConfig.thinkingConfig = {
          thinkingLevel: 'medium'
        };
      } else {
        genConfig.thinkingConfig = {
          thinkingBudget: 1024
        };
      }
    }
    return genConfig;
  }

  async generate(params: any): Promise<any> {
    if (!this.client) throw new Error('Not connected');
    try {
      const genConfig = this.buildGenConfig(params);
      const response = await this.client.models.generateContent({
        model: this.config.model,
        contents: params.contents,
        config: genConfig
      });
      let text = '';
      let thoughts = '';
      const toolCalls: any[] = [];
      const candidate = response.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.thought) {
            thoughts += part.text || '';
          } else if (part.text) {
            text += part.text;
          }
          if (part.functionCall) {
            toolCalls.push(part.functionCall);
          }
        }
      }
      return {
        text,
        thoughts,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usageMetadata: response.usageMetadata,
        rawResponse: response
      };
    } catch (error: any) {
      throw new AntigravityConnectionError(`Gemini generateContent call failed: ${error.message}`);
    }
  }

  async *generateStream(params: any): AsyncIterable<any> {
    if (!this.client) throw new Error('Not connected');
    try {
      const genConfig = this.buildGenConfig(params);
      const responseStream = await this.client.models.generateContentStream({
        model: this.config.model,
        contents: params.contents,
        config: genConfig
      });
      for await (const chunk of responseStream) {
        let text = '';
        let thought = '';
        const toolCalls: any[] = [];
        const candidate = chunk.candidates?.[0];
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.thought) {
              thought += part.text || '';
            } else if (part.text) {
              text += part.text;
            }
            if (part.functionCall) {
              toolCalls.push(part.functionCall);
            }
          }
        }
        yield {
          text: text || undefined,
          thought: thought || undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usageMetadata: chunk.usageMetadata,
          rawChunk: chunk
        };
      }
    } catch (error: any) {
      throw new AntigravityConnectionError(`Gemini generateContentStream call failed: ${error.message}`);
    }
  }
}
