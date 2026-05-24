import * as yaml from 'js-yaml';
import { PricingEntry, TurnInfo } from '../types';
import { PromptAnalyzerDb } from '../storage/database';
import { modelIdToDisplayName, modelIdToDisplayNameCandidates } from './slugMapper';
import fallbackPrices from './prices-fallback.json';

const PRICING_URL =
  'https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml';
const PRICING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10_000;

interface PricingYamlEntry {
  model?: string;
  input?: string | number;
  cached_input?: string | number;
  output?: string | number;
  cache_write?: string | number;
}

function parsePrice(val: string | number | undefined): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  return parseFloat(val.replace(/^\$/, '')) || 0;
}

/**
 * Normalizes a model name (from either the GitHub pricing YAML or a Copilot
 * log slug) to a single canonical lookup key:
 *   - Strip footnote markers like `[^1]`, `[^2]` that GitHub Docs uses.
 *   - Strip `copilot/` provider prefix.
 *   - Lowercase.
 *   - Replace any whitespace runs with `-`.
 *   - Collapse repeated `-`.
 *
 * After this, `"Claude Sonnet 4.6"`, `"claude sonnet 4.6"`, and the on-disk
 * slug `"copilot/claude-sonnet-4.6"` all collapse to `"claude-sonnet-4.6"`.
 */
export function normalizeModelSlug(name: string): string {
  return name
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/^copilot\//i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Parses the GitHub Copilot pricing YAML into an array of PricingEntry.
 * Model names are normalized to slug form (lowercase-dashed, footnote-free)
 * so lookups can compare against on-disk model ids directly without any
 * spaces-vs-dashes or case-sensitivity dance.
 */
export function parsePricingYaml(yamlText: string): PricingEntry[] {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const entries: PricingEntry[] = [];
  for (const item of parsed as PricingYamlEntry[]) {
    if (!item || typeof item !== 'object' || !item.model) continue;
    entries.push({
      model: normalizeModelSlug(item.model),
      inputPerM: parsePrice(item.input),
      cachedInputPerM: parsePrice(item.cached_input),
      outputPerM: parsePrice(item.output),
      cacheWritePerM: item.cache_write !== undefined ? parsePrice(item.cache_write) : null
    });
  }
  return entries;
}

/**
 * Ensures the pricing cache in the database is populated and fresh.
 * Fetches from GitHub if stale; falls back to bundled JSON if unavailable.
 * Also force-refetches when the cache contains any pre-normalization
 * (non-slug-form) entries from an older extension build.
 */
export async function refreshPricingCache(db: PromptAnalyzerDb): Promise<void> {
  const fetchedAt = db.getPricingFetchedAt();
  const now = Date.now();
  const hasStaleFormat = db.hasNonSlugPricingEntries();

  if (!hasStaleFormat && fetchedAt !== null && now - fetchedAt < PRICING_TTL_MS) {
    return; // Cache is fresh and in the current format
  }

  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(PRICING_URL, { signal: controller.signal });
    clearTimeout(timerId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const yamlText = await response.text();
    const entries = parsePricingYaml(yamlText);

    if (entries.length > 0) {
      db.setPricingEntries(entries, now);
      return;
    }
  } catch {
    // Network error or parse failure — fall through to fallback
  }

  // Only seed fallback if the cache has never been populated
  if (fetchedAt === null) {
    db.setPricingEntries(fallbackPrices as PricingEntry[], 0);
  }
}

/**
 * Calculates estimated cost for a turn and returns an updated copy with
 * the estimatedCost field populated.
 *
 * Cost strategy:
 *   - Output tokens: completionTokens × outputPerM / 1_000_000 (exact)
 *   - Cache-eligible input: cacheEligibleTokens × cachedInputPerM / 1_000_000 (estimated)
 *   - Remaining input: (estimatedPromptTokens - cacheEligibleTokens) × inputPerM / 1_000_000 (estimated)
 */
export function calculateTurnCost(
  turn: TurnInfo,
  db: PromptAnalyzerDb,
  customPrices: Record<string, { input?: number; output?: number }> = {}
): number | null {
  if (!turn.modelId) return null;

  // For `copilot/auto` we look up pricing for the actual model the router
  // chose (exposed as `resolvedModel`) and apply the 10% Auto discount.
  // Falls back to the literal `auto` slug if the parser didn't capture the
  // resolved model (legacy data or in-progress turns).
  const isAuto = turn.modelId === 'copilot/auto';
  const pricingModelId =
    isAuto && turn.resolvedModel
      ? `copilot/${turn.resolvedModel}`
      : turn.modelId;

  // Try a sequence of progressively normalised slug candidates so dated
  // variants (e.g. `claude-haiku-4-5-20251001`) and dotted versions still
  // resolve to a catalog entry. Catalog model names were normalized to slug
  // form at ingest, so we simply compare slug to slug. First hit wins.
  let dbEntry = null;
  let displayName = normalizeModelSlug(pricingModelId);
  for (const candidate of modelIdToDisplayNameCandidates(pricingModelId)) {
    const entry = db.getPricingEntry(candidate);
    if (entry) {
      dbEntry = entry;
      displayName = candidate;
      break;
    }
  }
  if (!dbEntry) return null;

  // Allow user overrides per model (display name key)
  const override = customPrices[displayName] ?? {};
  const inputPerM = override.input ?? dbEntry.inputPerM;
  const cachedInputPerM = dbEntry.cachedInputPerM;
  const outputPerM = override.output ?? dbEntry.outputPerM;

  const outputCost = ((turn.completionTokens ?? 0) / 1_000_000) * outputPerM;

  let inputCost = 0;
  if (turn.estimatedPromptTokens !== null && turn.estimatedPromptTokens > 0) {
    const cacheTokens = Math.min(turn.cacheEligibleTokens, turn.estimatedPromptTokens);
    const nonCacheTokens = turn.estimatedPromptTokens - cacheTokens;
    inputCost =
      (cacheTokens / 1_000_000) * cachedInputPerM +
      (nonCacheTokens / 1_000_000) * inputPerM;
  }

  const total = outputCost + inputCost;
  return isAuto ? total * 0.9 : total;
}
