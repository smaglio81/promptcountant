# Prompt Analyzer — Project Instructions

## What This Project Is

A VS Code extension that parses GitHub Copilot's on-disk chat session logs, aggregates token usage and cost data, and presents it in a searchable sidebar UI.

## Key Documents

- **Goals**: `d:/workspace/prompt-analyzer/.agents/design-docs/goals.md` — authoritative requirements
- **Draft Goal**: `d:/workspace/prompt-analyzer/.agents/design-docs/draft-goal.md` — original user intent (reference only)
- **Research Findings**: `d:/workspace/prompt-analyzer/.agents/design-docs/research-findings.md` — resolved open questions (created during Phase 1)

## Tech Stack (v1)

- **Language**: TypeScript
- **Platform**: VS Code Extension API
- **UI**: Sidebar TreeView + Webview panel for session detail
- **Storage**: SQLite (binding TBD via research)
- **Background processing**: Node.js `worker_threads`
- **Tests**: Jest (or Mocha — confirm during setup)

## Data Source (GitHub Copilot)

Session logs live at:
```
%APPDATA%\Code - Insiders\User\workspaceStorage\<workspace-hash>\GitHub.copilot-chat\debug-logs\<session-id>\main.jsonl
```

Each `main.jsonl` contains one JSON object per line. Entries where the agent communicated with the LLM contain token counts, model name, and duration.

## Agent Roles

| Agent | Purpose |
|-------|---------|
| Orchestrator | Coordinates all phases; invoke this to start the pipeline |
| Researcher | Resolves open research questions |
| Implementer | Builds the extension |
| Critic | Challenges decisions and finds weaknesses |
| Requirements Reviewer | Validates implementation against goals.md |
| UX Reviewer | Evaluates usability from an end-user perspective |

## Coding Standards

- No deprecated VS Code APIs
- No UI-thread blocking — all heavy processing in worker threads
- Unit tests for every module
- All file paths use forward slashes in code; handle Windows/Mac paths at runtime
