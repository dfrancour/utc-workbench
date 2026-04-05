import { DateTime } from 'luxon';
import type { ParsedTimestamp } from '../types';
import { normalize } from './normalize';

type PatternMatch = {
  readonly epochMs: number;
  readonly ambiguous: boolean;
};

/**
 * Candidate Luxon format strings for human-readable month-name inputs.
 * Tried in order; first match wins. Ordered roughly most-specific first so
 * that a string like "Apr 3, 2026, 3:20:45 PM" matches the full format before
 * the shorter ones.
 */
const MONTH_NAME_FORMATS: readonly string[] = [
  // Short month name, 12-hour
  'LLL d, yyyy, h:mm:ss a',
  'LLL d, yyyy, h:mm a',
  'LLL d, yyyy h:mm:ss a',
  'LLL d, yyyy h:mm a',
  // Short month name, 24-hour
  'LLL d, yyyy, HH:mm:ss',
  'LLL d, yyyy, HH:mm',
  'LLL d, yyyy HH:mm:ss',
  'LLL d, yyyy HH:mm',
  // Full month name, 12-hour
  'LLLL d, yyyy, h:mm:ss a',
  'LLLL d, yyyy, h:mm a',
  'LLLL d, yyyy h:mm:ss a',
  'LLLL d, yyyy h:mm a',
  // Full month name, 24-hour
  'LLLL d, yyyy, HH:mm:ss',
  'LLLL d, yyyy, HH:mm',
  'LLLL d, yyyy HH:mm:ss',
  'LLLL d, yyyy HH:mm',
  // Date only
  'LLL d, yyyy',
  'LLLL d, yyyy',
];

/**
 * Normalize a month-name match so Luxon's case-sensitive format tokens
 * (`LLL`, `a`) accept it. We lower-case everything, then title-case the
 * leading word (the month) and upper-case any trailing AM/PM marker.
 */
function normalizeMonthMatch(match: string): string {
  return match
    .replace(/^([A-Za-z]+)/, (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase())
    .replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
}

/**
 * Regex patterns for timestamp extraction, ordered by specificity.
 */
const PATTERNS: readonly {
  readonly regex: RegExp;
  readonly parse: (match: string) => PatternMatch | null;
}[] = [
  // ISO8601 / RFC3339 — explicit timezone, never ambiguous
  {
    regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})/g,
    parse: (match) => {
      const dt = DateTime.fromISO(match, { zone: 'utc' });
      return dt.isValid ? { epochMs: dt.toMillis(), ambiguous: false } : null;
    },
  },

  // Log format: YYYY-MM-DD[ T]HH:mm:ss[.fff] with optional timezone abbreviation.
  // The `[ T]` separator also catches bare ISO without an explicit zone
  // (e.g. "2026-04-04T18:02:31"), which is treated as ambiguous.
  {
    regex: /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:\s[A-Z]{2,5})?/g,
    parse: (match) => {
      // Normalize the separator so a single Luxon format covers both variants.
      const trimmed = match.trim().replace('T', ' ');

      // Try with timezone abbreviation first — not ambiguous.
      const withTz = DateTime.fromFormat(trimmed, 'yyyy-MM-dd HH:mm:ss.u z', { zone: 'utc' });
      if (withTz.isValid) return { epochMs: withTz.toMillis(), ambiguous: false };

      const withTzNoFrac = DateTime.fromFormat(trimmed, 'yyyy-MM-dd HH:mm:ss z', { zone: 'utc' });
      if (withTzNoFrac.isValid) return { epochMs: withTzNoFrac.toMillis(), ambiguous: false };

      // The optional uppercase suffix in the regex may have swallowed a
      // non-timezone word (e.g. "INFO" from a log level). If tz parsing
      // failed, strip any trailing uppercase token and retry as ambiguous.
      const stripped = trimmed.replace(/\s+[A-Z]{2,5}$/, '');

      // No timezone — ambiguous, temporarily assume UTC.
      const withFrac = DateTime.fromFormat(stripped, 'yyyy-MM-dd HH:mm:ss.u', { zone: 'utc' });
      if (withFrac.isValid) return { epochMs: withFrac.toMillis(), ambiguous: true };

      const noFrac = DateTime.fromFormat(stripped, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
      if (noFrac.isValid) return { epochMs: noFrac.toMillis(), ambiguous: true };

      return null;
    },
  },

  // Slash-separated date: YYYY/MM/DD[ T]HH:mm:ss[.fff] — always ambiguous.
  {
    regex: /\d{4}\/\d{2}\/\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?/g,
    parse: (match) => {
      const trimmed = match.replace('T', ' ');

      const withFrac = DateTime.fromFormat(trimmed, 'yyyy/MM/dd HH:mm:ss.u', { zone: 'utc' });
      if (withFrac.isValid) return { epochMs: withFrac.toMillis(), ambiguous: true };

      const noFrac = DateTime.fromFormat(trimmed, 'yyyy/MM/dd HH:mm:ss', { zone: 'utc' });
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

  // Human-readable month-name formats: "Apr 3, 2026, 3:20 PM",
  // "April 3, 2026 15:20", "Apr 3, 2026" (date-only), etc.
  // Always ambiguous — no timezone component.
  {
    regex:
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:[a-z]+)?\b\s+\d{1,2},?\s+\d{4}(?:(?:,\s+|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?)?/gi,
    parse: (match) => {
      const normalized = normalizeMonthMatch(match.trim());
      for (const fmt of MONTH_NAME_FORMATS) {
        const dt = DateTime.fromFormat(normalized, fmt, { zone: 'utc' });
        if (dt.isValid) return { epochMs: dt.toMillis(), ambiguous: true };
      }
      return null;
    },
  },
];

/** Maximum timestamps to extract per ingestion (guardrail) */
const MAX_EXTRACT = 50;

/**
 * Parse a single input string and return all detected timestamps.
 * Each match's source line is captured as the initial data.
 *
 * Deduplication is by character-range overlap: once a span of the input has
 * been claimed by an earlier (more specific) pattern, later patterns can't
 * re-match any position inside it. This is what keeps e.g. the relaxed log
 * pattern from double-reporting the prefix of an ISO8601-with-Z match.
 */
export function extractTimestamps(input: string): readonly ParsedTimestamp[] {
  const results: ParsedTimestamp[] = [];
  const claimedRanges: { start: number; end: number }[] = [];

  function overlapsClaimed(start: number, end: number): boolean {
    return claimedRanges.some((r) => start < r.end && end > r.start);
  }

  for (const { regex, parse } of PATTERNS) {
    if (results.length >= MAX_EXTRACT) break;
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      if (results.length >= MAX_EXTRACT) break;

      const start = match.index;
      const end = start + match[0].length;
      if (overlapsClaimed(start, end)) continue;

      const result = parse(match[0]);
      if (result === null) continue;

      const lineStart = input.lastIndexOf('\n', start) + 1;
      const lineEnd = input.indexOf('\n', start);
      const data = input.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

      claimedRanges.push({ start, end });
      results.push({
        ...normalize(result.epochMs, data),
        ambiguous: result.ambiguous,
        label: null,
        url: null,
      });
    }
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
