import { DateTime } from 'luxon';
import type { ParsedTimestamp } from '../types';
import { normalize } from './normalize';

type PatternMatch = {
  readonly epochMs: number;
  readonly ambiguous: boolean;
};

/**
 * Regex patterns for timestamp extraction, ordered by specificity.
 */
const PATTERNS: readonly { readonly regex: RegExp; readonly parse: (match: string) => PatternMatch | null }[] = [
  // ISO8601 / RFC3339 — explicit timezone, never ambiguous
  {
    regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})/g,
    parse: (match) => {
      const dt = DateTime.fromISO(match, { zone: 'utc' });
      return dt.isValid ? { epochMs: dt.toMillis(), ambiguous: false } : null;
    },
  },

  // Common log format: YYYY-MM-DD HH:mm:ss[.fff] with optional timezone abbreviation
  {
    regex: /\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:\s[A-Z]{2,5})?/g,
    parse: (match) => {
      const trimmed = match.trim();

      // Try with timezone abbreviation first — not ambiguous
      const withTz = DateTime.fromFormat(trimmed, 'yyyy-MM-dd HH:mm:ss.u z', { zone: 'utc' });
      if (withTz.isValid) return { epochMs: withTz.toMillis(), ambiguous: false };

      const withTzNoFrac = DateTime.fromFormat(trimmed, 'yyyy-MM-dd HH:mm:ss z', { zone: 'utc' });
      if (withTzNoFrac.isValid) return { epochMs: withTzNoFrac.toMillis(), ambiguous: false };

      // No timezone — ambiguous, temporarily assume UTC
      const withFrac = DateTime.fromFormat(trimmed, 'yyyy-MM-dd HH:mm:ss.u', { zone: 'utc' });
      if (withFrac.isValid) return { epochMs: withFrac.toMillis(), ambiguous: true };

      const noFrac = DateTime.fromFormat(trimmed, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
      if (noFrac.isValid) return { epochMs: noFrac.toMillis(), ambiguous: true };

      return null;
    },
  },

  // Unix epoch — inherently UTC, never ambiguous
  {
    regex: /(?<!\d)\d{10}(?:\.\d{1,3})?(?!\d)|(?<!\d)\d{13}(?!\d)/g,
    parse: (match) => {
      const num = Number(match);
      if (!Number.isFinite(num)) return null;

      if (match.length === 13 && !match.includes('.')) {
        return { epochMs: num, ambiguous: false };
      }

      return { epochMs: Math.round(num * 1000), ambiguous: false };
    },
  },
];

/** Maximum timestamps to extract per ingestion (guardrail) */
const MAX_EXTRACT = 50;

/**
 * Parse a single input string and return all detected timestamps.
 * Each line of input is preserved as rawText for context.
 */
export function extractTimestamps(input: string): readonly ParsedTimestamp[] {
  const results: ParsedTimestamp[] = [];
  const seen = new Set<string>();

  for (const { regex, parse } of PATTERNS) {
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      if (results.length >= MAX_EXTRACT) break;

      const posKey = `${match.index.toString()}:${match[0].length.toString()}`;
      if (seen.has(posKey)) continue;

      const result = parse(match[0]);
      if (result === null) continue;

      const lineStart = input.lastIndexOf('\n', match.index) + 1;
      const lineEnd = input.indexOf('\n', match.index);
      const rawText = input.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

      seen.add(posKey);
      results.push({
        ...normalize(result.epochMs, rawText),
        ambiguous: result.ambiguous,
      });
    }

    if (results.length >= MAX_EXTRACT) break;
  }

  return results;
}

/**
 * Attempt to parse a single timestamp string.
 * Returns the parsed result or null if no timestamp is found.
 */
export function parseSingle(input: string): ParsedTimestamp | null {
  const results = extractTimestamps(input.trim());
  return results[0] ?? null;
}
