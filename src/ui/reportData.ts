import { ReportRow, ReportScope } from '../types';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TimeGranularity = 'day' | 'week' | 'month';

/** Time-range chip on the COST tab — also drives the sparkline window. */
export type TimeRange = '7d' | '30d' | '90d' | 'all';

export interface ReportInputs {
  rows: ReportRow[];
  scope: ReportScope;
  /** "Now" in ms — injectable for deterministic testing. */
  now?: number;
}

export interface ReportTotals {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  todayTokens: number;
  cost: number;
  steps: number;
  sessions: number;
}

export interface ModelSlice {
  model: string;
  tokens: number;
  pct: number; // 0..100
}

export interface ModelCostRow {
  model: string;
  provider: string;
  cost: number;
  tokens: number;
}

export interface SparkPoint {
  date: string; // YYYY-MM-DD
  tokens: number;
}

export interface WorkspaceCard {
  hash: string;
  displayName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  sessions: number;
  steps: number;
  modelShare: ModelSlice[]; // sorted desc
  modelCost: ModelCostRow[]; // sorted desc by cost
  /** Up to 365 days of daily totals, chronological. Client slices for chip. */
  dailyTotals: SparkPoint[];
}

export interface TimeBucket {
  key: string; // 'YYYY-MM-DD' | 'YYYY-Www' | 'YYYY-MM'
  label: string; // human-friendly
  startMs: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  durationMs: number;
  modelCount: number;
  sessions: number;
  steps: number;
  modelCost: ModelCostRow[]; // sorted desc by cost
  modelShare: ModelSlice[]; // sorted desc by tokens
}

export interface ReportViewModel {
  scope: ReportScope;
  scopeTitle: string;
  totals: ReportTotals;
  workspaceCards: WorkspaceCard[];
  /** Buckets for each granularity, most-recent first. */
  buckets: { day: TimeBucket[]; week: TimeBucket[]; month: TimeBucket[] };
  /** Full model-cost list (COST tab data source). */
  modelCost: ModelCostRow[];
  /** All provider keys present, sorted. */
  providers: string[];
  /** Generation timestamp, ms. */
  generatedAt: number;
}

// ─── Public entry point ───────────────────────────────────────────────────────

const SPARKLINE_DAYS = 365;

export function buildReportViewModel(input: ReportInputs): ReportViewModel {
  const now = input.now ?? Date.now();
  const rows = input.rows;

  const scopeTitle = computeScopeTitle(input.scope, rows);
  const totals = computeTotals(rows, now);
  const workspaceCards = computeWorkspaceCards(rows, input.scope, now);
  const buckets = {
    day: computeBuckets(rows, 'day'),
    week: computeBuckets(rows, 'week'),
    month: computeBuckets(rows, 'month')
  };
  const modelCost = computeModelCost(rows);
  const providerSet = new Set<string>(modelCost.map(m => m.provider));
  const providers = Array.from(providerSet).sort((a, b) => a.localeCompare(b));

  return {
    scope: input.scope,
    scopeTitle,
    totals,
    workspaceCards,
    buckets,
    modelCost,
    providers,
    generatedAt: now
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeScopeTitle(scope: ReportScope, rows: ReportRow[]): string {
  if (scope.type === 'all') return 'All workspaces';
  if (scope.type === 'workspace') {
    return rows[0]?.workspace_display_name ?? 'Workspace';
  }
  return rows[0]?.session_display_name ?? 'Session';
}

function computeTotals(rows: ReportRow[], now: number): ReportTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let todayTokens = 0;
  let cost = 0;
  const sessions = new Set<string>();
  const dayStart = startOfLocalDay(now);

  for (const r of rows) {
    const inp = r.input_tokens ?? 0;
    const out = r.output_tokens ?? 0;
    const cache = r.cache_tokens ?? 0;
    inputTokens += inp;
    outputTokens += out;
    cacheTokens += cache;
    cost += r.cost ?? 0;
    sessions.add(r.session_id);
    if (r.timestamp >= dayStart) {
      todayTokens += inp + out + cache;
    }
  }

  return {
    totalTokens: inputTokens + outputTokens + cacheTokens,
    inputTokens,
    outputTokens,
    cacheTokens,
    todayTokens,
    cost,
    steps: rows.length,
    sessions: sessions.size
  };
}

function computeWorkspaceCards(
  rows: ReportRow[],
  scope: ReportScope,
  now: number
): WorkspaceCard[] {
  // For session scope, "cards" are degenerate (one per session display name).
  // For workspace scope, one card. For all-scope, one per workspace.
  const groupKeyFn = scope.type === 'session'
    ? (r: ReportRow) => r.session_id
    : (r: ReportRow) => r.workspace_hash;
  const labelFn = scope.type === 'session'
    ? (r: ReportRow) => r.session_display_name
    : (r: ReportRow) => r.workspace_display_name;

  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = groupKeyFn(r);
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }

  const cards: WorkspaceCard[] = [];
  for (const [hash, groupRows] of groups) {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheTokens = 0;
    let cost = 0;
    const sessions = new Set<string>();
    const modelTokens = new Map<string, number>();
    const modelCostMap = new Map<string, number>();
    for (const r of groupRows) {
      const inp = r.input_tokens ?? 0;
      const out = r.output_tokens ?? 0;
      const cache = r.cache_tokens ?? 0;
      inputTokens += inp;
      outputTokens += out;
      cacheTokens += cache;
      cost += r.cost ?? 0;
      sessions.add(r.session_id);
      const model = modelLabelForRow(r);
      modelTokens.set(model, (modelTokens.get(model) ?? 0) + inp + out + cache);
      modelCostMap.set(model, (modelCostMap.get(model) ?? 0) + (r.cost ?? 0));
    }
    const totalTokens = inputTokens + outputTokens + cacheTokens;
    const modelShare: ModelSlice[] = Array.from(modelTokens.entries())
      .map(([model, tokens]) => ({
        model,
        tokens,
        pct: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0
      }))
      .sort((a, b) => b.tokens - a.tokens);
    const modelCost: ModelCostRow[] = Array.from(modelCostMap.entries())
      .map(([model, c]) => ({
        model,
        provider: providerOf(model),
        cost: c,
        tokens: modelTokens.get(model) ?? 0
      }))
      .sort((a, b) => b.cost - a.cost);

    cards.push({
      hash,
      displayName: labelFn(groupRows[0]),
      totalTokens,
      inputTokens,
      outputTokens,
      cost,
      sessions: sessions.size,
      steps: groupRows.length,
      modelShare,
      modelCost,
      dailyTotals: buildSparkline(groupRows, now, SPARKLINE_DAYS)
    });
  }

  return cards.sort((a, b) => b.cost - a.cost);
}

function buildSparkline(rows: ReportRow[], now: number, days: number): SparkPoint[] {
  const tokensByDay = new Map<string, number>();
  for (const r of rows) {
    const key = formatLocalDate(r.timestamp);
    const inc = (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_tokens ?? 0);
    tokensByDay.set(key, (tokensByDay.get(key) ?? 0) + inc);
  }
  const out: SparkPoint[] = [];
  const today = startOfLocalDay(now);
  for (let i = days - 1; i >= 0; i--) {
    const ms = today - i * 86400000;
    const key = formatLocalDate(ms);
    out.push({ date: key, tokens: tokensByDay.get(key) ?? 0 });
  }
  return out;
}

function computeBuckets(rows: ReportRow[], granularity: TimeGranularity): TimeBucket[] {
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = bucketKey(r.timestamp, granularity);
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const out: TimeBucket[] = [];
  for (const [key, groupRows] of groups) {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheTokens = 0;
    let cost = 0;
    let durationMs = 0;
    const sessions = new Set<string>();
    const models = new Set<string>();
    const modelTokens = new Map<string, number>();
    const modelCostMap = new Map<string, number>();
    let earliest = Number.POSITIVE_INFINITY;
    for (const r of groupRows) {
      const inp = r.input_tokens ?? 0;
      const out = r.output_tokens ?? 0;
      const cache = r.cache_tokens ?? 0;
      inputTokens += inp;
      outputTokens += out;
      cacheTokens += cache;
      cost += r.cost ?? 0;
      durationMs += r.duration_ms ?? 0;
      sessions.add(r.session_id);
      const m = modelLabelForRow(r);
      models.add(m);
      modelTokens.set(m, (modelTokens.get(m) ?? 0) + inp + out + cache);
      modelCostMap.set(m, (modelCostMap.get(m) ?? 0) + (r.cost ?? 0));
      if (r.timestamp < earliest) earliest = r.timestamp;
    }
    const totalTokens = inputTokens + outputTokens + cacheTokens;
    const modelCost: ModelCostRow[] = Array.from(modelCostMap.entries())
      .map(([m, c]) => ({
        model: m,
        provider: providerOf(m),
        cost: c,
        tokens: modelTokens.get(m) ?? 0
      }))
      .sort((a, b) => b.cost - a.cost);
    const modelShare: ModelSlice[] = Array.from(modelTokens.entries())
      .map(([m, tokens]) => ({
        model: m,
        tokens,
        pct: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0
      }))
      .sort((a, b) => b.tokens - a.tokens);
    out.push({
      key,
      label: bucketLabel(key, granularity, earliest),
      startMs: bucketStartMs(key, granularity),
      totalTokens,
      inputTokens,
      outputTokens,
      cacheTokens,
      cost,
      durationMs,
      modelCount: models.size,
      sessions: sessions.size,
      steps: groupRows.length,
      modelCost,
      modelShare
    });
  }

  return out.sort((a, b) => b.startMs - a.startMs);
}

function computeModelCost(rows: ReportRow[]): ModelCostRow[] {
  const costMap = new Map<string, number>();
  const tokenMap = new Map<string, number>();
  for (const r of rows) {
    const m = modelLabelForRow(r);
    costMap.set(m, (costMap.get(m) ?? 0) + (r.cost ?? 0));
    const inc = (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_tokens ?? 0);
    tokenMap.set(m, (tokenMap.get(m) ?? 0) + inc);
  }
  return Array.from(costMap.entries())
    .map(([model, cost]) => ({
      model,
      provider: providerOf(model),
      cost,
      tokens: tokenMap.get(model) ?? 0
    }))
    .sort((a, b) => b.cost - a.cost);
}

// ─── Provider derivation ──────────────────────────────────────────────────────

/**
 * Returns the display key used to group/label a row by model. We strip the
 * `copilot/` prefix (it's noise on every model in this dataset) and, for
 * `copilot/auto` rows, surface the model the router actually picked suffixed
 * with `(auto)` so the consumption tied to Auto stays visible.
 *
 * NOTE: Per-turn pricing was already computed at ingest from the raw modelId
 * and stored in `cost`, so changing this display label does not affect totals.
 */
export function modelLabelForRow(r: { model_id: string | null; resolved_model?: string | null }): string {
  const id = r.model_id ?? '(unknown)';
  if (id === 'copilot/auto') {
    const resolved = r.resolved_model ? stripCopilotPrefix(r.resolved_model) : null;
    return resolved ? `${resolved} (auto)` : 'auto';
  }
  return stripCopilotPrefix(id);
}

function stripCopilotPrefix(id: string): string {
  return id.startsWith('copilot/') ? id.slice('copilot/'.length) : id;
}

/**
 * Derives a provider key from a model id. Handles the `provider/model` shape
 * directly; for bare ids we use a small heuristic on common prefixes.
 */
export function providerOf(modelId: string): string {
  if (!modelId) return '(unknown)';
  // Strip the synthesized `(auto)` suffix so provider detection runs
  // against the underlying resolved model id.
  const cleaned = modelId.replace(/\s*\((?:copilot\/)?auto\)\s*$/i, '');
  if (cleaned.includes('/')) {
    return cleaned.split('/', 1)[0].toLowerCase();
  }
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('claude')) return 'anthropic';
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return 'openai';
  if (lower.startsWith('gemini')) return 'google';
  if (lower.startsWith('grok')) return 'x-ai';
  if (lower.startsWith('llama')) return 'meta';
  if (lower.startsWith('mistral')) return 'mistral';
  if (lower.startsWith('deepseek')) return 'deepseek';
  if (lower.startsWith('qwen')) return 'qwen';
  if (lower.startsWith('phi')) return 'microsoft';
  return '(unknown)';
}

// ─── Date helpers (local-time bucketing) ──────────────────────────────────────

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucketKey(ms: number, g: TimeGranularity): string {
  const d = new Date(ms);
  if (g === 'day') return formatLocalDate(ms);
  if (g === 'month') {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  // ISO-ish week (sufficient for bucketing/sorting; not strict ISO 8601)
  const onejan = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - onejan.getTime()) / 86400000) + 1;
  const week = String(Math.ceil((dayOfYear + onejan.getDay()) / 7)).padStart(2, '0');
  return `${d.getFullYear()}-W${week}`;
}

function bucketStartMs(key: string, g: TimeGranularity): number {
  if (g === 'day') {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  if (g === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).getTime();
  }
  // week key 'YYYY-Www' — approximate to the start of week N of that year
  const [yStr, wStr] = key.split('-W');
  const y = Number(yStr);
  const w = Number(wStr);
  const onejan = new Date(y, 0, 1);
  return onejan.getTime() + (w - 1) * 7 * 86400000;
}

function bucketLabel(key: string, g: TimeGranularity, earliestMs: number): string {
  const today = startOfLocalDay(Date.now());
  if (g === 'day') {
    const [y, m, d] = key.split('-').map(Number);
    const ms = new Date(y, m - 1, d).getTime();
    if (ms === today) return 'Today';
    if (ms === today - 86400000) return 'Yesterday';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (g === 'month') {
    return new Date(earliestMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  // Week: use 'M/D - M/D' when both ends share the current year, otherwise
  // include a 2-digit year. The week start is derived from the bucket key
  // (Sunday-based) so labels are stable regardless of when the user looks.
  const weekStart = bucketStartMs(key, 'week');
  const weekEnd = weekStart + 6 * 86400000;
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  const curYear = new Date().getFullYear();
  const sameCurYear = start.getFullYear() === curYear && end.getFullYear() === curYear;
  if (sameCurYear) {
    return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
  }
  const yy = (d: Date) => String(d.getFullYear()).slice(-2);
  return `${start.getMonth() + 1}/${start.getDate()}/${yy(start)} - ${end.getMonth() + 1}/${end.getDate()}/${yy(end)}`;
}
