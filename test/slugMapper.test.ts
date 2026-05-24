import { modelIdToDisplayName, modelIdToDisplayNameCandidates } from '../src/pricing/slugMapper';

describe('slugMapper', () => {
  describe('modelIdToDisplayName', () => {
    // ── Prefix stripping ──────────────────────────────────────────────────────
    it('strips the copilot/ prefix', () => {
      expect(modelIdToDisplayName('copilot/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    });

    it('works without the copilot/ prefix', () => {
      expect(modelIdToDisplayName('claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    });

    // ── OpenAI overrides ──────────────────────────────────────────────────────
    it('uses override for gpt-4.1', () => {
      expect(modelIdToDisplayName('copilot/gpt-4.1')).toBe('GPT-4.1');
    });

    it('uses override for gpt-4.1-mini', () => {
      expect(modelIdToDisplayName('copilot/gpt-4.1-mini')).toBe('GPT-4.1 mini');
    });

    it('uses override for gpt-4o', () => {
      expect(modelIdToDisplayName('copilot/gpt-4o')).toBe('GPT-4o');
    });

    it('uses override for gpt-4o-mini', () => {
      expect(modelIdToDisplayName('copilot/gpt-4o-mini')).toBe('GPT-4o mini');
    });

    it('uses override for o1', () => {
      expect(modelIdToDisplayName('copilot/o1')).toBe('o1');
    });

    it('uses override for o3-mini', () => {
      expect(modelIdToDisplayName('copilot/o3-mini')).toBe('o3-mini');
    });

    it('uses override for o4-mini', () => {
      expect(modelIdToDisplayName('copilot/o4-mini')).toBe('o4-mini');
    });

    // ── Title-case heuristic ──────────────────────────────────────────────────
    it('title-cases Anthropic model slugs', () => {
      expect(modelIdToDisplayName('copilot/claude-opus-4')).toBe('Claude Opus 4');
    });

    it('title-cases Anthropic haiku slug', () => {
      expect(modelIdToDisplayName('copilot/claude-haiku-3.5')).toBe('Claude Haiku 3.5');
    });

    it('does not capitalise numeric segments', () => {
      // "gemini-2.0-flash" → "Gemini 2.0 Flash"
      expect(modelIdToDisplayName('copilot/gemini-2.0-flash')).toBe('Gemini 2.0 Flash');
    });

    it('handles gemini-1.5-pro', () => {
      expect(modelIdToDisplayName('copilot/gemini-1.5-pro')).toBe('Gemini 1.5 Pro');
    });

    it('handles gemini-1.5-flash', () => {
      expect(modelIdToDisplayName('copilot/gemini-1.5-flash')).toBe('Gemini 1.5 Flash');
    });

    // ── Override matching is case-insensitive ─────────────────────────────────
    it('matches override keys case-insensitively', () => {
      expect(modelIdToDisplayName('copilot/GPT-4.1')).toBe('GPT-4.1');
    });
  });

  describe('modelIdToDisplayNameCandidates', () => {
    it('strips trailing YYYYMMDD date and converts trailing -N-N to -N.N', () => {
      // claude-haiku-4-5-20251001 (auto) -> needs to resolve to claude-haiku-4.5
      const cands = modelIdToDisplayNameCandidates('copilot/claude-haiku-4-5-20251001');
      expect(cands).toContain('claude-haiku-4.5');
    });

    it('strips trailing YYYY-MM-DD date', () => {
      // gpt-5.4-2026-03-05 (auto) -> needs to resolve to gpt-5.4
      const cands = modelIdToDisplayNameCandidates('copilot/gpt-5.4-2026-03-05');
      expect(cands).toContain('gpt-5.4');
    });

    it('converts internal -N-N- to -N.N- for well-known model families', () => {
      // hypothetical claude-haiku-4-5-preview should still match claude-haiku-4.5-preview
      const cands = modelIdToDisplayNameCandidates('copilot/claude-haiku-4-5-preview');
      expect(cands).toContain('claude-haiku-4.5-preview');
    });

    it('does not rewrite -N-N- for unknown families', () => {
      const cands = modelIdToDisplayNameCandidates('copilot/unknown-thing-4-5-preview');
      // The unknown family escape hatch: no `unknown-thing-4.5-preview` produced
      expect(cands).not.toContain('unknown-thing-4.5-preview');
    });

    it('always includes the exact lowercased slug as first candidate', () => {
      expect(modelIdToDisplayNameCandidates('copilot/Claude-Sonnet-4.6')[0]).toBe('claude-sonnet-4.6');
    });
  });
});
