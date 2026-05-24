# Report View — Design Specification

> Status: Implemented (updated 2026-05-23)
> Inspired by: [sweetim/token-lens](https://github.com/sweetim/token-lens) — landing.jpg
> Target surface: VS Code **editor area** (webview panel, same pattern as `SessionDetailPanel`)

## Recent Implemented Updates (v0.0.2)

- Cost tab model chips support **multi-select** filtering. Users can toggle multiple models simultaneously; selecting `All` clears individual selections.
- Copilot provider row icon in the sidebar uses a `vscode-icons` MIT-licensed glyph rendered with `currentColor` for theme compatibility.
- README was updated with a release-context note and a UI screenshot to improve first-run clarity for end users.
- **Sidebar cost rollups**: `WorkspaceNode` now shows `costLabel` (formatted USD). The root Copilot node shows a grand-total cost derived by summing workspace costs in `postData()`.
- **Time range slicer in header**: the range selector (7d / 30d / 90d / All) moved from the tab nav bar into the `<header>` row. `rebuildKpis()` is called on every chip change and on init to keep TOTAL, COSTS, and STEPS KPIs in sync with the selected range.
- **Pie charts in bucket cards**: every list-mode day/week/month card now renders a `MODEL USAGE` pie chart (top 8 models) below the MODEL COST COMPARISON section.
- **Pie chart at top of chart view**: the model-usage pie block moved to first position in `renderBucketCharts()`, appearing before the token line charts.
- **"Cost" tab renamed to "Models"**: the button display text changed from `Cost` to `Models`; the internal `data-tab="cost"` attribute and `id="panel-cost"` are unchanged.
- **Kicker hardcoded to COPILOT**: `providerSuffix` is now the constant `'COPILOT'` rather than being derived from model providers.

---

## 1. Goals

Provide a rich, multi-tab analytics view of GitHub Copilot chat usage, scoped to any of:

| Scope        | Entry point (right-click menu)                     | Data filter                                |
| ------------ | -------------------------------------------------- | ------------------------------------------ |
| **Global**   | Right-click the **Copilot** root node              | All workspaces, all sessions               |
| **Workspace**| Right-click a **Workspace** node                   | All sessions in that workspace             |
| **Session**  | Right-click a **Session** node                     | A single session                           |

In every menu, **Report** is the **top** entry.

The report opens in the **editor area** (`vscode.window.createWebviewPanel`) — not the sidebar.

---

## 2. Layout

```
┌───────────────────────────────────────────────────────────────────┐
│  PROMPTCOUNTANT · REPORT — <scope title>                          │
├───────────────────────────────────────────────────────────────────┤
│  ╔═════════════════════════════════════════════════════════════╗  │
│  ║  HEADER (shared across all tabs)                            ║  │
│  ║                                                             ║  │
│  ║  ◻ QUOTA USAGE                              reset 42m       ║  │
│  ║  USAGE                                  56.0% USED          ║  │
│  ║  [████████████░░░░░░░░░░░]                                  ║  │
│  ║                                                             ║  │
│  ║  TOTAL TOKEN USAGE                                          ║  │
│  ║  36.6M       299.0M      $136.70      8 602                 ║  │
│  ║  TODAY       TOTAL       COSTS        STEPS                 ║  │
│  ╚═════════════════════════════════════════════════════════════╝  │
│                                                                   │
│  ┌──────────┬──────────┬──────────┐                               │
│  │ PROJECTS │   TIME   │  MODELS  │   ← tab strip                 │
│  └──────────┴──────────┴──────────┘                               │
│                                                                   │
│  <active tab content>                                             │
└───────────────────────────────────────────────────────────────────┘
```

### 2.1 Header (always visible)

| Element            | Source                                                                | Notes                                                                |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Scope title        | "All workspaces" / workspace name / session display name              | Shown in panel title and inside header                               |
| QUOTA USAGE bar    | If we can derive a quota (premium-request %), show it; else **hide**  | v1: hide if unknown — we don't currently track quota                 |
| TODAY              | Sum of input+output tokens for sessions touched in the last 24h       | Within scope                                                         |
| TOTAL              | Sum of all tokens                                                     | Within scope                                                         |
| COSTS              | Sum of `cost_usd` from `turns`                                        | Within scope                                                         |
| STEPS              | Count of turns                                                        | Within scope                                                         |

> v1 decision: **omit the QUOTA USAGE bar** until we have a real quota source. Leaving the four-counter row.

---

## 3. Tab 1 — PROJECTS

Per-project (per-workspace) cards, sorted by cost desc.

**Scope visibility:**
- **Global scope**: list of all workspaces, full cards
- **Workspace scope**: a single card (this workspace) — still useful as a summary
- **Session scope**: a single, compact card for the session (no per-project list)

### Per-card content

```
┌─────────────────────────────────────────────────────────────────┐
│  pictoscan      [145.8M tokens]                       $68.22    │
│  ──────────────────────────────────────────────────────────     │
│  10.3M        1.0M         239           3.8K                   │
│  INPUT        OUTPUT       SESSIONS      STEPS                  │
│                                                                 │
│  • TOTAL TOKENS (sparkline, last 30 days)                       │
│    ╱╲    ╱╲                                                     │
│   ╱  ╲__╱  ╲___                                                 │
│                                                                 │
│  LLM USAGE                                                      │
│  glm-5.1                                            62.9%       │
│  gpt-5.4                                            37.1%       │
│                                                                 │
│  MODEL COST COMPARISON                                          │
│  openai/gpt-5.5-pro                                $639.17      │
│  openai/gpt-5.5                                    $106.33      │
│  anthropic/claude-opus-4.7                         $100.92      │
│  …                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Data required

| Field            | Aggregation                                                       |
| ---------------- | ----------------------------------------------------------------- |
| name             | `workspaces.display_name` (or session display name in session scope) |
| total tokens     | `SUM(input_tokens + output_tokens + reasoning_tokens + cache_*)`  |
| total cost       | `SUM(cost_usd)`                                                   |
| input tokens     | `SUM(input_tokens)`                                               |
| output tokens    | `SUM(output_tokens)`                                              |
| sessions count   | `COUNT(DISTINCT session_id)`                                      |
| steps count      | `COUNT(*) FROM turns`                                             |
| sparkline (30d)  | Daily totals for last 30 days                                     |
| llm usage %      | Per-model token share                                             |
| model cost list  | `SUM(cost_usd) GROUP BY model`                                    |

---

## 4. Tab 2 — TIME

Three sub-toggles: **Daily** · **Weekly** · **Monthly**

Two view modes (right side): **List** / **Chart** toggle.

### 4.1 Daily — List view (default)

Vertical list of day cards (most recent first):

```
Today
  [36.6M tokens]  [2 models]  [4h 15m]
  INPUT    ████████████              2.2M
  OUTPUT   █████████████████████   262.1M
  REASON   ██████                  176.5K
  CACHE R  ████████████             34.0M
  CACHE W                              0
  MODELS   ██████████                   2

  MODEL COST COMPARISON
  openai/gpt-5.5-pro                        $246.37
  openai/gpt-5.5                             $41.06
  anthropic/claude-opus-4.7                  $38.87
  …

Yesterday
  [53.1M tokens]  [2 models]  [14h 13m]
  INPUT  ██                              3.4M
  OUTPUT █                             354.0K

Apr 24
  [17.5M tokens]  [2 models]  [2h 47m]
  …

Apr 23
  …
```

Per-day metadata badges: total tokens, model count, total wall-time (sum of `duration_ms`).
Bars are horizontally normalized **within the day**, not globally.

### 4.2 Weekly / Monthly — same structure, bucketed differently

### 4.3 Chart view

```
LATEST WEEK   AVG / WEEK   PEAK (Apr 19)
206.M         59.8M        206.M
TOTAL TOKENS

[ line chart — total tokens per bucket, last 5 buckets ]

TOKEN BREAKDOWN     ● INPUT  ● OUTPUT  ● REASON  ● CACHE R  ● CACHE W
[ multi-line chart ]

SESSIONS AND STEPS   ● SESSIONS  ● STEPS
[ multi-line chart ]

LLM USAGE (LATEST WEEK)
[ pie chart ]
  • glm-5.1   64.7%
  • gpt-5.4   29.1%
  • gpt-5.3-codex  5.5%
  • anthropic/claude-sonnet-4.6  0.8%
```

### Data required

| Field                   | Aggregation                                              |
| ----------------------- | -------------------------------------------------------- |
| day/week/month buckets  | `GROUP BY date(timestamp, 'unixepoch', 'localtime')`     |
| per-bucket tokens       | by type (input/output/reason/cache_r/cache_w)            |
| per-bucket cost         | `SUM(cost_usd)`                                          |
| per-bucket duration     | `SUM(duration_ms)`                                       |
| per-bucket model count  | `COUNT(DISTINCT model)`                                  |
| sessions per bucket     | `COUNT(DISTINCT session_id)`                             |
| steps per bucket        | `COUNT(*)`                                               |
| pie: model share        | `SUM(tokens) GROUP BY model` for the active bucket       |

---

## 5. Tab 3 — MODELS

```
TOTAL TOKENS   INPUT     OUTPUT    REASONING   CACHE READ
299.2M         20.5M     2.5M      1.4M        274.8M

▾ FILTERS
[ All ] [ai21] [aion-labs] [alfredpros] [alibaba] [allenai] [alpicalei]
[amazon] [antaron] [anthracite-org] [anthropic] [arcee-ai] [baidu]
[bytedance] [cohere-deepcog] [deepseek] [essential] [deepvoid] [deepseai]
[gryphe] [haqouixhotie] [incerpion] [inception] [inflections] [longipice]
[nvidia] [openannotate] [qwenlnest] [coxtai] [partically] [pangstaltrustry]
[nvidia] [openai] [prime-intellect] [qwen] [retreaai] [relicals] [saa10tk]
[relayk] [suoljia] [teamslole] [teamheroughtl] [tencent] [tihwait]
[thedrummer] [tongtech] [und85] [upstage] [veriter] [x-ai] [xiaomi]
[z-ai]   ← provider chips (multi-select, click to filter)

[ Low → High ]  [ High → Low ]    < 3 months  ← sort + time range chips

ESTIMATED COST PER MODEL                            ⓘ

deepseek/deepseek-v4-flash                          $11.64
openai/gpt-5.4-nano                                 $14.39
minimax/minimax-m2.5                                $15.73
deepseek/deepseek-v4-pro                            $22.22
minimax/minimax-m2.7                                $26.97
z-ai/glm-5.4-mini                                   $33.24
z-ai/glm-5                                          $53.26
…
openai/gpt-5.5-pro                                  $2129.59
```

### Data required

| Field              | Aggregation                                                  |
| ------------------ | ------------------------------------------------------------ |
| totals strip       | `SUM(input_tokens)`, `SUM(output_tokens)`, `SUM(reasoning_tokens)`, `SUM(cache_read_tokens)` |
| provider chips     | `DISTINCT split_part(model, '/', 1)`                         |
| cost per model     | `SUM(cost_usd) GROUP BY model`                               |
| time-range filter  | WHERE `timestamp` within selected window                     |
| sort order         | ORDER BY cost ASC / DESC                                     |

Our model strings (e.g. `claude-3-5-sonnet`, `gpt-4o`) don't all have a `provider/` prefix — we'll derive provider from a small lookup map (anthropic, openai, google, …) and use `(unknown)` otherwise.

---

## 6. Scope-aware behaviour

| Element                | Global               | Workspace              | Session                                  |
| ---------------------- | -------------------- | ---------------------- | ---------------------------------------- |
| Header counters        | across all data      | filtered to workspace  | filtered to session                      |
| PROJECTS tab           | all workspace cards  | single workspace card  | single session card (no project list)    |
| TIME tab               | all data bucketed    | filtered + bucketed    | filtered + bucketed; daily view shows only days the session was active |
| MODELS tab             | full filter chips    | provider chips from workspace's models only | provider chips from session's models only |

---

## 7. Implementation plan

### 7.1 New files

| File                                | Purpose                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `src/ui/ReportPanel.ts`             | Webview panel lifecycle (mirror of `SessionDetailPanel`)         |
| `src/ui/reportHtml.ts`              | Pure HTML builder — `buildReportHtml(data, scope)` (testable)    |
| `src/ui/reportData.ts`              | Pure assembly: takes db + scope → `ReportData` object            |
| `src/__tests__/reportHtml.test.ts`  | Snapshot/structural tests                                        |
| `src/__tests__/reportData.test.ts`  | Aggregation tests against in-memory DB                           |

### 7.2 New `PromptAnalyzerDb` methods

```ts
type ReportScope =
  | { type: 'all' }
  | { type: 'workspace'; workspaceId: string }
  | { type: 'session'; sessionId: string };

getReportTotals(scope): { today, total, cost, steps, inputs, outputs, reasoning, cacheRead, cacheWrite }
getReportWorkspaceCards(scope): WorkspaceCard[]
getReportBuckets(scope, granularity: 'day'|'week'|'month', limit): Bucket[]
getReportCostByModel(scope, opts: { since?, sort? }): { model, cost, tokens }[]
getReportModelShare(scope, since?): { model, tokens, pct }[]
```

### 7.3 Charting

No external libraries (CSP-safe). All charts as inline SVG:
- **Line chart**: simple polyline + axis ticks
- **Pie chart**: SVG arcs computed in TS
- **Bars**: CSS flex + width%

All chart builders are pure functions returning SVG strings, easily unit-tested.

### 7.4 New commands (`package.json`)

| Command id                                      | Title                  | Args              |
| ----------------------------------------------- | ---------------------- | ----------------- |
| `promptcountant.openReport`                     | Promptcountant: Report | `ReportScope?`    |
| `promptcountant.openReport.global`              | Report (All)           | —                 |
| `promptcountant.openReport.workspace`           | Report                 | workspaceId       |
| `promptcountant.openReport.session`             | Report                 | sessionId         |

`openReport` reuses the panel if already open, retargeting its scope (matches `SessionDetailPanel` reveal pattern).

### 7.5 Sidebar wiring

The single-webview sidebar's custom context menu (built in this batch alongside the Report) lists **Report** as the top entry for all three node types. The handler posts a message to the extension that calls `openReport` with the appropriate scope.

### 7.6 Theming

Use VS Code CSS variables: `--vscode-editor-background`, `--vscode-foreground`, `--vscode-charts-blue`, `--vscode-charts-orange`, `--vscode-charts-green`, `--vscode-charts-purple`, `--vscode-charts-red`. No hard-coded colors.

---

## 8. Out of scope (v1)

- Quota usage bar (no quota data source yet)
- Provider chip multi-select **persistence** across sessions (in-memory only)
- Export to CSV / PNG
- Real-time auto-refresh (manual refresh button only; same pattern as detail view)
- Drill-down from a chart bar into the detail view (future enhancement)

---

## 9. Open questions for the user

1. **Quota bar** — confirm we should omit it for v1, or do you want a placeholder (e.g. premium-request count if discoverable)?

Yes

2. **Default tab** — TIME (matches token-lens default) or PROJECTS (more useful for our scope variety)? Suggest **PROJECTS** for global/workspace scopes; **TIME** for session scope.

Time

3. **Time-range chip** on COST tab — token-lens shows `< 3 months`. Offer `7d / 30d / 90d / all`?

Yes, please.

4. **Sparkline window** on PROJECTS cards — 30 days OK, or match the COST tab's range chip?

match the COST tab's range chip
