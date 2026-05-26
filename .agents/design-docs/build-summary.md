# Prompt Analyzer — Build Summary

**Date built:** 2026-05-23  
**Status:** ✅ All phases complete. All quality gates passed.

## Post-Build Release Notes (v0.2.0)

- SemVer classification: **minor**.
- `package.json` version updated to `0.2.0`.
- **Scan progress banner** added to sidebar — persistent spinner strip shows live scan progress even when the tree already has data. Previously only visible while the tree was empty.
- **"Clear Database & Re-scan All Sessions"** promoted to the sidebar toolbar (previously command-palette only). Confirmation modal removed; fires immediately.
- **Legacy `.json` session files** (pre-February 2026 Copilot format) are now parsed alongside current `.jsonl` files. No configuration required.
- **Filter placeholder** updated to "Filter workspaces & sessions…" to communicate that workspace-name matching was already supported.
- Unit test suite expanded to 142 tests (+19): coverage added for `listSessionFiles`, `resolveSessionFilePath`, legacy JSON parser, single-slice pie chart, and `resetForReprocess` clearing all four tables.

## Post-Build Release Notes (v0.1.0)

- SemVer classification: **minor**.
- `package.json` version updated to `0.1.0`.
- **Cross-variant session aggregation** — reads from both stable Code and Code-Insiders storage paths simultaneously.
- `allWorkspaceStoragePaths()` added to `pathUtils.ts`; `WorkerBridge`, `aggregator`, and `extension.ts` updated to accept an array of paths.
- `listSessionFiles()` and `resolveSessionFilePath()` added to `chatSessionsParser.ts`; legacy `.json` parser added.
- `resetForReprocess()` now clears all four tables (workspaces, sessions, turns, processed_files).
- Single-slice pie chart bug fixed (renders `<circle>` instead of degenerate arc path).

## Post-Build Release Notes (v0.0.2)

- SemVer classification: **patch**.
- `package.json` version updated to `0.0.2`.
- End-user docs refreshed (`README.md`) with transition context copy and screenshot-led overview polish.
- Report UX update documented: Cost tab model filter supports multi-select chips.
- Copilot provider icon switched to MIT-licensed source asset; third-party attribution captured in `LICENSE`.
- Sidebar cost rollups added: workspace nodes and the Copilot root node each display an estimated total cost.
- Time range slicer moved to the report header; TOTAL, COSTS, and STEPS KPI counters update when the range changes (TODAY is fixed to the last 24 h and is unaffected by the range selector).
- Pie charts added to every Time-tab bucket card (list mode); pie chart promoted to first position in chart view.
- Third report tab renamed from "Cost" to "Models" (internal `data-tab` id unchanged).
- Report kicker hardcoded to `PROMPTCOUNTANT · REPORT (COPILOT)`.

---

## What Was Built

### Extension Structure

```
src/
├── extension.ts                          # VS Code activation / deactivation
├── types.ts                              # Shared TypeScript interfaces
├── utils/
│   └── pathUtils.ts                      # Path resolution, URI decoding
├── providers/
│   └── copilot/
│       ├── workspaceResolver.ts          # Hash → WorkspaceInfo (reads workspace.json)
│       └── chatSessionsParser.ts         # chatSessions JSONL → SessionInfo + TurnInfo
├── storage/
│   ├── schema.ts                         # SQL DDL
│   └── database.ts                       # sql.js-based SQLite wrapper
├── pricing/
│   ├── slugMapper.ts                     # modelId → YAML display name
│   ├── PricingService.ts                 # GitHub YAML fetch, cost calculation
│   └── prices-fallback.json             # Bundled pricing (17 models)
├── workers/
│   ├── aggregator.ts                     # Core logic (testable)
│   ├── aggregationWorker.ts              # Worker thread entry point
│   └── workerBridge.ts                   # Main-thread side of worker
└── ui/
    ├── SessionTreeProvider.ts            # Sidebar TreeDataProvider
    └── SessionDetailPanel.ts            # Webview detail panel

test/
├── __mocks__/vscode.ts                  # VS Code API mock
├── chatSessionsParser.test.ts           # 14 tests
├── workspaceResolver.test.ts            # 10 tests
├── slugMapper.test.ts                   # 15 tests
├── pricingService.test.ts               # 14 tests
└── database.test.ts                     # 21 tests

Total: 74 tests, all passing
```

---

## Key Decisions and Rationale

| Decision | Rationale |
|----------|-----------|
| **sql.js (WASM) instead of better-sqlite3** | `better-sqlite3` v9.x failed to compile on Node.js 24.13.1 / VS2026 (C++17 vs C++20 conflict in V8 headers). `sql.js` is the research-documented fallback — no native compilation, works everywhere. |
| **Async `PromptAnalyzerDb.create()` factory** | sql.js's `initSqlJs()` is async; factory pattern keeps constructor synchronous for tests (inject pre-built SqlJsStatic instance). |
| **Worker-saves-disk pattern** | Worker thread calls `db.save()` after each session, then posts `session_added`. Main thread calls `db.reload()` on that message. This serialises disk access to the worker, avoiding concurrent write issues. |
| **chatSessions JSONL, not debug-logs/main.jsonl** | Research Finding 5: in Copilot Chat 0.46.x / VS Code Insiders 1.118.0, `main.jsonl` contains only session-start telemetry. All per-turn data (tokens, model, timing) is in `chatSessions/<session-id>.jsonl`. |
| **GitHub YAML pricing (not OpenRouter)** | Research Finding 8: GitHub publishes authoritative Copilot pricing at `https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml` — no auth, covers all four Copilot providers. |
| **Prompt tokens estimated at 4 chars/token** | Research Finding 5: `promptTokens` is not recorded by Copilot. Character-count heuristic (±20% accuracy for English) is the only option without a tokenizer dependency. UI labels these as estimated. |
| **Adaptive CPU yielding (not native throttle)** | Research Finding 10: Node.js worker_threads has no built-in CPU cap. `setImmediate`/`setTimeout` yielding targeting ≤15% CPU is implemented, with adaptive batch sizing. |
| **Real-time search via InputBox.onDidChangeValue** | VS Code TreeView API has no native inline search bar. `createInputBox` with `onDidChangeValue` gives real-time filtering without a native input in the panel. |

---

## How Each Requirement Is Met

### UI/UX
- **Search bar, real-time filtering**: `promptAnalyzer.search` command opens a VS Code InputBox. `onDidChangeValue` calls `treeProvider.setSearch()` on every keystroke, instantly re-filtering the tree.
- **Workspace-grouped tree view**: `SessionTreeProvider` — 3 levels: `ProviderNode("Copilot")` → `WorkspaceNode` → `SessionNode`.
- **Most-recent workspace first**: `getWorkspaces()` orders by `MAX(t.timestamp) DESC`.
- **Human-readable session names**: `parseChatSessionFile` replays `kind=1` patches, extracts last `customTitle`; falls back to `Session YYYY-MM-DD HH:MM` from `creationDate`.
- **Workspace leaf name**: `workspaceResolver.ts` reads `workspace.json`, URL-decodes the `folder` URI, takes `path.basename`.
- **Loading indicator**: `treeView.message = 'Scanning Copilot sessions…'` set on activation; hidden when sessions arrive or scan completes.
- **Empty state**: After scan completes with no results: `treeView.message = 'No Copilot chat sessions found…'`.

### Session Discovery
- `discoverWorkspaces()` scans every subdirectory of `workspaceStorage`, checks for `GitHub.copilot-chat/chatSessions` existence.
- Worker processes all sessions found, skipping unchanged files (mtime check via `processed_files` table).
- Progress reported via status bar: `$(sync~spin) Prompt Analyzer: X/Y sessions`.

### Session Detail View
- Opens as a VS Code WebviewPanel on session click.
- Table columns: Time, Type, Role (`LLM Call`), Model, Message preview (120 chars), Output tokens, ~Prompt tokens, Duration, ~Cost.
- Clicking a row re-parses the JSONL file and shows the full message text.

### Data Storage
- SQLite via sql.js: tables `workspaces`, `sessions`, `turns`, `pricing_cache`, `processed_files`.
- `turns.message_text` serves as searchable user prompt synopsis.
- LLM response text is not stored (not available from data source — see Limitations).

### Background Processing
- `Worker` thread via Node.js `worker_threads`; all disk I/O and DB writes happen in the worker.
- Adaptive batch size (10–500 lines) with proportional sleep (`batchMs × (1/0.15 - 1)`) targeting ≤15% CPU.
- Cooperative pause via `isPaused()` polling.

### Pricing
- On activation: worker fetches GitHub YAML, parses with `js-yaml`, caches in SQLite (24h TTL).
- Fallback: `prices-fallback.json` with 17 models pre-populated.
- User overrides: `promptAnalyzer.customPrices` setting read at activation, passed to worker via `workerData`, applied in `calculateTurnCost`.
- Model ID mapping: `slugMapper.ts` — strips `copilot/` prefix, applies OpenAI hardcoded overrides, title-cases the rest.

---

## Known Limitations

1. **LLM response synopsis unavailable**: GitHub Copilot's `chatSessions` JSONL does not store the LLM response text, only token counts. Response synopsis cannot be displayed or searched.

2. **Prompt token counts are estimates**: Only completion (output) tokens are recorded by Copilot. Input tokens are estimated at `ceil(messageText.length / 4)` — accurate to ±20% for English. All estimated values are clearly labelled in the UI.

3. **sql.js loads full DB into memory**: For very large deployments (>50k sessions), initial load time may be noticeable. The current `reload()` approach re-reads the full DB file on each `session_added` event. Mitigation: switch to `better-sqlite3` when a compatible version ships for the target Node.js/Electron version.

4. **Worker requires compiled output**: Running the extension requires `npm run compile` first. Standard for VS Code extensions.

5. **OpenRouter secondary reference not implemented**: Only the GitHub YAML + bundled fallback are used. OpenRouter was documented as a secondary reference for models not in the GitHub YAML but is not fetched in v1.

---

## Phase Sign-offs

| Phase | Status |
|-------|--------|
| Phase 1 — Research | ✅ Signed off (pre-existing) |
| Phase 2 — Implementation | ✅ 74/74 tests pass; 0 TypeScript errors; Critic Major issues resolved |
| Phase 3 — Requirements Review | ✅ All requirements covered; LLM response synopsis documented as inherent data source limitation |
| Phase 4 — UX Review | ✅ All criteria PASS; empty-state and loading-state UX improvements applied |
| Phase 5 — Final | ✅ 74/74 tests pass; 0 TypeScript errors |
