# Promptcountant

> **Note —** This extensions was built to understand what the cost conversion might be like when GitHub Copilot switches away from Premium Requests. It probably won't be on much use after June 1, 2026.

See how much your GitHub Copilot chat conversations are costing you — directly inside **VS Code**.

Promptcountant reads GitHub Copilot's on-disk chat history, adds up the tokens you've sent and received per model, and shows the estimated dollar cost for every session, every workspace, and your machine as a whole.

![Promptcountant](resources/prompcountant-main.png)

## What it does

Promptcountant adds a sidebar to the Activity Bar with three things:

- **Search box** — type to filter the session list in real time.
- **Session tree** — every Copilot chat session you have ever had, grouped by workspace, sorted most-recent-first.
- **Reports** — open a summary scoped to a single session, a single workspace, or everything across your machine. Each report breaks down total tokens and estimated cost per model.

Double-click any session to open a detail panel showing each turn: the model used, the duration, tokens sent, tokens received, and the estimated cost for that turn.

## Getting started

1. Install the extension.
2. Open the **Promptcountant** panel from the Activity Bar.
3. The first time it runs, Promptcountant scans every Copilot chat session stored on your machine in the background. Sessions appear in the sidebar as analysis completes — you can start clicking around right away.
4. Click any session to open its detail view, or use the report button to see totals across a workspace.

That's it. There is nothing to configure to get started.

## Key features

**Per-session cost breakdown** — every turn shows the model used, duration, input/output token counts, and the estimated dollar cost using current Copilot pricing.

**Reports at any scope** — see totals for a single session, an entire workspace, or all your activity together. Each report groups results by model so you can tell which models are driving spend.

**Accurate token counts when telemetry is enabled** — if you turn on Copilot's debug logging (`github.copilot.chat.agentDebugLog.fileLogging.enabled` in VS Code settings), Promptcountant uses the exact token counts reported by the LLM, including cache-hit totals. Sessions without telemetry still work — they fall back to a character-based estimate.

> **Tip — get precise costs.** Without telemetry, token counts and costs are rough estimates derived from message character length. To capture true tokens and costs for every session going forward, open VS Code settings and enable **`github.copilot.chat.agentDebugLog.fileLogging.enabled`**. Existing sessions that were recorded before telemetry was enabled will continue to show estimates.

**Live pricing with offline fallback** — pricing is pulled from GitHub's public Copilot pricing table once a day. If you're offline, a bundled price list is used so costs still calculate.

**Per-model price overrides** — if you want to model a different rate (custom enterprise pricing, a "what if" comparison, etc.), set `promptcountant.customPrices` in your settings:

```json
"promptcountant.customPrices": {
  "GPT-4o": { "input": 5, "output": 15 }
}
```

Values are USD per 1 million tokens.

**Fast search** — the sidebar filters as you type so you can jump to a session by name.

**Quiet by default** — no popup notifications when things are working. Promptcountant only speaks up when something actually goes wrong.

**Background processing** — large scans run on a worker thread with CPU yielding, so the UI stays responsive even when there are thousands of sessions to crunch through.

## Commands

All commands are available from the Command Palette under the **Promptcountant** category:

- **Refresh** — re-scan for new sessions and turns.
- **Collapse All** — collapse all workspaces in the sidebar tree.
- **Recompute Costs (Fast)** — re-apply current pricing to every stored turn without re-parsing the source files. Useful after editing `promptcountant.customPrices` or after the pricing catalog updates.
- **Clear Database & Re-scan All Sessions** — wipe the local cache and rebuild from scratch. Use this if something looks wrong.

The Refresh, Collapse All, and Recompute Costs commands are also available as icons in the sidebar's title bar.

## Where the data comes from

Promptcountant reads files that GitHub Copilot already writes to your machine — it does not call any external API for your chat content and does not send your prompts anywhere. The only network call is fetching the public Copilot pricing table from `raw.githubusercontent.com`, cached for 24 hours.

Your aggregated session data is stored locally in a small SQLite database inside the extension's storage folder.

## Issues & Feedback

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/smaglio81/promptcountant/issues).
