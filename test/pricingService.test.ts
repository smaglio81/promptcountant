import { parsePricingYaml, calculateTurnCost } from '../src/pricing/PricingService';
import { PricingEntry, TurnInfo } from '../src/types';

// We test calculateTurnCost without a real DB by providing a stub db
function makeStubDb(entry: PricingEntry | null): { getPricingEntry: (name: string) => PricingEntry | null } {
  return {
    getPricingEntry: () => entry
  };
}

describe('PricingService', () => {
  // ── parsePricingYaml ────────────────────────────────────────────────────────
  describe('parsePricingYaml', () => {
    const sampleYaml = `
- model: Claude Sonnet 4.6
  provider: anthropic
  input: $3.00
  cached_input: $0.30
  output: $15.00
  cache_write: $3.75

- model: GPT-4.1
  provider: openai
  input: $2.00
  cached_input: $0.50
  output: $8.00

- model: Gemini 2.0 Flash
  provider: google
  input: $0.10
  cached_input: $0.025
  output: $0.40
`;

    it('parses valid YAML into pricing entries', () => {
      const entries = parsePricingYaml(sampleYaml);
      expect(entries).toHaveLength(3);
    });

    it('parses dollar-sign price strings', () => {
      const entries = parsePricingYaml(sampleYaml);
      const claude = entries.find(e => e.model === 'claude-sonnet-4.6')!;
      expect(claude.inputPerM).toBe(3.0);
      expect(claude.cachedInputPerM).toBe(0.3);
      expect(claude.outputPerM).toBe(15.0);
      expect(claude.cacheWritePerM).toBe(3.75);
    });

    it('sets cacheWritePerM to null when not present', () => {
      const entries = parsePricingYaml(sampleYaml);
      const gpt = entries.find(e => e.model === 'gpt-4.1')!;
      expect(gpt.cacheWritePerM).toBeNull();
    });

    it('returns empty array for malformed YAML', () => {
      expect(parsePricingYaml('not: valid: yaml: {')).toEqual([]);
    });

    it('returns empty array for non-array YAML', () => {
      expect(parsePricingYaml('key: value')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(parsePricingYaml('')).toEqual([]);
    });

    it('skips entries without a model field', () => {
      const yaml = `
- provider: openai
  input: $1.00
  output: $3.00
- model: GPT-4.1
  input: $2.00
  output: $8.00
`;
      const entries = parsePricingYaml(yaml);
      expect(entries).toHaveLength(1);
      expect(entries[0].model).toBe('gpt-4.1');
    });
  });

  // ── calculateTurnCost ───────────────────────────────────────────────────────
  describe('calculateTurnCost', () => {
    const claudePricing: PricingEntry = {
      model: 'Claude Sonnet 4.6',
      inputPerM: 3.0,
      cachedInputPerM: 0.3,
      outputPerM: 15.0,
      cacheWritePerM: 3.75
    };

    function makeTurn(overrides: Partial<TurnInfo> = {}): TurnInfo {
      return {
        requestId: 'req-1',
        sessionId: 'sess-1',
        timestamp: 1700000000000,
        modelId: 'copilot/claude-sonnet-4.6',
        completionTokens: 1000,
        estimatedPromptTokens: 4000,
        cacheEligibleTokens: 0,
        elapsedMs: 2000,
        messageText: 'A'.repeat(16000),
        isCompleted: true,
        estimatedCost: null,
        ...overrides
      };
    }

    it('calculates output cost correctly', () => {
      const db = makeStubDb(claudePricing) as any;
      const turn = makeTurn({ completionTokens: 1000, estimatedPromptTokens: null, cacheEligibleTokens: 0 });
      const cost = calculateTurnCost(turn, db);
      // 1000 / 1_000_000 * 15.0 = $0.015
      expect(cost).toBeCloseTo(0.015, 6);
    });

    it('calculates combined input + output cost', () => {
      const db = makeStubDb(claudePricing) as any;
      const turn = makeTurn({
        completionTokens: 1000,
        estimatedPromptTokens: 4000,
        cacheEligibleTokens: 0
      });
      const cost = calculateTurnCost(turn, db);
      // output: 1000/1M * 15 = 0.015
      // input:  4000/1M * 3 = 0.012
      // total: 0.027
      expect(cost).toBeCloseTo(0.027, 6);
    });

    it('uses cached input rate for cache-eligible tokens', () => {
      const db = makeStubDb(claudePricing) as any;
      const turn = makeTurn({
        completionTokens: 0,
        estimatedPromptTokens: 4000,
        cacheEligibleTokens: 3000
      });
      const cost = calculateTurnCost(turn, db);
      // cache tokens: 3000/1M * 0.3 = 0.0009
      // non-cache:    1000/1M * 3.0 = 0.003
      // total: 0.0039
      expect(cost).toBeCloseTo(0.0039, 6);
    });

    it('returns null when model has no pricing entry', () => {
      const db = makeStubDb(null) as any;
      const turn = makeTurn();
      expect(calculateTurnCost(turn, db)).toBeNull();
    });

    it('returns null when modelId is empty', () => {
      const db = makeStubDb(claudePricing) as any;
      const turn = makeTurn({ modelId: '' });
      expect(calculateTurnCost(turn, db)).toBeNull();
    });

    it('applies custom price overrides', () => {
      const db = makeStubDb(claudePricing) as any;
      const turn = makeTurn({
        completionTokens: 1000,
        estimatedPromptTokens: null
      });
      // Override output price to $30/M (custom-price keys use the slug form,
      // matching the catalog's normalized model id).
      const cost = calculateTurnCost(turn, db, { 'claude-sonnet-4.6': { output: 30 } });
      expect(cost).toBeCloseTo(0.030, 6);
    });

    it('handles zero completion tokens', () => {
      const db = makeStubDb(claudePricing) as any;
      const turn = makeTurn({ completionTokens: 0, estimatedPromptTokens: null });
      expect(calculateTurnCost(turn, db)).toBeCloseTo(0, 6);
    });
  });
});
