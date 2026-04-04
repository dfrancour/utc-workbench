import { describe, it, expect } from 'vitest';
import { formatDelta, formatUnix } from '../lib/format';

describe('formatDelta', () => {
  it('formats milliseconds', () => {
    expect(formatDelta(500)).toBe('+500ms');
    expect(formatDelta(-200)).toBe('-200ms');
  });

  it('formats seconds', () => {
    expect(formatDelta(2400)).toBe('+2.4s');
    expect(formatDelta(-5000)).toBe('-5.0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDelta(90_000)).toBe('+1m 30s');
    expect(formatDelta(60_000)).toBe('+1m');
  });

  it('formats hours and minutes', () => {
    expect(formatDelta(3_660_000)).toBe('+1h 1m');
    expect(formatDelta(3_600_000)).toBe('+1h');
  });
});

describe('formatUnix', () => {
  it('formats integer epochs without decimals', () => {
    expect(formatUnix(1712253751000)).toBe('1712253751');
  });

  it('formats fractional epochs with 3 decimal places', () => {
    expect(formatUnix(1712253751123)).toBe('1712253751.123');
  });
});
