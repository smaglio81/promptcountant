# Prompt Analyzer — Goals

## Overview

Create a VS Code extension that makes AI chat session information easier for users to review, surfacing models used, token counts, and estimated costs across sessions.

Many AI coding agents store prompt history on disk — what was sent to the LLM and what came back. GitHub Copilot stores this under:

```
%APPDATA%\Code - Insiders\User\workspaceStorage\<workspace-hash>\GitHub.copilot-chat\debug-logs\<session-id>\main.jsonl
```

The goal is to read those files, aggregate the data, and present it in a useful, searchable UI inside VS Code.

---

## Scope — v1

**Supported agents: GitHub Copilot only.**

Other agents (Claude, Cursor, Pi/pi.dev) are out of scope for v1. The architecture should be designed with a provider abstraction so additional agents can be added later, but they will not be implemented now.

---

## UI / UX

The extension will use a combination of VS Code editor surfaces as needed; flexibility here is important for the long run. For v1, the primary surface is a sidebar panel structured as follows:

1. **Search bar** — an input box at the top of the panel. As the user types, it filters the tree view in real time.
2. **Tree view** — below the search bar, sessions grouped by workspace. The workspace with the most recent activity appears at the top; within each workspace, sessions are sorted most-recent-first. The first top-level node under the extension heading is **Copilot**.

### Session Naming

Session folder names are GUIDs. The extension should translate each session ID to the human-readable name that GitHub Copilot Chat shows the user in its UI.

The workspace hash in the storage path should be translated to the workspace's leaf folder name (e.g., `my-project`) for display in the tree.

> **Open (research required):** Determine where GitHub Copilot stores the human-readable session name on disk, and how the workspace hash maps to an actual workspace folder path.

---

## Session Discovery

On first load, the extension discovers all GitHub Copilot chat sessions across every workspace ever opened on the machine — not just the current workspace.

The user is notified that background aggregation is starting and that sessions will appear as analysis completes.

---

## Session Detail View

Double-clicking a session opens a detail view showing a virtualized list of JSONL entries (not the raw file dump). Each row in the list displays:

- Role / type label (from JSONL data)
- Timestamp (from JSONL data)
- Truncated preview of the user prompt or agent message
- Summary of the overall prompt or response

For entries that represent a call to the LLM, additionally show:

- Duration of the LLM call (from JSONL data)
- Tokens sent / tokens received
- Model used

Drilling into a specific row loads the full entry details directly from the original JSONL file on demand.

---

## Data Storage

### SQLite Database

Aggregated data is stored locally in a SQLite database for fast lookup and search. The schema should include at minimum:

- Workspace name
- Session ID and display name
- Date / timestamp
- Model
- Duration
- Tokens sent / tokens received
- Calculated cost
- Synopsis of the user prompt
- Synopsis of the LLM response
- Any additional fields that would be useful for search

This SQLite data drives the session list and search results. Full entry details are fetched from the original JSONL file on demand when a user drills into a row.

Referential keys linking SQLite rows back to specific JSONL entries need to be designed as part of schema planning.

> **Open (research required):** Confirm the standard SQLite binding approach for VS Code extensions (likely `better-sqlite3` or `sql.js`) and adopt that convention.

---

## Background Processing

All aggregation runs on **worker threads** so it never blocks the UI. CPU usage must be constrained to approximately 15% to avoid impacting the user.

> **Open (research required):** Determine whether Node.js worker threads expose a built-in CPU throttling mechanism. If not, design an explicit yielding/batching strategy (e.g., `setImmediate`-based pausing between chunks). Revisit before implementation.

---

## Notifications Policy

The extension must not interrupt the user with success or status notifications (info toasts, "sizzle" popups, etc.). Notifications are reserved for actual error conditions only.

- **Errors** → `vscode.window.showErrorMessage` / `showWarningMessage` (use sparingly).
- **Progress / activity** → silent, or surfaced in a non-modal place (e.g., a status bar item) if needed.
- **Successes** → silent. The user can infer success from the UI updating.

This rule applies to all surfaces: extension activation, background aggregation, refresh actions, and any future commands.

---

## Pricing / Cost Estimation

The extension calculates estimated cost for each LLM interaction using the token counts from the JSONL entries and per-model pricing rates.

> **Open (research required):** Determine whether a public API exists that provides current LLM pricing by model (cost per million tokens input/output). If no suitable API exists, define a fallback — e.g., a bundled pricing table or user-configurable rates.

**Resolved:** Use GitHub's authoritative Copilot pricing YAML at `https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml` (public, no auth). Prices are per-1M tokens with `input`, `cached_input`, `output`, and `cache_write` fields. Cache in SQLite with a 24-hour TTL. Ship a bundled fallback JSON for offline/error scenarios. OpenRouter (`https://openrouter.ai/api/v1/models`) is a secondary reference for models not yet listed in the GitHub YAML. See research-findings.md Item 8.

---

## Open Research Items

| # | Item | Notes |
|---|------|-------|
| 4 | Session-to-workspace association | How does a Copilot session folder map to a VS Code workspace? Encoded in path, metadata file, or elsewhere? |
| 5 | Session ID → display name | Where is the human-readable session name stored on disk? |
| 8 | Pricing API | Is there a public API for LLM pricing by token? (Check pi.dev and others.) |
| 9 | SQLite binding for VS Code extensions | Confirm standard approach before implementation. |
| 10 | CPU throttling in worker threads | Do Node.js worker threads support CPU limits natively? If not, design a yielding strategy. |
