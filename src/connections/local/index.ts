export {
  LocalConnection,
  LocalConnectionStrategy
} from './local_connection.js';
export { LocalAgentConfig } from '../../config.js';
export {
  LocalConnectionStepImpl,
  LocalConnectionStep,
  normalizeWirePath,
  normalize_wire_path,
  callableToToolProto,
  callable_to_tool_proto,
  DEFAULT_HOST_TOOL_NAME,
  type LocalConnectionStep as LocalConnectionStepType
} from './local_connection_step.js';
export * from './types.js';
export * from './test_utils.js';
export {
  getBundledHarnessBinaryPath,
  getCurrentPlatformKey,
  getDefaultHarnessBinaryPath,
  getHarnessBinaryName,
  getPlatformKey
} from './harness_binary.js';
