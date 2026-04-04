import { describe, it, expect } from 'vitest';
import { extractTimestamps, parseSingle } from '../lib/parser';

describe('parseSingle', () => {
  it('parses ISO8601 with Z suffix', () => {
    const result = parseSingle('2026-04-04T18:02:31.123Z');
    expect(result).not.toBeNull();
    expect(result!.iso).toBe('2026-04-04T18:02:31.123Z');
    expect(result!.timestamp).toBe(1775325751123);
    expect(result!.ambiguous).toBe(false);
  });

  it('parses ISO8601 with timezone offset', () => {
    const result = parseSingle('2026-04-04T13:02:31.123-05:00');
    expect(result).not.toBeNull();
    expect(result!.iso).toBe('2026-04-04T18:02:31.123Z');
    expect(result!.ambiguous).toBe(false);
  });

  it('parses Unix epoch in seconds', () => {
    const result = parseSingle('1712253751');
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1712253751000);
    expect(result!.ambiguous).toBe(false);
  });

  it('parses Unix epoch in milliseconds', () => {
    const result = parseSingle('1712253751123');
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1712253751123);
  });

  it('parses Unix epoch with decimal', () => {
    const result = parseSingle('1712253751.123');
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1712253751123);
  });

  it('parses common log format (no timezone) as ambiguous', () => {
    const result = parseSingle('2026-04-04 18:02:31.123');
    expect(result).not.toBeNull();
    expect(result!.iso).toBe('2026-04-04T18:02:31.123Z');
    expect(result!.ambiguous).toBe(true);
  });

  it('parses common log format (no fractional seconds) as ambiguous', () => {
    const result = parseSingle('2026-04-04 18:02:31');
    expect(result).not.toBeNull();
    expect(result!.iso).toBe('2026-04-04T18:02:31.000Z');
    expect(result!.ambiguous).toBe(true);
  });

  it('returns null for non-timestamp input', () => {
    expect(parseSingle('hello world')).toBeNull();
    expect(parseSingle('')).toBeNull();
  });
});

describe('extractTimestamps', () => {
  it('extracts multiple timestamps from log lines', () => {
    const input = [
      '2026-04-04T18:02:31.123Z ERROR retry failed at handler.go:42',
      '2026-04-04T18:02:33.500Z INFO connection restored',
      '2026-04-04T18:02:35.001Z WARN cache miss for key=abc',
    ].join('\n');

    const results = extractTimestamps(input);
    expect(results).toHaveLength(3);
    expect(results[0]!.iso).toBe('2026-04-04T18:02:31.123Z');
    expect(results[1]!.iso).toBe('2026-04-04T18:02:33.500Z');
    expect(results[2]!.iso).toBe('2026-04-04T18:02:35.001Z');
  });

  it('captures the full source line as note', () => {
    const input = '2026-04-04T18:02:31.123Z ERROR something broke';
    const results = extractTimestamps(input);
    expect(results[0]!.note).toBe(input);
  });

  it('respects MAX_EXTRACT limit', () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      `2026-04-04T18:02:${String(i % 60).padStart(2, '0')}.000Z line ${i.toString()}`
    ).join('\n');

    const results = extractTimestamps(lines);
    expect(results.length).toBeLessThanOrEqual(50);
  });

  it('returns empty array for no timestamps', () => {
    expect(extractTimestamps('no timestamps here')).toHaveLength(0);
    expect(extractTimestamps('')).toHaveLength(0);
  });
});
