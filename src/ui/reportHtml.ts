import {
  ReportViewModel,
  TimeBucket,
  WorkspaceCard,
  ModelCostRow,
  ModelSlice,
  SparkPoint
} from './reportData';

export interface ReportHtmlInput {
  vm: ReportViewModel;
  /** Optional override for deterministic testing. */
  nonce?: string;
}

const DEFAULT_RANGE = '30d';

/**
 * Shared color palette for per-model coloring across share bars, cost rows,
 * and pie slices. Uses CSS custom properties (declared in CSS below) so the
 * palette can be themed in one place via `--pc-accent-*`.
 */
const MODEL_PALETTE: string[] = [
  'var(--pc-accent-blue)',
  'var(--pc-accent-orange)',
  'var(--pc-accent-green)',
  'var(--pc-accent-purple)',
  'var(--pc-accent-red)',
  'var(--pc-accent-yellow)',
  'var(--pc-accent-cyan)',
  'var(--pc-accent-pink)'
];

/**
 * Curated per-family color overrides so well-known models always pick the
 * same color (and so sibling models in a family share a hue family). Keys
 * are matched as case-insensitive substrings against a "normalized" model
 * label (provider prefix and "(auto)" suffix stripped).
 *
 * Anything not matched falls back to a stable hash of the model name into
 * MODEL_PALETTE — so two different sessions showing the same model always
 * paint with the same color regardless of where it appears in any list.
 */
const MODEL_COLOR_OVERRIDES: Array<{ match: RegExp; color: string }> = [
  // Anthropic — orange/pink family
  { match: /claude.*opus/i,   color: 'var(--pc-accent-pink)'   },
  { match: /claude.*sonnet/i, color: 'var(--pc-accent-orange)' },
  { match: /claude.*haiku/i,  color: 'var(--pc-accent-yellow)' },
  { match: /^claude/i,        color: 'var(--pc-accent-orange)' },
  // OpenAI — blue/cyan family
  { match: /gpt-?5/i,         color: 'var(--pc-accent-cyan)'   },
  { match: /gpt-?4o/i,        color: 'var(--pc-accent-blue)'   },
  { match: /gpt-?4/i,         color: 'var(--pc-accent-blue)'   },
  { match: /^o\d/i,           color: 'var(--pc-accent-purple)' }, // o1, o3, o4 reasoning models
  { match: /^gpt/i,           color: 'var(--pc-accent-blue)'   },
  // Google — green family
  { match: /gemini/i,         color: 'var(--pc-accent-green)'  },
  // Auto (when resolved model isn't known)
  { match: /copilot\/?auto/i, color: 'var(--pc-accent-purple)' }
];

/** Normalize a model label for color lookup: strip "(auto)" suffix
 *  and any "provider/" prefix so `copilot/gpt-4o` and `gpt-4o (auto)`
 *  both resolve to `gpt-4o`. */
function normalizeModelKey(model: string): string {
  return model
    .replace(/\s*\((?:copilot\/)?auto\)\s*$/i, '')
    .replace(/^[^/]+\//, '')
    .trim()
    .toLowerCase();
}

/** Stable string hash (FNV-1a, 32-bit). Browser/Node agnostic. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Returns a stable color for the given model id, independent of list order. */
function colorForModel(model: string): string {
  const key = normalizeModelKey(model);
  for (const ov of MODEL_COLOR_OVERRIDES) {
    if (ov.match.test(key)) return ov.color;
  }
  return MODEL_PALETTE[hashString(key) % MODEL_PALETTE.length];
}

export function buildReportHtml(input: ReportHtmlInput): string {
  const nonce = input.nonce ?? generateNonce();
  const vm = input.vm;
  const providerSuffix = 'COPILOT';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Report — ${escapeHtml(vm.scopeTitle)}</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="report-header">
    <div class="header-row">
      <div class="header-title">
        <div class="kicker">PROMPTCOUNTANT · REPORT${providerSuffix ? ` (${providerSuffix})` : ''}</div>
        <h1>${escapeHtml(vm.scopeTitle)}</h1>
      </div>
      <div class="range-bar global">
        <span class="range-label">Range</span>
        ${renderRangeChips('global')}
      </div>
    </div>
    <div class="kpi-grid">
      ${renderKpi('TODAY', formatTokens(vm.totals.todayTokens), 'tokens', 'cyan')}
      ${renderKpi('TOTAL', formatTokens(vm.totals.totalTokens), 'tokens', 'blue', 'total')}
      ${renderKpi('COSTS', formatUsd(vm.totals.cost), `${formatInt(Math.round(vm.totals.cost / 0.01))} AI credits`, 'green', 'costs')}
      ${renderKpi('STEPS', formatInt(vm.totals.steps), `${vm.totals.sessions} sessions`, 'purple', 'steps')}
    </div>
  </header>

  <nav class="tabs-bar">
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="projects">Projects</button>
      <button class="tab active" role="tab" data-tab="time">Time</button>
      <button class="tab" role="tab" data-tab="cost">Models</button>
    </div>
  </nav>

  <main>
    <section class="tab-panel" id="panel-projects" role="tabpanel" hidden>
      ${renderProjectsTab(vm)}
    </section>

    <section class="tab-panel active" id="panel-time" role="tabpanel">
      ${renderTimeTab(vm)}
    </section>

    <section class="tab-panel" id="panel-cost" role="tabpanel" hidden>
      ${renderCostTab(vm)}
    </section>
  </main>

  <script nonce="${nonce}" type="application/json" id="report-data">${escapeForJson(JSON.stringify({
    workspaceCards: vm.workspaceCards,
    modelCost: vm.modelCost,
    providers: vm.providers,
    dailyBuckets: vm.buckets.day,
    weeklyBuckets: vm.buckets.week,
    monthlyBuckets: vm.buckets.month,
    generatedAt: vm.generatedAt
  }))}</script>
  <script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

// ─── Header / KPI ─────────────────────────────────────────────────────────────

function renderKpi(label: string, value: string, sub: string, accent?: 'blue' | 'orange' | 'green' | 'purple' | 'red' | 'yellow' | 'cyan' | 'pink', kpiId?: string): string {
  const accentClass = accent ? ` kpi--${accent}` : '';
  const valueId = kpiId ? ` id="kpi-${kpiId}-value"` : '';
  const subId = kpiId ? ` id="kpi-${kpiId}-sub"` : '';
  return `<div class="kpi${accentClass}">
    <div class="kpi-value"${valueId}>${escapeHtml(value)}</div>
    <div class="kpi-label">${escapeHtml(label)}</div>
    ${sub ? `<div class="kpi-sub"${subId}>${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

// ─── Projects tab ─────────────────────────────────────────────────────────────

function renderProjectsTab(vm: ReportViewModel): string {
  if (vm.workspaceCards.length === 0) {
    return `<div class="empty">No usage data yet.</div>`;
  }
  return `<div class="cards">
    ${vm.workspaceCards.map(c => renderProjectCard(c)).join('\n')}
  </div>`;
}

function renderProjectCard(c: WorkspaceCard): string {
  const top = c.modelCost.slice(0, 8);
  return `<article class="card" data-card-hash="${escapeHtml(c.hash)}">
    <header class="card-head">
      <h2 class="card-title">${escapeHtml(c.displayName)}</h2>
      <div class="card-head-meta">
        <span class="pill">${escapeHtml(formatTokens(c.totalTokens))} tokens</span>
        <span class="card-cost">${escapeHtml(formatUsd(c.cost))}</span>
      </div>
    </header>
    <div class="card-counters">
      ${renderMini('INPUT',  formatTokens(c.inputTokens))}
      ${renderMini('OUTPUT', formatTokens(c.outputTokens))}
      ${renderMini('SESSIONS', formatInt(c.sessions))}
      ${renderMini('STEPS',  formatInt(c.steps))}
    </div>
    <div class="card-section">
      <div class="card-section-title">TOTAL TOKENS</div>
      ${renderSparklineSvg(c.dailyTotals.slice(-30))}
    </div>
    <div class="card-section">
      <div class="card-section-title">LLM USAGE</div>
      ${renderShareBars(c.modelShare.slice(0, 6))}
    </div>
    <div class="card-section">
      <div class="card-section-title">MODEL COST COMPARISON</div>
      <ul class="cost-list">
        ${top.map(m => `<li><span class="swatch" style="background:${colorForModel(m.model)}"></span><span class="model">${escapeHtml(m.model)}</span><span class="cost">${escapeHtml(formatUsd(m.cost))}</span></li>`).join('')}
      </ul>
    </div>
  </article>`;
}

function renderMini(label: string, value: string): string {
  return `<div class="mini">
    <div class="mini-value">${escapeHtml(value)}</div>
    <div class="mini-label">${escapeHtml(label)}</div>
  </div>`;
}

function renderShareBars(slices: ModelSlice[]): string {
  if (slices.length === 0) return `<div class="muted">No data.</div>`;
  return `<ul class="share-bars">
    ${slices.map(s => { const c = colorForModel(s.model); return `<li>
      <div class="share-row">
        <span class="swatch" style="background:${c}"></span>
        <span class="model">${escapeHtml(s.model)}</span>
        <span class="pct">${s.pct.toFixed(1)}%</span>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${clampPct(s.pct).toFixed(2)}%;background:${c}"></div></div>
    </li>`; }).join('')}
  </ul>`;
}

function renderSparklineSvg(points: SparkPoint[]): string {
  const w = 560;
  const h = 60;
  if (points.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" class="spark" aria-hidden="true"></svg>`;
  }
  const max = Math.max(1, ...points.map(p => p.tokens));
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${(h - (p.tokens / max) * h).toFixed(1)}`)
    .join(' ');
  const area = path + ` L ${w} ${h} L 0 ${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-area" d="${area}"></path>
    <path class="spark-line" d="${path}"></path>
  </svg>`;
}

// ─── Time tab ─────────────────────────────────────────────────────────────────

function renderTimeTab(vm: ReportViewModel): string {
  return `<div class="time-controls">
    <div class="seg" role="tablist" data-seg="granularity">
      <button class="seg-btn active" data-val="day">Daily</button>
      <button class="seg-btn" data-val="week">Weekly</button>
      <button class="seg-btn" data-val="month">Monthly</button>
    </div>
    <div class="seg" role="tablist" data-seg="mode">
      <button class="seg-btn active" data-val="list">List</button>
      <button class="seg-btn" data-val="chart">Chart</button>
    </div>
  </div>

  <div class="time-list" data-view="list">
    ${renderBucketLists(vm)}
  </div>

  <div class="time-chart" data-view="chart" hidden>
    ${renderBucketCharts(vm)}
  </div>`;
}

function renderBucketLists(vm: ReportViewModel): string {
  return (['day', 'week', 'month'] as const)
    .map(g => {
      const buckets = vm.buckets[g];
      if (buckets.length === 0) {
        return `<div class="bucket-list" data-gran="${g}" ${g === 'day' ? '' : 'hidden'}>
          <div class="empty">No data for this view.</div>
        </div>`;
      }
      return `<div class="bucket-list" data-gran="${g}" ${g === 'day' ? '' : 'hidden'}>
        ${buckets.slice(0, 60).map(b => renderBucketCard(b)).join('\n')}
      </div>`;
    })
    .join('\n');
}

function renderBucketCard(b: TimeBucket): string {
  const max = Math.max(1, b.inputTokens, b.outputTokens, b.cacheTokens);
  const tokenRow = (label: string, role: string, val: number, pctOfTotal?: number) =>
    `<div class="trow" data-role="${role}">
      <span class="trow-label">${escapeHtml(label)}</span>
      <div class="bar"><div class="bar-fill" style="width:${((val / max) * 100).toFixed(2)}%"></div></div>
      <span class="trow-val">${escapeHtml(formatTokens(val))}${pctOfTotal != null ? ` <span class="trow-pct">(${pctOfTotal.toFixed(1)}%)</span>` : ''}</span>
    </div>`;
  const cachePct = b.totalTokens > 0 ? (b.cacheTokens / b.totalTokens) * 100 : 0;
  return `<article class="bucket" data-start="${b.startMs}">
    <header class="bucket-head">
      <h3 class="bucket-title">${escapeHtml(b.label)}</h3>
      <div class="bucket-meta">
        <span class="pill">${escapeHtml(formatTokens(b.totalTokens))} tokens</span>
        <span class="pill">${b.modelCount} model${b.modelCount === 1 ? '' : 's'}</span>
        <span class="pill">${escapeHtml(formatDuration(b.durationMs))}</span>
        <span class="bucket-cost">${escapeHtml(formatUsd(b.cost))}</span>
      </div>
    </header>
    <div class="trows">
      ${tokenRow('INPUT',  'input',  b.inputTokens)}
      ${tokenRow('OUTPUT', 'output', b.outputTokens)}
      ${tokenRow('CACHE',  'cache',  b.cacheTokens, cachePct)}
    </div>
    ${b.modelCost.length > 0 ? `<div class="card-section">
      <div class="card-section-title">MODEL COST COMPARISON</div>
      <ul class="cost-list">
        ${b.modelCost.slice(0, 6).map(m => `<li><span class="swatch" style="background:${colorForModel(m.model)}"></span><span class="model">${escapeHtml(m.model)}</span><span class="cost">${escapeHtml(formatUsd(m.cost))}</span></li>`).join('')}
      </ul>
    </div>` : ''}
    ${b.modelShare.length > 0 ? `<div class="card-section">
      <div class="card-section-title">MODEL USAGE</div>
      ${renderPieChart(b.modelShare.slice(0, 8))}
    </div>` : ''}
  </article>`;
}

function renderBucketCharts(vm: ReportViewModel): string {
  return (['day', 'week', 'month'] as const)
    .map(g => {
      const buckets = vm.buckets[g].slice(0, 12).slice().reverse(); // chronological for chart
      if (buckets.length === 0) {
        return `<div class="bucket-chart" data-gran="${g}" ${g === 'day' ? '' : 'hidden'}>
          <div class="empty">No data for this view.</div>
        </div>`;
      }
      const latest = buckets[buckets.length - 1];
      const avg = buckets.reduce((s, b) => s + b.totalTokens, 0) / buckets.length;
      const peak = buckets.reduce((m, b) => (b.totalTokens > m.totalTokens ? b : m), buckets[0]);
      const tokensSeries = buckets.map(b => b.totalTokens);
      const labels = buckets.map(b => b.label);
      const breakdownSeries: { name: string; values: number[]; color: string }[] = [
        { name: 'INPUT',  values: buckets.map(b => b.inputTokens),  color: 'var(--vscode-charts-blue, #3794ff)' },
        { name: 'OUTPUT', values: buckets.map(b => b.outputTokens), color: 'var(--vscode-charts-orange, #f99157)' },
        { name: 'CACHE',  values: buckets.map(b => b.cacheTokens),  color: 'var(--vscode-charts-green, #a8c023)' }
      ];
      const sessionsSteps: { name: string; values: number[]; color: string }[] = [
        { name: 'SESSIONS', values: buckets.map(b => b.sessions), color: 'var(--vscode-charts-purple, #b180d7)' },
        { name: 'STEPS',    values: buckets.map(b => b.steps),    color: 'var(--vscode-charts-red, #cc6666)' }
      ];
      return `<div class="bucket-chart" data-gran="${g}" ${g === 'day' ? '' : 'hidden'}>
        <div class="chart-summary">
          ${renderMini(`LATEST ${g.toUpperCase()}`, formatTokens(latest.totalTokens))}
          ${renderMini(`AVG / ${g.toUpperCase()}`, formatTokens(avg))}
          ${renderMini(`PEAK (${escapeHtml(peak.label)})`, formatTokens(peak.totalTokens))}
        </div>
        <div class="chart-block">
          <div class="chart-title">LLM USAGE (LATEST ${g.toUpperCase()})</div>
          ${renderPieChart(latest.modelShare.slice(0, 8))}
        </div>
        <div class="chart-block">
          <div class="chart-title">TOTAL TOKENS</div>
          ${renderLineChart([{ name: 'TOTAL', values: tokensSeries, color: 'var(--vscode-charts-blue, #3794ff)' }], labels)}
        </div>
        <div class="chart-block">
          <div class="chart-title">TOKEN BREAKDOWN</div>
          ${renderLegend(breakdownSeries)}
          ${renderLineChart(breakdownSeries, labels)}
        </div>
        <div class="chart-block">
          <div class="chart-title">SESSIONS AND STEPS</div>
          ${renderLegend(sessionsSteps)}
          ${renderLineChart(sessionsSteps, labels)}
        </div>
      </div>`;
    })
    .join('\n');
}

function renderLineChart(
  series: { name: string; values: number[]; color: string }[],
  labels: string[]
): string {
  const w = 720;
  const h = 180;
  const padL = 40;
  const padR = 12;
  const padT = 8;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = labels.length;
  if (n === 0) return `<svg viewBox="0 0 ${w} ${h}" class="line-chart"></svg>`;
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const yTicks = 4;
  const ticksHtml: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = (max / yTicks) * i;
    const yy = y(v);
    ticksHtml.push(`<line class="grid" x1="${padL}" x2="${w - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"></line>`);
    ticksHtml.push(`<text class="tick" x="${padL - 4}" y="${yy + 3}" text-anchor="end">${formatTokens(v)}</text>`);
  }

  const seriesHtml = series
    .map(s => {
      const d = s.values
        .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
        .join(' ');
      return `<path class="line" d="${d}" style="stroke:${s.color}"></path>`;
    })
    .join('');

  // X labels (show up to 6 evenly spaced)
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = labels
    .map((l, i) => i % labelEvery === 0 || i === n - 1
      ? `<text class="tick" x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${escapeHtml(l)}</text>`
      : '')
    .join('');

  return `<svg viewBox="0 0 ${w} ${h}" class="line-chart" preserveAspectRatio="none">
    ${ticksHtml.join('')}
    ${seriesHtml}
    ${xLabels}
  </svg>`;
}

function renderLegend(series: { name: string; color: string }[]): string {
  return `<div class="legend">${series
    .map(s => `<span class="legend-item"><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`)
    .join('')}</div>`;
}

function renderPieChart(slices: ModelSlice[]): string {
  if (slices.length === 0) return `<div class="muted">No data.</div>`;
  const w = 220;
  const r = 90;
  const cx = w / 2;
  const cy = r + 10;
  const total = slices.reduce((s, x) => s + x.tokens, 0);
  if (total === 0) return `<div class="muted">No data.</div>`;

  const legend = slices
    .map(s => `<li><span class="swatch" style="background:${colorForModel(s.model)}"></span><span class="model">${escapeHtml(s.model)}</span><span class="pct">${s.pct.toFixed(1)}%</span></li>`)
    .join('');

  // Single slice: SVG arc paths collapse to nothing when start === end, so
  // render a plain circle instead.
  if (slices.length === 1) {
    const color = colorForModel(slices[0].model);
    return `<div class="pie-wrap">
    <svg viewBox="0 0 ${w} ${r * 2 + 20}" class="pie"><circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${color}"></circle></svg>
    <ul class="pie-legend">${legend}</ul>
  </div>`;
  }

  let acc = 0;
  const arcs: string[] = [];
  slices.forEach(s => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += s.tokens;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    const color = colorForModel(s.model);
    arcs.push(`<path class="slice" d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" style="fill:${color}"></path>`);
  });
  return `<div class="pie-wrap">
    <svg viewBox="0 0 ${w} ${r * 2 + 20}" class="pie">${arcs.join('')}</svg>
    <ul class="pie-legend">${legend}</ul>
  </div>`;
}

// ─── Cost tab ─────────────────────────────────────────────────────────────────

function renderCostTab(vm: ReportViewModel): string {
  const totals = vm.totals;
  const models = vm.modelCost.map(m => m.model);
  return `<div class="cost-totals">
    ${renderMini('TOTAL TOKENS', formatTokens(totals.totalTokens))}
    ${renderMini('INPUT',  formatTokens(totals.inputTokens))}
    ${renderMini('OUTPUT', formatTokens(totals.outputTokens))}
    ${renderMini('CACHE',  formatTokens(totals.cacheTokens))}
  </div>

  <div class="filters">
    <div class="filter-group">
      <div class="filter-label">MODEL</div>
      <div class="chips" data-chip-group="model" data-multi="true">
        <button class="chip active" data-val="__all__">All</button>
        ${models.map(m => `<button class="chip" data-val="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')}
      </div>
    </div>
    <div class="filter-group">
      <div class="filter-label">SORT</div>
      <div class="chips" data-chip-group="sort">
        <button class="chip active" data-val="desc">High → Low</button>
        <button class="chip" data-val="asc">Low → High</button>
      </div>
    </div>
  </div>

  <div class="cost-section">
    <div class="card-section-title">ESTIMATED COST PER MODEL</div>
    <ul id="cost-list" class="cost-list big">
      ${vm.modelCost.map(m => renderCostRow(m)).join('')}
    </ul>
  </div>`;
}

function renderCostRow(m: ModelCostRow): string {
  const color = colorForModel(m.model);
  return `<li data-model="${escapeHtml(m.model)}" data-provider="${escapeHtml(m.provider)}" data-cost="${m.cost}">
    <span class="swatch" style="background:${color}"></span>
    <span class="model">${escapeHtml(m.model)}</span>
    <span class="cost">${escapeHtml(formatUsd(m.cost))}</span>
  </li>`;
}

function renderRangeChips(group: string): string {
  return `<div class="chips" data-chip-group="range-${escapeHtml(group)}">
    <button class="chip" data-val="7d">7d</button>
    <button class="chip ${DEFAULT_RANGE === '30d' ? 'active' : ''}" data-val="30d">30d</button>
    <button class="chip" data-val="90d">90d</button>
    <button class="chip" data-val="all">All</button>
  </div>`;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatUsd(n: number): string {
  if (!isFinite(n)) return '$0.00';
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function clampPct(n: number): number {
  if (!isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeForJson(s: string): string {
  // Defends against `</script>` injection inside the inline JSON block.
  return s.replace(/</g, '\\u003c');
}

function generateNonce(): string {
  // Webview nonces don't need crypto-strength; this is enough for CSP.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ─── CSS + client script ──────────────────────────────────────────────────────

const CSS = `
  :root {
    /* Promptcountant accent palette (token-lens inspired). Falls back to
       VS Code chart vars when defined, otherwise hard-coded hexes. */
    --pc-accent-blue:    var(--vscode-charts-blue,   #3794ff);
    --pc-accent-orange:  var(--vscode-charts-orange, #f99157);
    --pc-accent-green:   var(--vscode-charts-green,  #66c285);
    --pc-accent-purple:  var(--vscode-charts-purple, #b180d7);
    --pc-accent-red:     var(--vscode-charts-red,    #cc6666);
    --pc-accent-yellow:  var(--vscode-charts-yellow, #f0c674);
    --pc-accent-cyan:    #4fc3a1;
    --pc-accent-pink:    #d27aa6;
  }
  body {
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    margin: 0;
    padding: 0 16px 24px 16px;
  }
  h1, h2, h3 { margin: 0; }
  .muted { color: var(--vscode-descriptionForeground); }
  .empty { padding: 24px; color: var(--vscode-descriptionForeground); font-style: italic; }

  .report-header {
    padding: 14px 0 12px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 12px;
  }
  .header-row { display: flex; justify-content: space-between; align-items: flex-end; }
  .kicker {
    font-size: 0.75em;
    letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
  }
  .header-title h1 { font-size: 1.4em; margin-top: 2px; }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-top: 14px;
  }
  .kpi {
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.06));
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 12px 14px;
  }
  .kpi--blue   { border-left-color: var(--pc-accent-blue);   }
  .kpi--blue   .kpi-value { color: var(--pc-accent-blue);   }
  .kpi--orange { border-left-color: var(--pc-accent-orange); }
  .kpi--orange .kpi-value { color: var(--pc-accent-orange); }
  .kpi--green  { border-left-color: var(--pc-accent-green);  }
  .kpi--green  .kpi-value { color: var(--pc-accent-green);  }
  .kpi--purple { border-left-color: var(--pc-accent-purple); }
  .kpi--purple .kpi-value { color: var(--pc-accent-purple); }
  .kpi--red    { border-left-color: var(--pc-accent-red);    }
  .kpi--red    .kpi-value { color: var(--pc-accent-red);    }
  .kpi--yellow { border-left-color: var(--pc-accent-yellow); }
  .kpi--yellow .kpi-value { color: var(--pc-accent-yellow); }
  .kpi--cyan   { border-left-color: var(--pc-accent-cyan);   }
  .kpi--cyan   .kpi-value { color: var(--pc-accent-cyan);   }
  .kpi--pink   { border-left-color: var(--pc-accent-pink);   }
  .kpi--pink   .kpi-value { color: var(--pc-accent-pink);   }
  .kpi-value { font-size: 1.4em; font-weight: 600; }
  .kpi-label {
    font-size: 0.72em; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin-top: 4px;
  }
  .kpi-sub { font-size: 0.78em; color: var(--vscode-descriptionForeground); margin-top: 2px; }

  .tabs-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .tabs {
    display: flex;
    gap: 2px;
  }
  .range-bar.global {
    display: flex; align-items: center; gap: 8px;
  }
  .tab {
    background: transparent;
    color: var(--vscode-foreground);
    border: none;
    padding: 8px 14px;
    cursor: pointer;
    font: inherit;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover { background: var(--vscode-list-hoverBackground); }
  .tab.active {
    border-bottom-color: var(--vscode-focusBorder, #007fd4);
    color: var(--vscode-foreground);
    font-weight: 600;
  }
  .tab-panel[hidden] { display: none; }

  .card, .bucket {
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.04));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .card-head, .bucket-head {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
    margin-bottom: 10px;
  }
  .card-title, .bucket-title { font-size: 1.05em; }
  .card-head-meta, .bucket-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pill {
    background: var(--vscode-badge-background, rgba(127,127,127,0.15));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    border-radius: 10px;
    padding: 2px 8px;
    font-size: 0.78em;
  }
  .card-cost, .bucket-cost { font-weight: 600; font-size: 1.05em; }

  .card-counters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 8px 0 12px 0; }
  .mini { padding: 6px 0; }
  .mini-value { font-weight: 600; }
  .mini-label {
    font-size: 0.7em; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin-top: 2px;
  }

  .card-section { margin-top: 12px; }
  .card-section-title {
    font-size: 0.72em; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin-bottom: 6px;
  }

  .spark { width: 100%; height: 60px; }
  .spark-line { fill: none; stroke: var(--vscode-charts-blue, #3794ff); stroke-width: 1.5; }
  .spark-area { fill: var(--vscode-charts-blue, #3794ff); fill-opacity: 0.15; stroke: none; }

  .share-bars { list-style: none; padding: 0; margin: 0; }
  .share-bars li { margin-bottom: 6px; }
  .share-row {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.85em; margin-bottom: 2px;
  }
  .share-row .model { font-family: var(--vscode-editor-font-family); flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .share-row .pct { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .bar {
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-panel-border);
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
  }
  .bar-fill {
    background: var(--pc-accent-blue);
    height: 100%;
    transition: width 120ms ease-out;
  }
  /* Distinct fill colors per bar role (Daily INPUT/OUTPUT/CACHE) */
  .trow[data-role="input"]  .bar-fill { background: var(--pc-accent-blue); }
  .trow[data-role="output"] .bar-fill { background: var(--pc-accent-orange); }
  .trow[data-role="cache"]  .bar-fill { background: var(--pc-accent-green); }
  .trow-pct { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: 4px; }

  .cost-list { list-style: none; padding: 0; margin: 0; }
  .cost-list li {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 0;
    font-size: 0.9em;
  }
  .cost-list .model { font-family: var(--vscode-editor-font-family); flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cost-list .cost { font-weight: 600; font-variant-numeric: tabular-nums; }
  .cost-list.big li { padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }

  /* Time tab */
  .time-controls { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
  .seg { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
  .seg-btn {
    background: transparent; color: var(--vscode-foreground); border: none;
    padding: 4px 10px; cursor: pointer; font: inherit;
  }
  .seg-btn:hover { background: var(--vscode-list-hoverBackground); }
  .seg-btn.active {
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
  }

  .trows { display: flex; flex-direction: column; gap: 4px; }
  .trow { display: grid; grid-template-columns: 90px 1fr 90px; align-items: center; gap: 8px; font-size: 0.85em; }
  .trow-label { color: var(--vscode-descriptionForeground); }
  .trow-val { text-align: right; font-variant-numeric: tabular-nums; }

  .chart-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .chart-block { margin: 18px 0; }
  .chart-title {
    font-size: 0.72em; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin-bottom: 6px;
  }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; font-size: 0.78em; }
  .legend-item { display: inline-flex; align-items: center; gap: 4px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

  .line-chart { width: 100%; height: 180px; }
  .line-chart .grid { stroke: var(--vscode-panel-border); stroke-width: 0.5; }
  .line-chart .tick { fill: var(--vscode-descriptionForeground); font-size: 9px; }
  .line-chart .line { fill: none; stroke-width: 1.5; }

  .pie-wrap { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .pie { width: 220px; height: auto; }
  .pie-legend { list-style: none; padding: 0; margin: 0; flex: 1 1 200px; }
  .pie-legend li {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    align-items: center; gap: 6px;
    padding: 2px 0;
    font-size: 0.85em;
  }

  /* Cost tab */
  .cost-totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
  .filters { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
  .filter-group { display: flex; flex-direction: column; gap: 4px; }
  .filter-label {
    font-size: 0.7em; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
    padding: 2px 8px;
    border-radius: 10px;
    cursor: pointer;
    font: inherit;
    font-size: 0.8em;
  }
  .chip:hover { background: var(--vscode-list-hoverBackground); }
  .chip.active {
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    border-color: var(--vscode-focusBorder, transparent);
  }

  .range-bar {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 10px;
  }
  .range-label {
    font-size: 0.75em; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
`;

const SCRIPT = `
(function () {
  const dataEl = document.getElementById('report-data');
  const data = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
  const PALETTE = [
    'var(--pc-accent-blue)',
    'var(--pc-accent-orange)',
    'var(--pc-accent-green)',
    'var(--pc-accent-purple)',
    'var(--pc-accent-red)',
    'var(--pc-accent-yellow)',
    'var(--pc-accent-cyan)',
    'var(--pc-accent-pink)'
  ];
  const OVERRIDES = [
    { re: /claude.*opus/i,   c: 'var(--pc-accent-pink)'   },
    { re: /claude.*sonnet/i, c: 'var(--pc-accent-orange)' },
    { re: /claude.*haiku/i,  c: 'var(--pc-accent-yellow)' },
    { re: /^claude/i,        c: 'var(--pc-accent-orange)' },
    { re: /gpt-?5/i,         c: 'var(--pc-accent-cyan)'   },
    { re: /gpt-?4o/i,        c: 'var(--pc-accent-blue)'   },
    { re: /gpt-?4/i,         c: 'var(--pc-accent-blue)'   },
    { re: /^o\\d/i,          c: 'var(--pc-accent-purple)' },
    { re: /^gpt/i,           c: 'var(--pc-accent-blue)'   },
    { re: /gemini/i,         c: 'var(--pc-accent-green)'  },
    { re: /copilot\\/?auto/i,c: 'var(--pc-accent-purple)' }
  ];
  function normKey(s) {
    return String(s || '')
      .replace(/\\s*\\((?:copilot\\/)?auto\\)\\s*$/i, '')
      .replace(/^[^/]+\\//, '')
      .trim()
      .toLowerCase();
  }
  function hash32(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function colorForModel(name) {
    const k = normKey(name);
    for (const o of OVERRIDES) { if (o.re.test(k)) return o.c; }
    return PALETTE[hash32(k) % PALETTE.length];
  }
  // Bucket arrays already arrive most-recent-first.
  const bucketsByGran = {
    day:   data.dailyBuckets   || [],
    week:  data.weeklyBuckets  || [],
    month: data.monthlyBuckets || []
  };

  // ── Tab switching ────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.tab-panel').forEach(p => {
        const match = p.id === 'panel-' + target;
        p.toggleAttribute('hidden', !match);
        p.classList.toggle('active', match);
      });
    });
  });

  // ── Global range / Time tab segments ─────────────────────────────────────
  function bindSeg(group, onChange) {
    const seg = document.querySelector('.seg[data-seg="' + group + '"]');
    if (!seg) return;
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        onChange(btn.getAttribute('data-val'));
      });
    });
  }

  let curGran = 'day';
  let curMode = 'list';
  let curRange = '30d';
  // Multi-select set of model names. Empty set === "All" (no filter).
  const modelFilter = new Set();
  let sortDir = 'desc';

  function rangeCutoff() {
    if (curRange === 'all') return 0;
    const days = curRange === '7d' ? 7 : curRange === '90d' ? 90 : 30;
    return Date.now() - days * 86400000;
  }

  function refreshTime() {
    document.querySelectorAll('.time-list, .time-chart').forEach(el => {
      el.toggleAttribute('hidden', el.getAttribute('data-view') !== curMode);
    });
    document.querySelectorAll('.bucket-list, .bucket-chart').forEach(el => {
      el.toggleAttribute('hidden', el.getAttribute('data-gran') !== curGran);
    });
    applyRangeToBuckets();
  }
  bindSeg('granularity', v => { curGran = v; refreshTime(); });
  bindSeg('mode',        v => { curMode = v; refreshTime(); });

  function applyRangeToBuckets() {
    const cutoff = rangeCutoff();
    document.querySelectorAll('.bucket-list .bucket').forEach(el => {
      const ts = parseInt(el.getAttribute('data-start') || '0', 10);
      el.toggleAttribute('hidden', !(ts >= cutoff));
    });
  }

  function bindChips(group, setter, onChange) {
    const groupEl = document.querySelector('[data-chip-group="' + group + '"]');
    if (!groupEl) return;
    const isMulti = groupEl.getAttribute('data-multi') === 'true';
    groupEl.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.getAttribute('data-val');
        if (!isMulti) {
          groupEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
          setter(val);
          onChange && onChange();
          return;
        }
        // Multi-select: "__all__" clears all individual selections.
        // Clicking an individual chip toggles it and deactivates "__all__".
        // If all individuals are deselected, "__all__" reactivates.
        const chips = Array.from(groupEl.querySelectorAll('.chip'));
        const allChip = chips.find(c => c.getAttribute('data-val') === '__all__');
        if (val === '__all__') {
          chips.forEach(c => c.classList.toggle('active', c === allChip));
        } else {
          chip.classList.toggle('active');
          if (allChip) allChip.classList.remove('active');
          const anyActive = chips.some(c => c !== allChip && c.classList.contains('active'));
          if (!anyActive && allChip) allChip.classList.add('active');
        }
        const selected = chips
          .filter(c => c !== allChip && c.classList.contains('active'))
          .map(c => c.getAttribute('data-val'));
        setter(selected);
        onChange && onChange();
      });
    });
  }

  // Global range chip — re-applies everywhere.
  bindChips('range-global', v => { curRange = v; }, () => {
    updateAllSparklines();
    applyRangeToBuckets();
    rebuildCostList();
    rebuildKpis();
  });

  // Cost-tab chips
  bindChips('model', vals => {
    modelFilter.clear();
    (vals || []).forEach(v => modelFilter.add(v));
  }, rebuildCostList);
  bindChips('sort',  v => { sortDir = v; },     rebuildCostList);

  // ── Cost list rebuild — recomputes from buckets within range ───────────
  const costListEl = document.getElementById('cost-list');
  function rebuildCostList() {
    if (!costListEl) return;
    const cutoff = rangeCutoff();
    // Aggregate per-model cost/tokens across all daily buckets within range.
    const costMap = new Map();
    for (const b of bucketsByGran.day) {
      if (b.startMs < cutoff) continue;
      for (const mc of (b.modelCost || [])) {
        const cur = costMap.get(mc.model) || { cost: 0, tokens: 0 };
        cur.cost += mc.cost || 0;
        cur.tokens += mc.tokens || 0;
        costMap.set(mc.model, cur);
      }
    }
    let rows = Array.from(costMap.entries())
      .filter(([m]) => modelFilter.size === 0 || modelFilter.has(m))
      .map(([m, v]) => ({ model: m, cost: v.cost, tokens: v.tokens }));
    rows.sort((a, b) => sortDir === 'asc' ? a.cost - b.cost : b.cost - a.cost);
    if (rows.length === 0) {
      costListEl.innerHTML = '<li class="muted" style="padding:8px 0;">No data in this range.</li>';
      return;
    }
    costListEl.innerHTML = rows.map(r =>
      '<li data-model="' + escapeAttr(r.model) + '" data-cost="' + r.cost + '">' +
      '<span class="swatch" style="background:' + colorForModel(r.model) + '"></span>' +
      '<span class="model">' + escapeText(r.model) + '</span>' +
      '<span class="cost">' + escapeText(formatUsd(r.cost)) + '</span>' +
      '</li>'
    ).join('');
  }

  // ── Sparkline re-slicing on range chip change ───────────────────────────
  function updateAllSparklines() {
    const days = curRange === '7d' ? 7 : curRange === '90d' ? 90 : curRange === 'all' ? 365 : 30;
    document.querySelectorAll('.card[data-card-hash]').forEach(card => {
      const hash = card.getAttribute('data-card-hash');
      const wsCard = (data.workspaceCards || []).find(c => c.hash === hash);
      if (!wsCard) return;
      const points = (wsCard.dailyTotals || []).slice(-days);
      const svgWrap = card.querySelector('.card-section .spark');
      if (!svgWrap) return;
      svgWrap.outerHTML = buildSparkSvg(points);
    });
  }

  function buildSparkSvg(points) {
    const w = 560, h = 60;
    if (!points || points.length === 0) {
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="spark" aria-hidden="true"></svg>';
    }
    let max = 1;
    for (const p of points) { if (p.tokens > max) max = p.tokens; }
    const stepX = points.length > 1 ? w / (points.length - 1) : 0;
    let path = '';
    points.forEach((p, i) => {
      path += (i === 0 ? 'M ' : 'L ') + (i * stepX).toFixed(1) + ' ' + (h - (p.tokens / max) * h).toFixed(1) + ' ';
    });
    const area = path + 'L ' + w + ' ' + h + ' L 0 ' + h + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="spark" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="spark-area" d="' + area + '"></path>' +
      '<path class="spark-line" d="' + path + '"></path>' +
      '</svg>';
  }

  function formatTokens(n) {
    if (!isFinite(n) || n <= 0) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function formatInt(n) { return Math.round(n).toLocaleString(); }
  function formatUsd(n) {
    if (!isFinite(n)) return '$0.00';
    if (Math.abs(n) >= 1000) return '$' + Math.round(n).toLocaleString();
    return '$' + n.toFixed(2);
  }
  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function escapeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function rebuildKpis() {
    const cutoff = rangeCutoff();
    let totalTokens = 0, cost = 0, steps = 0, sessions = 0;
    for (const b of (data.dailyBuckets || [])) {
      if (b.startMs < cutoff) continue;
      totalTokens += b.totalTokens || 0;
      cost += b.cost || 0;
      steps += b.steps || 0;
      sessions += b.sessions || 0;
    }
    const totalVal = document.getElementById('kpi-total-value');
    if (totalVal) totalVal.textContent = formatTokens(totalTokens);
    const costsVal = document.getElementById('kpi-costs-value');
    if (costsVal) costsVal.textContent = formatUsd(cost);
    const costsSub = document.getElementById('kpi-costs-sub');
    if (costsSub) costsSub.textContent = formatInt(Math.round(cost / 0.01)) + ' AI credits';
    const stepsVal = document.getElementById('kpi-steps-value');
    if (stepsVal) stepsVal.textContent = formatInt(steps);
    // kpi-steps-sub (session count) is intentionally kept static: summing
    // per-day session counts would double-count sessions active on multiple
    // days. The server-rendered total is always the accurate distinct count.
  }

  // Initial state
  applyRangeToBuckets();
  rebuildKpis();
})();
`;
