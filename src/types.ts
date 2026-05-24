// Shared type definitions for Prompt Analyzer

export interface WorkspaceInfo {
  hash: string;
  displayName: string;
  workspacePath: string | null;
}

export interface SessionInfo {
  sessionId: string;
  workspaceHash: string;
  displayName: string;
  chatSessionsPath: string;
  createdAt: number | null;
  telemetryDisabled: boolean;
}

export interface TurnInfo {
  requestId: string;
  sessionId: string;
  timestamp: number;
  modelId: string;
  /**
   * For `copilot/auto` turns, the actual model id Copilot routed the request
   * to (e.g. `gpt-5.3-codex`). Null/undefined for explicit model selections.
   */
  resolvedModel?: string | null;
  completionTokens: number | null;
  estimatedPromptTokens: number | null;
  cacheEligibleTokens: number;
  elapsedMs: number | null;
  messageText: string;
  isCompleted: boolean;
  estimatedCost: number | null;
}

export interface PricingEntry {
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  cacheWritePerM: number | null;
}

export type WorkerMessageType =
  | 'progress'
  | 'session_added'
  | 'error'
  | 'complete'
  | 'paused';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: unknown;
}

export interface AggregationProgress {
  workspacesFound: number;
  sessionsFound: number;
  sessionsProcessed: number;
  turnsProcessed: number;
}

// Database row shapes (snake_case to match SQLite column names)
export interface DbWorkspace {
  hash: string;
  display_name: string;
  workspace_path: string | null;
  latest_activity: number | null;
  session_count: number;
}

export interface DbSession {
  session_id: string;
  workspace_hash: string;
  display_name: string;
  created_at: number | null;
  updated_at: number | null;
  total_turns: number;
  total_cost: number | null;
  chat_sessions_path: string;
  telemetry_disabled: number;
}

export interface DbTurn {
  id: number;
  session_id: string;
  request_id: string;
  timestamp: number | null;
  model_id: string | null;
  resolved_model?: string | null;
  completion_tokens: number | null;
  estimated_prompt_tokens: number | null;
  cache_eligible_tokens: number;
  elapsed_ms: number | null;
  message_text: string | null;
  estimated_cost: number | null;
  is_completed: number;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export type ReportScope =
  | { type: 'all' }
  | { type: 'workspace'; workspaceHash: string }
  | { type: 'session'; sessionId: string };

/** Flat row produced by `PromptAnalyzerDb.getReportRows`. */
export interface ReportRow {
  workspace_hash: string;
  workspace_display_name: string;
  session_id: string;
  session_display_name: string;
  timestamp: number;
  model_id: string | null;
  resolved_model?: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_tokens: number;
  cost: number | null;
  duration_ms: number | null;
  telemetry_disabled: number;
}
