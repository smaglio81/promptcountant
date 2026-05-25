# Change Log

All notable changes to the "Promptcountant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0]

### Added

- **Cross-variant session aggregation** — Promptcountant now reads Copilot chat sessions from *all* VS Code variants installed on your machine (stable **Code** and **Code - Insiders**) at the same time. Previously only the variant running the extension was scanned; now both are aggregated into a single view so no sessions are missed regardless of which VS Code you used for a conversation.

## [0.0.2]

Release focused on UX polish, richer sidebar cost visibility, and report improvements.

### Added

- **Sidebar cost rollups** — each workspace node now shows its total estimated cost. The root Copilot node shows the grand total across all workspaces.
- **Pie charts in Time bucket cards** — every daily, weekly, and monthly card now includes a model-usage pie chart so you can see model share at a glance without switching to the chart view.

### Changed

- README now includes a top-level context note about the Premium Requests to AI Credits transition and a screenshot of the extension UI.
- Sidebar provider icon updated to use a Copilot glyph sourced from `vscode-icons` (MIT licensed), with attribution added in `LICENSE`.
- Cost report model filter now supports multi-select chips (`All` + multiple model picks) for easier focused comparisons.
- **Report time range slicer moved to the header** — the range selector (7 days / 30 days / 90 days / All) now sits in the report header alongside the KPI counters. Changing the range updates the non-TODAY KPI values (TOTAL, COSTS, STEPS) immediately, not just the tab content.
- **"Cost" tab renamed to "Models"** — the third report tab is now labelled "Models" to better reflect that it lists per-model cost comparisons, not just a raw cost summary.
- **Report kicker updated** — the header kicker now reads `PROMPTCOUNTANT · REPORT (COPILOT)` to identify the data source.
- **Pie chart promoted in chart view** — the model-usage pie chart is now the first chart visible in the Time chart view, no longer requiring scrolling past multiple line charts.

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
