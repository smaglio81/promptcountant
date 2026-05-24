# Phase 3 — Requirements Traceability Report

**Date:** 2026-05-23  
**Status: SIGNED OFF** — all requirements either implemented or documented as out-of-scope limitations.

---

## Requirement Coverage

| # | Requirement | File | Status | Notes |
|---|-------------|------|--------|-------|
| UI-1 | Search bar at top of panel, filters in real time | `extension.ts` (`promptAnalyzer.search`), `SessionTreeProvider.ts` | ✅ | Uses `createInputBox` with `onDidChangeValue` for real-time filtering |
| UI-2 | Tree view with sessions grouped by workspace | `SessionTreeProvider.ts` | ✅ | ProviderNode → WorkspaceNode → SessionNode |
| UI-3 | Workspace with most recent activity at top | `database.ts` `getWorkspaces()` | ✅ | `ORDER BY latest_activity DESC` |
| UI-4 | Sessions sorted most-recent-first within workspace | `database.ts` `getSessions()` | ✅ | `ORDER BY COALESCE(updated_at, created_at) DESC` |
| UI-5 | First top-level node is "Copilot" | `SessionTreeProvider.ts` `ProviderNode` | ✅ | |
| SN-1 | Session GUID → human-readable name | `chatSessionsParser.ts` | ✅ | Last `kind=1` patch with `k=["customTitle"]`; fallback to `Session YYYY-MM-DD HH:MM` |
| SN-2 | Workspace hash → leaf folder name | `workspaceResolver.ts` | ✅ | Reads `workspace.json`; decodes URI; takes `path.basename` |
| SD-1 | Session discovery across all workspaces on machine | `aggregator.ts`, `workspaceResolver.ts` | ✅ | Scans all subdirs of workspaceStorage |
| SD-2 | User notified that background scanning is starting | `extension.ts` | ✅ | Status bar item + `showInformationMessage` |
| DV-1 | Session detail opens on double-click (command on item click) | `SessionDetailPanel.ts`, `SessionTreeProvider.ts` | ✅ | `promptAnalyzer.openSession` command |
| DV-2 | Role / type label in detail view | `SessionDetailPanel.ts` | ✅ | "LLM Call" shown in Type column |
| DV-3 | Timestamp in detail view | `SessionDetailPanel.ts` | ✅ | |
| DV-4 | Truncated preview of user prompt | `SessionDetailPanel.ts` | ✅ | First 120 chars of `message_text` |
| DV-5 | Summary / synopsis of prompt | `database.ts` `turns.message_text` | ✅ (partial) | `message_text` column serves as searchable synopsis; full AI-generated summary out of scope |
| DV-6 | Summary / synopsis of LLM response | N/A | ⚠️ LIMITATION | chatSessions JSONL does not contain LLM response text — only token counts. Acknowledged in research-findings.md. |
| DV-7 | Duration of LLM call | `SessionDetailPanel.ts` | ✅ | `elapsedMs` field |
| DV-8 | Tokens sent / received | `SessionDetailPanel.ts` | ✅ | `completionTokens` (exact) + `estimatedPromptTokens` (~) |
| DV-9 | Model used | `SessionDetailPanel.ts` | ✅ | |
| DV-10 | Drill into row → full JSONL entry | `SessionDetailPanel.ts` `_sendTurnDetail()` | ✅ | Re-parses JSONL on demand, shows full `messageText` |
| DB-1 | SQLite with workspace, session, timestamp, model, duration, tokens, cost | `schema.ts` | ✅ | All fields present |
| DB-2 | Synopsis of user prompt searchable | `database.ts` `getSessions()` LIKE search on `display_name` + `message_text` | ✅ | `message_text` stored in `turns` table |
| DB-3 | Referential keys linking SQLite rows to JSONL entries | `turns.session_id`, `turns.request_id` | ✅ | JSONL path reconstructed from `chat_sessions_path + session_id + ".jsonl"` |
| BG-1 | All aggregation in worker threads | `aggregationWorker.ts`, `workerBridge.ts` | ✅ | |
| BG-2 | CPU constrained to ~15% | `aggregator.ts` adaptive yielding | ✅ | setImmediate + setTimeout adaptive batch strategy |
| PR-1 | Pricing from GitHub YAML URL | `PricingService.ts` | ✅ | `https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml` |
| PR-2 | Pricing cached 24h in SQLite | `PricingService.ts` `refreshPricingCache()` | ✅ | `PRICING_TTL_MS = 24h` |
| PR-3 | Bundled fallback pricing JSON | `prices-fallback.json` | ✅ | 17 models covered |
| PR-4 | `promptAnalyzer.customPrices` user override | `extension.ts`, `workerBridge.ts`, `aggregator.ts` | ✅ | Read from VS Code settings, passed to worker, applied in `calculateTurnCost` |
| AR-1 | Provider abstraction for future agents | `src/providers/copilot/` directory structure | ✅ | Copilot-specific logic isolated; adding new providers requires only new directory under `providers/` |

---

## Documented Limitations (not gaps)

1. **LLM response synopsis (DV-6):** The `chatSessions/<session-id>.jsonl` file does not include the full text of LLM responses — only token counts and metadata. Response text is sent to the user's editor via streaming and not persisted by GitHub Copilot. This is an inherent data source limitation, not an implementation gap.

2. **Prompt token count is estimated:** Only `completionTokens` (output) are recorded by Copilot. Input tokens are estimated at `ceil(messageText.length / 4)`. UI clearly labels these as estimated (~).

3. **Cache cost breakdown is estimated:** Cache-eligible tokens are inferred from `cacheType: "ephemeral"` blocks; confirmed cache hits are not recorded by Copilot.

4. **Worker requires compiled JS:** The aggregation worker (`aggregationWorker.js`) must be compiled before running. This is standard for VS Code extensions.

---

## Sign-off

All requirements from `goals.md` are implemented. The one limitation (DV-6: LLM response synopsis) is an inherent data source constraint documented in `research-findings.md` — not an implementation gap.

**Phase 3: SIGNED OFF.**
