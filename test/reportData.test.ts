import { buildReportViewModel, providerOf } from '../src/ui/reportData';
import { ReportRow, ReportScope } from '../src/types';

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    telemetry_disabled: 0,
    workspace_hash: 'ws1',
    workspace_display_name: 'Workspace One',
    session_id: 'sess-1',
    session_display_name: 'Session One',
    timestamp: Date.parse('2025-05-20T12:00:00'),
    model_id: 'claude-3-5-sonnet',
    input_tokens: 1000,
    output_tokens: 500,
    cache_tokens: 200,
    cost: 0.012,
    duration_ms: 1500,
    ...over
  };
}

describe('buildReportViewModel', () => {
  const NOW = Date.parse('2025-05-23T10:00:00');

  it('computes totals correctly across rows', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ input_tokens: 100, output_tokens: 200, cache_tokens: 50, cost: 0.5 }),
        row({ input_tokens: 300, output_tokens: 400, cache_tokens: 0,  cost: 1.25 })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.totals.inputTokens).toBe(400);
    expect(vm.totals.outputTokens).toBe(600);
    expect(vm.totals.cacheTokens).toBe(50);
    expect(vm.totals.totalTokens).toBe(1050);
    expect(vm.totals.cost).toBeCloseTo(1.75, 6);
    expect(vm.totals.steps).toBe(2);
    expect(vm.totals.sessions).toBe(1);
  });

  it('counts today tokens using local-day boundary', () => {
    const today = Date.parse('2025-05-23T09:30:00');
    const yesterday = Date.parse('2025-05-22T23:00:00');
    const vm = buildReportViewModel({
      rows: [
        row({ timestamp: today, input_tokens: 10, output_tokens: 5, cache_tokens: 0 }),
        row({ timestamp: yesterday, input_tokens: 99, output_tokens: 1, cache_tokens: 0 })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.totals.todayTokens).toBe(15);
  });

  it('builds one workspace card per workspace and sorts by cost desc', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ workspace_hash: 'a', workspace_display_name: 'A', cost: 1.0 }),
        row({ workspace_hash: 'b', workspace_display_name: 'B', cost: 5.0 }),
        row({ workspace_hash: 'a', workspace_display_name: 'A', cost: 0.5 })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.workspaceCards).toHaveLength(2);
    expect(vm.workspaceCards[0].hash).toBe('b');
    expect(vm.workspaceCards[1].hash).toBe('a');
    expect(vm.workspaceCards[1].cost).toBeCloseTo(1.5);
  });

  it('groups by session when scope is a single session', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ session_id: 's1', session_display_name: 'My session', cost: 0.3 }),
        row({ session_id: 's1', session_display_name: 'My session', cost: 0.2 })
      ],
      scope: { type: 'session', sessionId: 's1' },
      now: NOW
    });
    expect(vm.scopeTitle).toBe('My session');
    expect(vm.workspaceCards).toHaveLength(1);
    expect(vm.workspaceCards[0].steps).toBe(2);
  });

  it('produces day/week/month buckets with the latest first', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ timestamp: Date.parse('2025-05-22T10:00:00'), input_tokens: 10 }),
        row({ timestamp: Date.parse('2025-05-23T10:00:00'), input_tokens: 20 }),
        row({ timestamp: Date.parse('2025-05-23T11:00:00'), input_tokens: 30 })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.buckets.day.length).toBe(2);
    expect(vm.buckets.day[0].steps).toBe(2);            // 2025-05-23
    expect(vm.buckets.day[1].steps).toBe(1);            // 2025-05-22
    expect(vm.buckets.day[0].startMs).toBeGreaterThan(vm.buckets.day[1].startMs);
  });

  it('aggregates per-model cost and tokens', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ model_id: 'gpt-4o', cost: 1.0, input_tokens: 100, output_tokens: 0, cache_tokens: 0 }),
        row({ model_id: 'gpt-4o', cost: 0.5, input_tokens: 0,  output_tokens: 50, cache_tokens: 0 }),
        row({ model_id: 'claude-3-5-sonnet', cost: 2.0, input_tokens: 0, output_tokens: 0, cache_tokens: 300 })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.modelCost).toHaveLength(2);
    expect(vm.modelCost[0].model).toBe('claude-3-5-sonnet');
    expect(vm.modelCost[0].cost).toBeCloseTo(2.0);
    expect(vm.modelCost[1].model).toBe('gpt-4o');
    expect(vm.modelCost[1].cost).toBeCloseTo(1.5);
    expect(vm.modelCost[1].tokens).toBe(150);
  });

  it('derives providers from model ids', () => {
    expect(providerOf('claude-3-5-sonnet')).toBe('anthropic');
    expect(providerOf('gpt-4o')).toBe('openai');
    expect(providerOf('o1-preview')).toBe('openai');
    expect(providerOf('gemini-1.5-pro')).toBe('google');
    expect(providerOf('openai/gpt-4o')).toBe('openai');
    expect(providerOf('something-weird')).toBe('(unknown)');
    expect(providerOf('')).toBe('(unknown)');
  });

  it('exposes the unique sorted provider list', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ model_id: 'gpt-4o' }),
        row({ model_id: 'claude-3-5-sonnet' }),
        row({ model_id: 'gemini-1.5-pro' }),
        row({ model_id: 'gpt-4o' })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.providers).toEqual(['anthropic', 'google', 'openai']);
  });

  it('returns empty cards list for empty rows', () => {
    const vm = buildReportViewModel({ rows: [], scope: { type: 'all' }, now: NOW });
    expect(vm.workspaceCards).toEqual([]);
    expect(vm.totals.totalTokens).toBe(0);
    expect(vm.modelCost).toEqual([]);
    expect(vm.buckets.day).toEqual([]);
  });

  it('emits dailyTotals with the configured length (365)', () => {
    const vm = buildReportViewModel({
      rows: [row({ input_tokens: 100, output_tokens: 0, cache_tokens: 0 })],
      scope: { type: 'all' },
      now: NOW
    });
    expect(vm.workspaceCards[0].dailyTotals.length).toBe(365);
  });

  it('labels scope titles correctly', () => {
    const allVm = buildReportViewModel({ rows: [], scope: { type: 'all' }, now: NOW });
    expect(allVm.scopeTitle).toBe('All workspaces');

    const wsScope: ReportScope = { type: 'workspace', workspaceHash: 'ws1' };
    const wsVm = buildReportViewModel({
      rows: [row({ workspace_display_name: 'Pictoscan' })],
      scope: wsScope,
      now: NOW
    });
    expect(wsVm.scopeTitle).toBe('Pictoscan');
  });

  it('labels copilot/auto rows as "{resolvedModel} (auto)"', () => {
    const vm = buildReportViewModel({
      rows: [
        row({ model_id: 'copilot/auto', resolved_model: 'gpt-5.3-codex', cost: 1.0 }),
        row({ model_id: 'copilot/auto', resolved_model: 'gpt-5.3-codex', cost: 2.0 }),
        row({ model_id: 'copilot/auto', resolved_model: null,             cost: 0.5 })
      ],
      scope: { type: 'all' },
      now: NOW
    });
    const models = vm.modelCost.map(m => m.model);
    expect(models).toContain('gpt-5.3-codex (auto)');
    expect(models).toContain('auto');
    const gpt = vm.modelCost.find(m => m.model === 'gpt-5.3-codex (auto)')!;
    expect(gpt.cost).toBeCloseTo(3.0);
    // Provider detection strips the suffix and uses the underlying model
    expect(gpt.provider).toBe('openai');
  });

  it('formats weekly bucket labels as "M/D - M/D" within current year', () => {
    const thisYear = new Date().getFullYear();
    const monday = new Date(thisYear, 4, 19, 12, 0, 0).getTime(); // May 19
    const vm = buildReportViewModel({
      rows: [row({ timestamp: monday })],
      scope: { type: 'all' },
      now: monday
    });
    const wk = vm.buckets.week[0];
    expect(wk.label).toMatch(/^\d{1,2}\/\d{1,2}\s-\s\d{1,2}\/\d{1,2}$/);
  });
});
