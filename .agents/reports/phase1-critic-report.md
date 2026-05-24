# Phase 1 Critic Report

**Date:** 2026-05-23  
**Reviewed:** `research-findings.md` (initial draft)

---

## Summary

No **Critical** issues found. Two **Major** issues identified and resolved inline before publishing final findings. Three **Moderate** observations noted for implementation awareness.

---

## Issue Log

### MAJOR-1: Multi-root workspace `workspace.json` format not covered

**Description:** The initial findings only documented the `{ "folder": "..." }` format for `workspace.json`. Multi-root workspaces opened from a `.code-workspace` file use a `{ "workspace": "..." }` key instead. Without handling both keys, the extension would silently skip all multi-root workspaces.

**Evidence:** On this machine, all current workspaces are single-folder (no `.code-workspace` workspaces present to verify). Format is documented in VS Code internals.

**Resolution:** Updated Item 4 implementation notes to handle both `folder` and `workspace` keys, with separate display-name derivation logic for each. Also documented that non-hash folder names (`ext-dev`, numeric IDs) always lack `workspace.json` and should be skipped.

**Status: RESOLVED in findings.**

---

### MAJOR-2: Prompt token estimation algorithm unspecified

**Description:** The initial findings stated that prompt tokens are unavailable and must be "estimated from `message.text`" without specifying how. An unspecified estimation strategy could lead to wildly inconsistent implementations (full tokenizer library vs. simple heuristic vs. nothing).

**Resolution:** Updated the Data Schema section to specify the character-count heuristic: `Math.ceil(message.text.length / 4)`. Labeled estimates clearly in the UI recommendation. Specified fallback to `N/A` when message text is unavailable.

**Status: RESOLVED in findings.**

---

### MODERATE-1: Concurrent file write handling not addressed

**Description:** A live Copilot session actively writes to `chatSessions/<session-id>.jsonl`. The findings did not specify how to handle truncated JSON lines or in-progress requests.

**Resolution:** Added a note in the Data Schema section: parse errors per line should be caught and skipped; requests with `modelState.value !== 1` should be treated as in-progress and excluded from aggregation until the next poll cycle.

**Status: RESOLVED in findings.**

---

### MODERATE-2: `customTitle` absent for new/short sessions

**Description:** Sessions that haven't yet received an AI-generated title have no `customTitle` patch. The findings did not specify a fallback display value.

**Resolution:** Added fallback: display `Session <YYYY-MM-DD HH:MM>` derived from `creationDate` in the `kind=0` snapshot.

**Status: RESOLVED in findings.**

---

### MODERATE-3: `models.json` role not fully articulated

**Description:** `debug-logs/<session-id>/models.json` contains the full list of models available during a session (context window sizes, capability flags, billing multiplier). This file could be used to supplement the static `prices.json` table for display metadata (model display name, context limits). Not flagged as a gap in the findings.

**Recommendation (deferred):** During implementation, consider reading `models.json` per session to populate the model display name and context window shown in the detail view. Not a blocker for Phase 1 research.

**Status: DEFERRED to implementation.**

---

## Verdict

**Phase 1 research is COMPLETE.** All five items from `goals.md` are RESOLVED with no open Critical or Major issues.

The two Major issues were patched inline in `research-findings.md` before this report was filed. The Moderate items are either already addressed (1, 2) or deferred to implementation (3).

**Proceed to Phase 2 (Implementation) when ready.**
