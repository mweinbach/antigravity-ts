# Python SDK → TypeScript Port Map

Source dump: `scratch/python-sdk/antigravity/` (42 `.py` files from `google-antigravity` 0.1.0)

Harness binary: `scratch/python-sdk/antigravity/bin/localharness`

## Status: **Full runtime parity** ✅

All 22 non-test Python runtime modules have TypeScript equivalents with snake_case + camelCase API aliases.

## Module mapping

| Python | TypeScript | Status |
|--------|------------|--------|
| `__init__.py` | `src/index.ts` | ✅ Full + extended exports |
| `types.py` | `src/types.ts` | ✅ incl. SUPPORTED_*_MIMES, from_file |
| `agent.py` | `src/agent.ts` | ✅ Agent.open/create/run + _config/_hook_runner |
| `connections/connection.py` | `src/connection.ts` + `config.ts` | ✅ |
| `connections/local/local_connection_config.py` | `src/config.ts` | ✅ DEFAULT_APP_DATA_DIR |
| `connections/local/local_connection.py` | `src/connections/local/local_connection.ts` | ✅ |
| `connections/local/local_connection_step` | `src/connections/local/local_connection_step.ts` | ✅ LocalConnectionStep.fromDict |
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
| `tools/custom_tool.py` | `src/tools/custom_tool.ts` | ✅ TS extension |
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

- **Test suite**: Python has 20 test files; TS has 1 integration test (`tests/agent.test.ts`)

## Usage (Python parity)

```typescript
// async with Agent(...) as agent:
await using agent = await Agent.open(config);

// or
for await (const agent of Agent.create(config)) { ... }

// or
await Agent.run(config, async (agent) => { ... });
```
