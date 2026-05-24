# Change Log

All notable changes to the "Promptcountant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.1]

Initial release.

### Added

- **Sessions sidebar** — Activity Bar view that lists every GitHub Copilot chat session ever recorded on this machine, grouped by workspace. Workspaces and sessions are sorted most-recent-first.
- **Live search** — type in the sidebar search box to filter sessions by display name in real time.
- **Session detail panel** — double-click a session to open a per-turn view showing role, timestamp, model, duration, tokens sent / received, and estimated cost for each turn.
- **Aggregated reports** — open a report scoped to a single session, a single workspace, or everything. Reports summarize token totals and estimated cost per model.
- **Estimated cost calculation** — pricing pulled from GitHub's public Copilot pricing table (cached locally for 24 hours) with a bundled fallback for offline use. Input, cached-input, and output token rates are all applied per model.
- **Per-model price overrides** — set custom rates via the `promptcountant.customPrices` setting when you want to model a different price than the catalog.
- **Telemetry-accurate token counts** — when Copilot's `github.copilot.chat.agentDebugLog.fileLogging.enabled` setting is on, exact token counts and cache-hit totals are read from Copilot's `main.jsonl` debug logs. Sessions without telemetry show a banner and fall back to character-based estimates.
- **Background aggregation** — first-load scan and incremental refreshes run on a worker thread with CPU yielding so the UI stays responsive even with thousands of sessions.
- **Commands**:
  - `Promptcountant: Refresh` — re-scan for new sessions and turns.
  - `Promptcountant: Collapse All` — collapse all workspaces in the sidebar.
  - `Promptcountant: Recompute Costs (Fast)` — re-apply current pricing to every stored turn without re-parsing session files.
  - `Promptcountant: Clear Database & Re-scan All Sessions` — wipe the local cache and rebuild from scratch.
- **Quiet by default** — no success notifications. Errors are surfaced only when something actually goes wrong.
