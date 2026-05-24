/**
 * Maps a Copilot modelId (e.g. "copilot/claude-sonnet-4.6") to the display
 * name used in GitHub's pricing YAML (e.g. "Claude Sonnet 4.6").
 */

/** Hardcoded overrides for OpenAI slugs that don't title-case cleanly. */
const SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 mini',
  'gpt-4.1-nano': 'GPT-4.1 nano',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4': 'GPT-4',
  'gpt-3.5-turbo': 'GPT-3.5 Turbo',
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 mini',
  'o1': 'o1',
  'o1-mini': 'o1-mini',
  'o1-preview': 'o1-preview',
  'o3': 'o3',
  'o3-mini': 'o3-mini',
  'o4-mini': 'o4-mini'
};

/**
 * Converts a Copilot modelId to the pricing YAML display name.
 *
 * Algorithm:
 *  1. Strip "copilot/" prefix if present.
 *  2. Check SLUG_OVERRIDES map (exact match, case-insensitive key).
 *  3. Fall back to title-casing each hyphen-separated segment.
 */
export function modelIdToDisplayName(modelId: string): string {
  const slug = modelId.startsWith('copilot/') ? modelId.slice('copilot/'.length) : modelId;
  return slugToDisplayName(slug);
}

function slugToDisplayName(slug: string): string {
  // Check exact override (case-insensitive)
  const lowerSlug = slug.toLowerCase();
  for (const [key, val] of Object.entries(SLUG_OVERRIDES)) {
    if (key.toLowerCase() === lowerSlug) return val;
  }

  // Title-case heuristic: split on hyphens, capitalise each part
  return slug
    .split('-')
    .map(part => {
      if (!part) return part;
      // Don't capitalise parts that start with a digit (e.g. "4.6", "2.0")
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * Generate an ordered list of candidate display names for a given modelId,
 * progressively normalising common variant patterns. Used by the pricing
 * service to fall back when the exact slug isn't in the pricing catalog
 * (e.g. dated variants emitted by `copilot/auto`'s resolver).
 *
 * Order (each step queues a new candidate, then later steps also run against
 * everything queued so far):
 *  1. Exact slug.
 *  2. Strip trailing `-YYYYMMDD` (e.g. `claude-haiku-4-5-20251001`).
 *  3. Strip trailing `-YYYY-MM-DD` (e.g. `gpt-5.4-mini-2026-03-17`).
 *  4. Strip trailing `-codex` suffix (specialty variant priced as the base).
 *  5. Collapse trailing hyphen-separated single-digit version (`-N-N` ->
 *     `-N.N`, e.g. `claude-haiku-4-5` -> `claude-haiku-4.5`).
 *  6. Collapse dotted minor-version on a leading `xxx-N.M` token to `xxx-N`
 *     (e.g. `gpt-5.4-mini` -> `gpt-5-mini`, `gpt-5.3` -> `gpt-5`). Only
 *     applies to slugs whose first token already contains a dot.
 */
export function modelIdToDisplayNameCandidates(modelId: string): string[] {
  const slug = modelId.startsWith('copilot/') ? modelId.slice('copilot/'.length) : modelId;
  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!s || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    variants.push(s);
  };

  push(slug);

  // YYYYMMDD
  const m8 = slug.match(/^(.*)-(\d{8})$/);
  if (m8) push(m8[1]);

  // YYYY-MM-DD
  const mIso = slug.match(/^(.*)-(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) push(mIso[1]);

  // Strip `-codex` suffix (applies to every variant queued so far)
  for (const v of [...variants]) {
    const noCodex = v.replace(/-codex$/i, '');
    if (noCodex !== v) push(noCodex);
  }

  // Collapse trailing `-N-N` -> `-N.N`
  for (const v of [...variants]) {
    const dotted = v.replace(/-(\d+)-(\d+)$/, '-$1.$2');
    if (dotted !== v) push(dotted);
  }

  // For well-known model families (claude/gpt/gemini/o-series), additionally
  // convert internal `-N-N-` patterns to `-N.N-` (e.g. a hypothetical
  // `claude-haiku-4-5-variant` -> `claude-haiku-4.5-variant`). Constrained
  // to families we recognise so we don't aggressively rewrite arbitrary
  // dash-separated segments in unknown model names.
  const FAMILIES = /^(claude|gpt|gemini|o\d)\b/i;
  for (const v of [...variants]) {
    if (!FAMILIES.test(v)) continue;
    // Replace EVERY internal `-N-N-` (digits surrounded by dashes) with
    // `-N.N-`. Applied iteratively until stable.
    let next = v;
    while (true) {
      const replaced = next.replace(/-(\d+)-(\d+)-/, '-$1.$2-');
      if (replaced === next) break;
      next = replaced;
    }
    if (next !== v) push(next);
  }

  // Collapse `xxx-N.M[-rest]` -> `xxx-N[-rest]` (drop the minor version on
  // the leading versioned token). Only triggers when the leading token has
  // a dot, so non-versioned slugs are unaffected.
  for (const v of [...variants]) {
    const collapsed = v.replace(/^([^-]+)-(\d+)\.\d+(?=-|$)/, '$1-$2');
    if (collapsed !== v) push(collapsed);
  }

  // For each variant, emit the lowercased slug form (matches catalog entries
  // which are also normalized to slug form at YAML ingest time). The case-
  // insensitive SQL collation handles any remaining capitalisation drift.
  const out: string[] = [];
  const seenOut = new Set<string>();
  for (const v of variants) {
    const key = v.toLowerCase();
    if (!seenOut.has(key)) {
      seenOut.add(key);
      out.push(key);
    }
  }
  return out;
}
