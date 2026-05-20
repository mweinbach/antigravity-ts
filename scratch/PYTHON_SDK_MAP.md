# Python SDK → TypeScript Port Map

Source dump: `scratch/python-sdk/antigravity/` (42 `.py` files from `google-antigravity` 0.1.0)

Harness binaries: `vendor/localharness/<platform>/localharness` (synced from the `google-antigravity` 0.1.0 platform wheels via `npm run sync:localharness`)

## Status: **Full runtime parity** ✅

All 22 substantive non-test Python runtime modules have TypeScript equivalents with snake_case + camelCase API aliases where the Python SDK exposes snake_case names.

## Module mapping

| Python | TypeScript | Status |
|--------|------------|--------|
| `__init__.py` | `src/index.ts` | ✅ Full + extended exports |
| `types.py` | `src/types.ts` | ✅ incl. SUPPORTED_*_MIMES, from_file |
| `agent.py` | `src/agent.ts` | ✅ Agent.open/create/run + _config/_hook_runner |
| `connections/connection.py` | `src/connection.ts` + `config.ts` | ✅ |
| `connections/local/local_connection_config.py` | `src/config.ts` | ✅ DEFAULT_APP_DATA_DIR |
| `connections/local/local_connection.py` | `src/connections/local/local_connection.ts` + `src/connections/local/local_connection_step.ts` + `src/connections/local/harness_binary.ts` | ✅ |
| `connections/local/test_utils.py` | `src/connections/local/test_utils.ts` | ✅ test harness helpers |
| `connections/local/types.py` | `src/connections/local/types.ts` | ✅ |
| `connections/local/localharness_pb2.py` | `src/connections/local/protobuf.ts` | ✅ |
| `connections/local/__init__.py` | `src/connections/local/index.ts` | ✅ |
| `conversation/conversation.py` | `src/conversation.ts` | ✅ snake_case aliases |
| `hooks/hooks.py` | `src/hooks/hooks.ts` | ✅ ABCs + decorators |
| `hooks/hook_runner.py` | `src/hooks/hook_runner.ts` | ✅ hook list getters |
| `hooks/policy.py` | `src/hooks/policy.ts` | ✅ PolicyDecideHook |
| `hooks/__init__.py` | `src/hooks/index.ts` | ✅ |
| `tools/tool_runner.py` | `src/tools/tool_runner.ts` | ✅ get_public_callable |
| `tools/tool_context.py` | `src/tools/tool_context.ts` | ✅ get_state/set_state |
| `mcp/bridge.py` | `src/mcp/index.ts` | ✅ get_mcp_tools |
| `triggers/triggers.py` | `src/triggers/index.ts` | ✅ |
| `triggers/trigger_runner.py` | `src/triggers/trigger_runner.ts` | ✅ is_running |
| `triggers/helpers.py` | `src/triggers/index.ts` | ✅ |
| `utils/interactive.py` | `src/utils/interactive.ts` | ✅ |

## TS-only (not in Python SDK)

| Module | Notes |
|--------|-------|
| `src/tools/builtin/*` | Legacy — harness owns builtins in local mode |
| `src/connection.ts` GeminiAPIConnection | Orphan direct Gemini API path |
| `src/skills/index.ts` | Partial Skill class; Python only has skills_paths config |
| `src/tools/custom_tool.ts` | zodTool, tool() helpers |

## Remaining gap

- **Test suite depth**: Python has 16 `*_test.py` files; TS has the live agent integration tests plus local parity tests. The broad Python unit suite is not fully ported yet.

## Usage (Python parity)

```typescript
// async with Agent(...) as agent:
await using agent = await Agent.open(config);

// or
for await (const agent of Agent.create(config)) { ... }

// or
await Agent.run(config, async (agent) => { ... });
```
