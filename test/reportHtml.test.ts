import { buildReportHtml } from '../src/ui/reportHtml';
import { buildReportViewModel } from '../src/ui/reportData';
import { ReportRow } from '../src/types';

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    telemetry_disabled: 0,
    workspace_hash: 'ws1',
    workspace_display_name: 'Workspace One',
    session_id: 's1',
    session_display_name: 'Session One',
    timestamp: Date.parse('2025-05-22T12:00:00'),
    model_id: 'gpt-4o',
    input_tokens: 1000,
    output_tokens: 500,
    cache_tokens: 100,
    cost: 0.50,
    duration_ms: 2000,
    ...over
  };
}

describe('buildReportHtml', () => {
  const NONCE = 'TESTNONCE';
  const NOW = Date.parse('2025-05-23T10:00:00');

  function html(rows: ReportRow[] = [row()]) {
    const vm = buildReportViewModel({ rows, scope: { type: 'all' }, now: NOW });
    return buildReportHtml({ vm, nonce: NONCE });
  }

  it('renders a well-formed document with CSP', () => {
    const h = html();
    expect(h.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(h).toContain("Content-Security-Policy");
    expect(h).toContain(`'nonce-${NONCE}'`);
  });

  it('shows all three tabs with Time active by default', () => {
    const h = html();
    expect(h).toContain('data-tab="projects"');
    expect(h).toContain('data-tab="time"');
    expect(h).toContain('data-tab="cost"');
    expect(h).toMatch(/<button class="tab active" role="tab" data-tab="time"/);
    expect(h).toContain('id="panel-projects"');
    expect(h).toContain('id="panel-time"');
    expect(h).toContain('id="panel-cost"');
  });

  it('renders KPI counters and scope title', () => {
    const h = html();
    expect(h).toContain('TODAY');
    expect(h).toContain('TOTAL');
    expect(h).toContain('COSTS');
    expect(h).toContain('STEPS');
    expect(h).toContain('All workspaces');
  });

  it('includes the project card with model cost rows', () => {
    const h = html([
      row({ model_id: 'gpt-4o', cost: 1.0 }),
      row({ model_id: 'claude-3-5-sonnet', cost: 5.0 })
    ]);
    expect(h).toContain('LLM USAGE');
    expect(h).toContain('MODEL COST COMPARISON');
    expect(h).toContain('claude-3-5-sonnet');
    expect(h).toContain('gpt-4o');
  });

  it('renders the granularity + mode segments on the Time tab', () => {
    const h = html();
    expect(h).toContain('data-seg="granularity"');
    expect(h).toContain('data-seg="mode"');
    expect(h).toContain('>Daily<');
    expect(h).toContain('>Weekly<');
    expect(h).toContain('>Monthly<');
    expect(h).toContain('>List<');
    expect(h).toContain('>Chart<');
  });

  it('renders model chips and a global time range chip group', () => {
    const h = html([
      row({ model_id: 'gpt-4o' }),
      row({ model_id: 'claude-3-5-sonnet' })
    ]);
    expect(h).toContain('data-chip-group="model"');
    expect(h).toContain('data-chip-group="sort"');
    expect(h).toContain('data-chip-group="range-global"');
    expect(h).toContain('data-val="gpt-4o"');
    expect(h).toContain('data-val="claude-3-5-sonnet"');
    expect(h).toContain('data-val="7d"');
    expect(h).toContain('data-val="30d"');
    expect(h).toContain('data-val="90d"');
    expect(h).toContain('data-val="all"');
  });

  it('shows an empty-state message on the Projects tab when there is no data', () => {
    const h = html([]);
    expect(h).toContain('No usage data yet.');
  });
});
