# Prompt Analyzer — Research Findings

**Phase 1 complete.** All five open research items from `goals.md` are now RESOLVED.

---

## Item 4 — Session-to-Workspace Association

**Status: RESOLVED**

### Finding

Each VS Code workspace hash maps back to a human-readable workspace path via a `workspace.json` file co-located in the same `workspaceStorage` folder.

**Path pattern:**
```
%APPDATA%\Code - Insiders\User\workspaceStorage\<hash>\workspace.json
```

**Example content:**
```json
{ "folder": "file:///d%3A/workspace/prompt-analyzer" }
```

The `folder` value is a URL-encoded `file://` URI. Decode it (e.g., `decodeURIComponent(new URL(folder).pathname)`) to get the absolute workspace path.

### Implementation Notes

- Enumerate every subfolder under `workspaceStorage/`.
- For each, read `workspace.json` if present; skip if absent or malformed.
- `workspace.json` may contain either:
  - `{ "folder": "file:///..." }` — single-folder workspace (most common)
  - `{ "workspace": "file:///path/to/file.code-workspace" }` — multi-root workspace opened from a `.code-workspace` file
- For a `folder` entry: URL-decode the path and take the last path segment as the display name.
- For a `workspace` entry: URL-decode the `.code-workspace` file path; use the file's base name (without extension) as the display name (e.g., `my-project.code-workspace` → `my-project`).
- Folders that have no `workspace.json`, contain neither key, or where the referenced path no longer exists on disk should be labelled `(unknown workspace)`.
- Folders without a `GitHub.copilot-chat/chatSessions` subdirectory have no Copilot sessions and can be skipped entirely.
- The hash is computed deterministically by VS Code from the workspace URI — do not try to reproduce the hash algorithm; always read `workspace.json` to resolve it.
- Non-hash folder names (e.g., `ext-dev`, numeric timestamps) also appear in `workspaceStorage/`. They always lack a `workspace.json` and can be skipped.

---

## Item 5 — Session ID → Display Name

**Status: RESOLVED**

### Finding

The human-readable session title is stored in the `chatSessions` folder alongside (not inside) the Copilot debug-logs folder:

```
%APPDATA%\Code - Insiders\User\workspaceStorage\<hash>\chatSessions\<session-id>.jsonl
```

The `chatSessions/<session-id>.jsonl` file is an **event-sourced log**:

| `kind` | Meaning |
|--------|---------|
| `0` | Full snapshot of the current session state (the first line). |
| `1` | Incremental patch: `k` is a JSON-path array of keys, `v` is the new value. |

The session title appears as a `kind=1` patch:
```json
{ "kind": 1, "k": ["customTitle"], "v": "Draft goal review and testing" }
```

If no `customTitle` patch is present the session has not yet been named (Copilot auto-generates a title after the first complete turn; the user can also rename manually).

### Correction to goals.md Assumption

> goals.md states: *"Each `main.jsonl` contains one JSON object per line. Entries where the agent communicated with the LLM contain token counts, model name, and duration."*

**This is incorrect for VS Code Insiders 1.118.0 / Copilot Chat 0.46.x.** In the current release, `debug-logs/<session-id>/main.jsonl` contains **only a single `session_start` telemetry record**. All per-turn LLM data (model, tokens, elapsed time) is stored in `chatSessions/<session-id>.jsonl`, not `main.jsonl`. See the full data schema in §Data Schema below.

### Implementation Notes

- To resolve a session ID to its display title: open `chatSessions/<session-id>.jsonl`, scan for the last `kind=1` patch where `k[0] === "customTitle"`, and use its `v`.
- Reconstructing the full session state requires replaying all patches in order (first `kind=0` snapshot, then each `kind=1` patch).
- A session's `requestId` entries in `chatSessions` contain the turn-level data described below.

---

## Data Schema (chatSessions per-turn fields)

Reconstructing the final state of a session from `chatSessions/<session-id>.jsonl` yields a `requests[]` array. Each request object includes:

| Field | Type | Notes |
|-------|------|-------|
| `requestId` | string | Unique ID for the turn |
| `timestamp` | number | Unix ms of when the request was initiated |
| `modelId` | string | Model identifier, e.g. `"copilot/claude-sonnet-4.6"` |
| `completionTokens` | number \| null | Output (completion) tokens. Updated progressively during streaming; final value when `modelState.value === 1`. |
| `elapsedMs` | number \| null | Wall-clock ms for the LLM call. Populated when `modelState.value === 1`. |
| `modelState.value` | 0 or 1 | `0` = in-progress, `1` = completed |
| `modelState.completedAt` | number | Unix ms of completion |
| `message.text` | string | Raw user prompt text |

**Important limitation:** `promptTokens` (input token count) is **not recorded** by GitHub Copilot. Only output/completion tokens are available.

**Prompt token estimation strategy:** Use the character-count heuristic `Math.ceil(message.text.length / 4)` as the prompt token estimate. This approximation (4 chars ≈ 1 token) is accurate to within ±20% for English text and avoids a dependency on a tokenizer library. The UI should clearly label these as _estimated_ prompt tokens. For models where only `completionTokens` are available and no text is recorded, prompt token cost is displayed as `N/A`.

The `chatSessions` `kind=1` entries use incremental streaming updates: the `completionTokens` field for a given request index may appear multiple times with increasing values; always use the last (highest) value.

**Concurrent writes:** When a Copilot session is actively running, `chatSessions/<session-id>.jsonl` is being written. The extension should handle truncated or malformed JSON lines (catch parse errors per line) and treat any request where `modelState.value !== 1` as still in-progress (exclude from aggregation until the file is re-scanned on a next poll cycle).

**`customTitle` fallback:** If no `kind=1` patch with `k=["customTitle"]` exists, fall back to displaying the creation timestamp of the session formatted as `Session <YYYY-MM-DD HH:MM>` (derived from `creationDate` in the `kind=0` snapshot).

---

## Item 8 — Pricing / Cost Estimation API

**Status: RESOLVED**

### Finding

**GitHub publishes its own authoritative pricing YAML for all Copilot models:**

```
https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml
No authentication required.
```

Sample entries:

```yaml
- model: Claude Sonnet 4.6
  provider: anthropic
  release_status: GA
  category: Versatile
  input: $3.00
  cached_input: $0.30
  output: $15.00
  cache_write: $3.75

- model: GPT-4.1
  provider: openai
  release_status: GA
  category: Versatile
  input: $2.00
  cached_input: $0.50
  output: $8.00
```

All prices are **USD per 1,000,000 tokens** (dollar-sign prefixed strings). No unit conversion needed beyond stripping `$`.

| YAML field | Meaning |
|------------|---------|
| `input` | Full input token cost per 1M (cache miss or non-cacheable) |
| `cached_input` | Input token cost per 1M when served from cache (~10× cheaper) |
| `output` | Output token cost per 1M |
| `cache_write` | Cost per 1M to write tokens into a new cache entry (Anthropic models only) |

This source covers all four providers Copilot uses (OpenAI, Anthropic, Google, GitHub fine-tuned) and is maintained directly by GitHub. It supersedes OpenRouter for Copilot pricing purposes. OpenRouter remains useful as a secondary reference for models not yet listed here.

### Copilot modelId → YAML Model Name Mapping

Copilot JSONL records model IDs like `copilot/claude-sonnet-4.6`. The GitHub YAML uses display names like `Claude Sonnet 4.6`. Map by:

1. Strip the `copilot/` prefix from the model ID → `claude-sonnet-4.6`
2. Split on `-`, title-case each word, join with spaces → `Claude Sonnet 4.6`
3. Look up the result in the YAML `model` field (case-insensitive)

This heuristic covers all current Anthropic, Google, and GitHub fine-tuned slugs. OpenAI slugs (`gpt-4.1`) capitalise differently (`GPT-4.1`), so maintain a small hardcoded exceptions map for known OpenAI patterns:

```ts
const SLUG_OVERRIDES: Record<string, string> = {
  'gpt-4.1': 'GPT-4.1',
  'gpt-5-mini': 'GPT-5 mini',
  // add as needed
};
```

Fall through to the title-case heuristic for anything not in the map.

### Decision: GitHub YAML as Primary, Bundled Fallback

1. **On extension activation**, fetch the raw YAML from GitHub in the background worker and cache it in SQLite (table: `pricing_cache`, TTL: 24 hours). Parse with `js-yaml` (add as a dependency).
2. **Use the cached pricing** for all cost calculations. Re-fetch when stale.
3. **Bundled fallback**: ship `src/pricing/prices-fallback.json` — a pre-parsed JSON snapshot of the YAML at release time. Used when the network is unreachable or the fetch fails.
4. **Unknown models**: if a `modelId` maps to nothing in the live data or the fallback, display token counts and mark cost as `N/A`.
5. **User override**: `promptAnalyzer.customPrices` VS Code setting allows users to specify per-model rates that supersede all other sources.

### Cache Token Data in Copilot JSONL

The Copilot `chatSessions/<session-id>.jsonl` data **does** contain cache-related information, but not as top-level token counters. In the `result.metadata.renderedUserMessage` array (within each request's result), individual context blocks carry:

```json
{ "type": 3, "cacheType": "ephemeral", "tokens": 28878 }
```

| Field | Meaning |
|-------|---------|
| `cacheType: "ephemeral"` | This block was tagged for Anthropic prompt caching |
| `tokens` | Size of this block in tokens |

**What this enables:** Sum all `tokens` values on blocks with `cacheType: "ephemeral"` to estimate how many input tokens *could* be served from cache on subsequent turns of the same session. This is a **cache-eligible token estimate**, not a confirmed cache hit count — Copilot does not record whether a cache read actually occurred vs. a cold miss.

**Cost calculation strategy:**
- Output tokens: use `completionTokens` × `pricing.completion` (exact)
- Cache-eligible input tokens: use ephemeral block `tokens` sum × `pricing.input_cache_read` (estimated — assumes warm cache after first turn)
- Non-cached input tokens: `estimated_prompt_tokens − cache_eligible_tokens`, costed at `pricing.prompt`
- All cache-derived costs are clearly labeled as _estimated_ in the UI

**Since direct `promptTokens` are unavailable** (see Item 5), full input cost remains an estimate regardless. The cache breakdown adds useful granularity but should be presented with appropriate caveats.

---

## Item 9 — SQLite Binding for VS Code Extensions

**Status: RESOLVED**

### Finding

Three viable options were evaluated:

| Package | API | Native? | Notes |
|---------|-----|---------|-------|
| `better-sqlite3` v12.10.0 | Synchronous | Yes (N-API) | Fastest; N-API stable across Electron/Node versions |
| `sql.js` v1.14.1 | Synchronous | No (WASM) | Pure JS, zero native compilation; entire DB loaded in memory |
| `@vscode/sqlite3` v5.1.12-vscode | Async (callbacks) | Yes (N-API) | VS Code team fork of node-sqlite3; async API adds complexity in workers |

### Decision: `better-sqlite3`

**Use `better-sqlite3`** as the primary SQLite binding.

**Rationale:**
1. **Synchronous API** is the best fit for worker threads, where the entire processing loop is already explicit and callback-based async adds no value.
2. **N-API (Node-API) stable ABI** — modules built against N-API work across Electron versions without `electron-rebuild`. VS Code 1.70+ uses Electron with N-API support. No extra build step needed in most cases.
3. **Fastest** option for the local read/write workload.
4. **Wide adoption** with active maintenance (WiseLibs/better-sqlite3).

**Fallback:** If native binary compatibility issues arise during packaging (e.g., cross-platform VSIX), drop in `sql.js`. Its in-memory model is fine for the data volumes here (~thousands of records per workspace), and persistence is handled by periodically serialising the in-memory DB to disk.

**Extension packaging note:** Include a `postinstall` script and VSIX `--pre-release` binary strategy or use `@electron/rebuild` during the `vsce package` step if binary issues surface on CI.

---

## Item 10 — CPU Throttling in Worker Threads

**Status: RESOLVED**

### Finding

Node.js `worker_threads` `resourceLimits` option controls **memory only** (heap, stack). There is **no built-in CPU time or CPU usage limit**.

`process.versions.modules` on Node 24 = `137`, confirming N-API ABI is stable at this level.

### Decision: setImmediate-based Yielding with Adaptive Delay

Since no native CPU cap exists, implement a cooperative yielding strategy in the background worker:

```typescript
const TARGET_CPU_FRACTION = 0.15; // ~15%
const BATCH_SIZE = 100; // lines per batch (initial)

async function processWithYielding(items: string[]): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batchStart = Date.now();
    processBatch(items.slice(i, i + BATCH_SIZE));
    const batchMs = Date.now() - batchStart;

    // Yield proportionally: if batch took N ms of CPU, sleep N*(1/TARGET - 1) ms
    const sleepMs = Math.round(batchMs * ((1 / TARGET_CPU_FRACTION) - 1));
    if (sleepMs > 0) {
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    } else {
      // At minimum, yield to allow message processing
      await new Promise(resolve => setImmediate(resolve));
    }
  }
}
```

**Adaptive batch sizing:** If a single batch consistently completes in <5 ms, increase batch size (up to 500) to reduce overhead. If a batch exceeds 200 ms, halve the batch size.

**Worker <→ main thread coordination:** The main thread can send a `"pause"` message to the worker (via `parentPort.on('message', ...)`) to suspend processing when the user is actively interacting with the UI.

---

## Summary Table

| # | Item | Status | Decision |
|---|------|--------|---------|
| 4 | Session-to-workspace association | **RESOLVED** | Read `workspaceStorage/<hash>/workspace.json` → decode `folder` URL |
| 5 | Session ID → display name | **RESOLVED** | Read `chatSessions/<session-id>.jsonl`, find last `kind=1` patch with `k=["customTitle"]` |
| 8 | Pricing API | **RESOLVED** | Live fetch from `https://openrouter.ai/api/v1/models` (no auth); cache in SQLite (24h TTL); bundled fallback JSON; user override setting |
| 9 | SQLite binding | **RESOLVED** | Use `better-sqlite3` (synchronous N-API); fallback to `sql.js` if binary issues |
| 10 | CPU throttling in workers | **RESOLVED** | setImmediate/setTimeout adaptive yielding targeting ≤15% CPU; pause-on-demand from main thread |

---

*Researched: 2026-05-23. Verified against GitHub Copilot Chat 0.46.2026042204 / VS Code Insiders 1.118.0 on Windows.*
