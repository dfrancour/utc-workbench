import { describe, it, expect } from 'vitest';
import { normalize, reinterpret } from '../lib/normalize';

describe('normalize', () => {
  it('produces an ISO UTC string from epoch ms', () => {
    const result = normalize(1775325751123, 'raw text');
    expect(result.iso).toBe('2026-04-04T18:02:31.123Z');
    expect(result.timestamp).toBe(1775325751123);
    expect(result.rawText).toBe('raw text');
  });
});

describe('reinterpret', () => {
  it('reinterprets an ambiguous UTC-assumed timestamp as a different zone', () => {
    // 2026-04-04 18:02:31 assumed as UTC
    const original = {
      ...normalize(1775325751000, 'raw'),
      ambiguous: true,
    };

    // Reinterpret as America/New_York (EDT, UTC-4 on this date)
    const result = reinterpret(original, 'America/New_York');
    // Wall clock 18:02:31 EDT = 22:02:31 UTC
    expect(result.iso).toBe('2026-04-04T22:02:31.000Z');
    expect(result.ambiguous).toBe(false);
  });

  it('reinterpret as UTC is a no-op', () => {
    const original = {
      ...normalize(1775325751000, 'raw'),
      ambiguous: true,
    };
    const result = reinterpret(original, 'utc');
    expect(result.iso).toBe(original.iso);
    expect(result.timestamp).toBe(original.timestamp);
    expect(result.ambiguous).toBe(false);
  });

  it('preserves rawText across reinterpretation', () => {
    const original = {
      ...normalize(1775325751000, 'original log line'),
      ambiguous: true,
    };
    const result = reinterpret(original, 'America/Los_Angeles');
    expect(result.rawText).toBe('original log line');
  });
});
