import * as fs from 'fs';
import * as path from 'path';
import { SessionInfo, TurnInfo } from '../../types';

// ─── Legacy JSON file shape (pre-Feb 2026 single-object format) ──────────────

interface LegacySelectedModel {
  id?: string;
  identifier?: string;
}

interface LegacyRequestResult {
  metadata?: {
    promptTokens?: number;
    outputTokens?: number;
    modelId?: string;
    toolCallRounds?: unknown[];
  };
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  timings?: {
    requestSent?: number;
    firstTokenReceived?: number;
  };
  value?: string;
}

interface LegacyResponseItem {
  value?: string | { content?: string };
  content?: string;
}

interface LegacyRequest {
  message?: { text?: string };
  variableData?: { variables?: Array<{ value?: unknown }> };
  response?: LegacyResponseItem[] | { result?: LegacyRequestResult };
}

interface LegacySessionFile {
  sessionId?: string;
  creationDate?: number;
  selectedModel?: LegacySelectedModel;
  requests?: LegacyRequest[];
}

// ─── JSONL line shapes ────────────────────────────────────────────────────────

interface SnapshotLine {
  kind: 0;
  v: {
    sessionId?: string;
    creationDate?: number;
    customTitle?: string;
    requests?: unknown[];
    [key: string]: unknown;
  };
}

interface PatchLine {
  kind: 1;
  k: (string | number)[];
  v: unknown;
}

/**
 * Array splice op. `k` is the path to an array. `i` is the insertion index
 * (when undefined or out of range, items are pushed to the end). `v` is the
 * array of items to insert. No deletes — Copilot only appends in practice.
 */
interface SpliceLine {
  kind: 2;
  k: (string | number)[];
  v: unknown[];
  i?: number;
}

type ChatSessionLine = SnapshotLine | PatchLine | SpliceLine;

// ─── Session state shape (post-replay) ────────────────────────────────────────

interface RequestState {
  requestId?: string;
  timestamp?: number;
  modelId?: string;
  completionTokens?: number;
  elapsedMs?: number;
  modelState?: { value?: number; completedAt?: number };
  message?: { text?: string };
  result?: {
    metadata?: {
      renderedUserMessage?: Array<{ type?: number; cacheType?: string; tokens?: number; text?: string }>;
      resolvedModel?: string;
    };
    details?: string;
  };
}

interface SessionState {
  id?: string;
  creationDate?: number;
  customTitle?: string;
  requests?: RequestState[];
  [key: string]: unknown;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ParsedChatSession {
  sessionInfo: SessionInfo;
  turns: TurnInfo[];
}

/**
 * Lists all session IDs found in a chatSessions directory.
 * Each .jsonl file corresponds to one session (filename = session-id.jsonl).
 */
export function listSessionIds(chatSessionsPath: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(chatSessionsPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
    .map(e => e.name.slice(0, -6)); // strip ".jsonl"
}

/**
 * Lists all session files in a chatSessions directory, covering both the
 * current JSONL format and the legacy single-object JSON format (pre-Feb 2026).
 * JSONL files take precedence: if a session exists as both .jsonl and .json
 * (shouldn't happen in practice), only the JSONL entry is returned.
 */
export function listSessionFiles(
  chatSessionsPath: string
): Array<{ sessionId: string; filePath: string }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(chatSessionsPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const results: Array<{ sessionId: string; filePath: string }> = [];

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.endsWith('.jsonl')) {
      const sessionId = e.name.slice(0, -6);
      seen.add(sessionId);
      results.push({ sessionId, filePath: path.join(chatSessionsPath, e.name) });
    }
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.endsWith('.json')) {
      const sessionId = e.name.slice(0, -5);
      if (!seen.has(sessionId)) {
        seen.add(sessionId);
        results.push({ sessionId, filePath: path.join(chatSessionsPath, e.name) });
      }
    }
  }

  return results;
}

/**
 * Resolves the on-disk session file path for a given session ID, trying the
 * current JSONL format first and falling back to the legacy JSON format.
 * Returns the JSONL path even if neither file exists (callers handle absence).
 */
export function resolveSessionFilePath(chatSessionsPath: string, sessionId: string): string {
  const jsonlPath = path.join(chatSessionsPath, `${sessionId}.jsonl`);
  if (fs.existsSync(jsonlPath)) return jsonlPath;
  const jsonPath = path.join(chatSessionsPath, `${sessionId}.json`);
  if (fs.existsSync(jsonPath)) return jsonPath;
  return jsonlPath;
}

/**
 * Parses a single chatSessions JSONL file and extracts session metadata
 * and all completed LLM turns. Dispatches to the legacy JSON parser when
 * the path ends with `.json`.
 */
export function parseChatSessionFile(
  filePath: string,
  sessionId: string,
  workspaceHash: string
): ParsedChatSession | null {
  if (filePath.endsWith('.json')) {
    return parseLegacyChatSessionFile(filePath, sessionId, workspaceHash);
  }
  return parseJsonlChatSessionFile(filePath, sessionId, workspaceHash);
}

/**
 * Parses a legacy (pre-Feb 2026) single-object .json session file.
 */
function parseLegacyChatSessionFile(
  filePath: string,
  sessionId: string,
  workspaceHash: string
): ParsedChatSession | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  let data: LegacySessionFile;
  try {
    data = JSON.parse(raw) as LegacySessionFile;
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;

  const resolvedSessionId = data.sessionId || sessionId;
  const createdAt = typeof data.creationDate === 'number' ? data.creationDate : null;
  const customTitle = null; // legacy format has no custom title field
  const displayName = customTitle ?? formatFallbackTitle(createdAt);
  const chatSessionsPath = path.dirname(filePath);

  const topLevelModelId =
    (typeof data.selectedModel?.id === 'string' ? data.selectedModel.id : null) ??
    (typeof data.selectedModel?.identifier === 'string' ? data.selectedModel.identifier : null) ??
    '';

  const sessionInfo: SessionInfo = {
    sessionId: resolvedSessionId,
    workspaceHash,
    displayName,
    chatSessionsPath,
    createdAt,
    telemetryDisabled: true // legacy files never have a paired debug-log
  };

  const requests = Array.isArray(data.requests) ? data.requests : [];
  const turns: TurnInfo[] = [];

  for (let idx = 0; idx < requests.length; idx++) {
    const req = requests[idx];
    if (!req || typeof req !== 'object') continue;

    // ── Token counts ─────────────────────────────────────────────────────────
    const resp = req.response;
    const result: LegacyRequestResult | undefined =
      !Array.isArray(resp) && typeof resp === 'object' && resp !== null
        ? (resp as { result?: LegacyRequestResult }).result
        : undefined;

    const md = result?.metadata;
    const usage = result?.usage;

    let promptTokens: number =
      (typeof md?.promptTokens === 'number' ? md.promptTokens : 0) ||
      (typeof usage?.promptTokens === 'number' ? usage.promptTokens : 0);

    let completionTokens: number | null =
      (typeof md?.outputTokens === 'number' ? md.outputTokens : null) ??
      (typeof usage?.completionTokens === 'number' ? usage.completionTokens : null);

    // Fall back to char-count estimate when token fields are absent
    const messageText = typeof req.message?.text === 'string' ? req.message.text : '';
    if (!promptTokens && messageText.length > 0) {
      promptTokens = Math.ceil(messageText.length / 4);
    }
    if (!completionTokens) {
      completionTokens = estimateLegacyResponseTokens(req) || null;
    }

    // ── Model ─────────────────────────────────────────────────────────────────
    const modelId =
      (typeof md?.modelId === 'string' ? md.modelId : '') || topLevelModelId;

    // ── Timestamp ─────────────────────────────────────────────────────────────
    const timestamp =
      (typeof result?.timings?.requestSent === 'number' ? result.timings.requestSent : null) ??
      (typeof result?.timings?.firstTokenReceived === 'number' ? result.timings.firstTokenReceived : null) ??
      createdAt ??
      0;

    // Use a stable synthetic requestId since legacy JSON has no request IDs
    const requestId = `${resolvedSessionId}:${idx}`;

    turns.push({
      requestId,
      sessionId: resolvedSessionId,
      timestamp,
      modelId,
      resolvedModel: null,
      completionTokens,
      estimatedPromptTokens: promptTokens || null,
      cacheEligibleTokens: 0,
      elapsedMs: null,
      messageText,
      isCompleted: true,
      estimatedCost: null
    });
  }

  return { sessionInfo, turns };
}

function estimateLegacyResponseTokens(req: LegacyRequest): number {
  const resp = req.response;
  const parts: string[] = [];

  if (Array.isArray(resp)) {
    for (const item of resp) {
      if (!item || typeof item !== 'object') continue;
      const val = item.value;
      if (typeof val === 'string') parts.push(val);
      else if (typeof val === 'object' && val !== null && typeof (val as { content?: string }).content === 'string') {
        parts.push((val as { content: string }).content);
      }
      if (typeof item.content === 'string') parts.push(item.content);
    }
  } else if (typeof resp === 'object' && resp !== null) {
    const result = (resp as { result?: LegacyRequestResult }).result;
    if (typeof result?.value === 'string') parts.push(result.value);
  }

  const total = parts.join('').length;
  return total > 0 ? Math.ceil(total / 4) : 0;
}

/**
 * Parses a single chatSessions JSONL file and extracts session metadata
 * and all completed LLM turns.
 */
function parseJsonlChatSessionFile(
  filePath: string,
  sessionId: string,
  workspaceHash: string
): ParsedChatSession | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n');
  const state: SessionState = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: ChatSessionLine;
    try {
      parsed = JSON.parse(trimmed) as ChatSessionLine;
    } catch {
      // Truncated or malformed line — skip
      continue;
    }

    if (parsed.kind === 0) {
      // Full snapshot — actual session state is wrapped in `v`
      if (parsed.v && typeof parsed.v === 'object') {
        Object.assign(state, parsed.v);
      }
    } else if (parsed.kind === 1) {
      // Incremental patch
      setByPath(state as Record<string, unknown>, parsed.k, parsed.v);
    } else if (parsed.kind === 2) {
      // Array splice — insert items into an array at path k
      spliceByPath(
        state as Record<string, unknown>,
        parsed.k,
        parsed.i,
        Array.isArray(parsed.v) ? parsed.v : []
      );
    }
  }

  // Build session display name
  const customTitle = typeof state.customTitle === 'string' ? state.customTitle : null;
  const createdAt = typeof state.creationDate === 'number' ? state.creationDate : null;
  const displayName = customTitle ?? formatFallbackTitle(createdAt);

  const chatSessionsPath = path.dirname(filePath);

  // Feature: Read debug-logs to extract precise token telemetry
  // Navigate defensively: if chatSessionsPath is already nested inside
  // GitHub.copilot-chat, avoid duplicating that path segment.
  const hashDir = path.dirname(chatSessionsPath);
  const copilotChatDir =
    path.basename(hashDir) === 'GitHub.copilot-chat'
      ? hashDir
      : path.join(hashDir, 'GitHub.copilot-chat');
  const debugLogsDir = path.join(copilotChatDir, 'debug-logs', sessionId);
  const debugLogPath = path.join(debugLogsDir, 'main.jsonl');
  let hasTelemetry = false;

  const telemetryByResponseId = new Map<string, { inputTokens: number; outputTokens: number; cachedTokens: number }>();

  try {
    if (fs.existsSync(debugLogPath)) {
      const debugRaw = fs.readFileSync(debugLogPath, 'utf8');
      for (const line of debugRaw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && parsed.type === 'llm_request') {
            hasTelemetry = true;
            if (typeof parsed.responseId === 'string') {
              telemetryByResponseId.set(parsed.responseId, {
                inputTokens: typeof parsed.inputTokens === 'number' ? parsed.inputTokens : 0,
                outputTokens: typeof parsed.outputTokens === 'number' ? parsed.outputTokens : 0,
                cachedTokens: typeof parsed.cachedTokens === 'number' ? parsed.cachedTokens : 0
              });
            }
          }
        } catch {
          // Ignore malformed lines
        }
      }
    }
  } catch {
    // Ignore permissions/read errors
  }

  const sessionInfo: SessionInfo = {
    sessionId,
    workspaceHash,
    displayName,
    chatSessionsPath,
    createdAt,
    telemetryDisabled: !hasTelemetry
  };

  const turns = extractTurns(state.requests ?? [], sessionId);

  // Apply telemetry overrides to turns. Join key: transcript `requestId`
  // ↔ debug-log `responseId`. If telemetry was parsed but nothing joined,
  // log a warning so a future schema change in either file surfaces fast.
  let matched = 0;
  for (const t of turns) {
    const tel = telemetryByResponseId.get(t.requestId);
    if (tel) {
      t.estimatedPromptTokens = tel.inputTokens + tel.cachedTokens;
      t.cacheEligibleTokens = tel.cachedTokens;
      t.completionTokens = tel.outputTokens;
      matched++;
    }
  }
  if (telemetryByResponseId.size > 0 && matched === 0 && turns.length > 0) {
    console.warn(
      `[prompt-analyzer] Telemetry present for session ${sessionId} ` +
      `(${telemetryByResponseId.size} llm_request events) but no turns ` +
      `joined on requestId↔responseId. Falling back to estimates.`
    );
  }

  return { sessionInfo, turns };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Sets a value at an arbitrary JSON path within an object.
 * Creates intermediate objects/arrays as needed.
 */
function setByPath(
  obj: Record<string, unknown>,
  keys: (string | number)[],
  value: unknown
): void {
  if (keys.length === 0) return;

  let current: Record<string, unknown> | unknown[] = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    const currentAsRecord = current as Record<string | number, unknown>;
    const existing = currentAsRecord[key];

    if (typeof existing !== 'object' || existing === null) {
      currentAsRecord[key] = typeof nextKey === 'number' ? [] : {};
    }

    const next = currentAsRecord[key];
    if (Array.isArray(next)) {
      current = next as unknown[];
    } else {
      current = next as Record<string, unknown>;
    }
  }

  const lastKey = keys[keys.length - 1];
  const currentAsRecord = current as Record<string | number, unknown>;

  if (Array.isArray(current) && typeof lastKey === 'number') {
    // Extend sparse array slots
    while ((current as unknown[]).length <= lastKey) {
      (current as unknown[]).push(undefined);
    }
  }
  currentAsRecord[lastKey] = value;
}

/**
 * Inserts items into an array located at `keys` within `obj`. Creates the
 * array (and any intermediate containers) if missing. When `index` is
 * undefined or beyond the current length, items are appended.
 */
function spliceByPath(
  obj: Record<string, unknown>,
  keys: (string | number)[],
  index: number | undefined,
  items: unknown[]
): void {
  if (keys.length === 0) return;

  // Walk to the parent of the target array, creating containers as needed
  let current: Record<string | number, unknown> = obj as Record<string | number, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    const existing = current[key];
    if (typeof existing !== 'object' || existing === null) {
      current[key] = typeof nextKey === 'number' ? [] : {};
    }
    current = current[key] as Record<string | number, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  let target = current[lastKey];
  if (!Array.isArray(target)) {
    target = [];
    current[lastKey] = target;
  }
  const arr = target as unknown[];

  const insertAt =
    typeof index === 'number' && index >= 0 && index <= arr.length ? index : arr.length;
  arr.splice(insertAt, 0, ...items);
}

/**
 * Extracts completed TurnInfo objects from the requests array.
 * Skips in-progress requests (modelState.value !== 1).
 */
function extractTurns(requests: unknown[], sessionId: string): TurnInfo[] {
  const turns: TurnInfo[] = [];

  for (const req of requests) {
    if (!req || typeof req !== 'object') continue;
    const r = req as RequestState;

    // Only include completed turns
    if (r.modelState?.value !== 1) continue;
    if (!r.requestId) continue;

    const messageText = r.message?.text ?? '';
    const estimatedPromptTokens =
      messageText.length > 0 ? Math.ceil(messageText.length / 4) : null;

    // Sum cache-eligible tokens from rendered user message blocks.
    //
    // The `renderedUserMessage` array interleaves text blocks (type=1) with
    // cache breakpoint markers (type=3, `cacheType: 'ephemeral'`). The marker
    // itself carries no token count — it just says "everything before this
    // point can be served from the model's prompt cache." We estimate the
    // cache-eligible token count by summing the text length of all preceding
    // text blocks (4 chars/token, same heuristic as estimatedPromptTokens).
    const renderedBlocks = r.result?.metadata?.renderedUserMessage ?? [];
    let cacheChars = 0;
    let runningChars = 0;
    for (const b of renderedBlocks) {
      if (b.type === 1 && typeof b.text === 'string') {
        runningChars += b.text.length;
      } else if (b.cacheType === 'ephemeral') {
        cacheChars = runningChars;
      }
    }
    const cacheEligibleTokens = cacheChars > 0 ? Math.ceil(cacheChars / 4) : 0;

    turns.push({
      requestId: r.requestId,
      sessionId,
      timestamp: r.timestamp ?? 0,
      modelId: r.modelId ?? '',
      // Only meaningful for `copilot/auto`, where Copilot's router picks the
      // actual model and exposes the choice via `result.metadata.resolvedModel`.
      resolvedModel:
        (r.modelId === 'copilot/auto' && typeof r.result?.metadata?.resolvedModel === 'string')
          ? r.result.metadata.resolvedModel
          : null,
      completionTokens: r.completionTokens ?? null,
      estimatedPromptTokens,
      cacheEligibleTokens,
      elapsedMs: r.elapsedMs ?? null,
      messageText,
      isCompleted: true,
      estimatedCost: null // filled in later by PricingService
    });
  }

  return turns;
}

function formatFallbackTitle(createdAt: number | null): string {
  if (!createdAt) return 'Unnamed Session';
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
