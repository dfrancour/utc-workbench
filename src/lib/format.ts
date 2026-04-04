import { DateTime } from 'luxon';

/**
 * Format a delta in milliseconds as a human-readable string.
 * Auto-scales from ms → s → min → hr.
 */
export function formatDelta(deltaMs: number): string {
  const abs = Math.abs(deltaMs);
  const sign = deltaMs < 0 ? '-' : '+';

  if (abs < 1000) {
    return `${sign}${abs.toString()}ms`;
  }
  if (abs < 60_000) {
    const s = (abs / 1000).toFixed(1);
    return `${sign}${s}s`;
  }
  if (abs < 3_600_000) {
    const min = Math.floor(abs / 60_000);
    const s = Math.round((abs % 60_000) / 1000);
    return s > 0 ? `${sign}${min.toString()}m ${s.toString()}s` : `${sign}${min.toString()}m`;
  }
  const hr = Math.floor(abs / 3_600_000);
  const min = Math.round((abs % 3_600_000) / 60_000);
  return min > 0 ? `${sign}${hr.toString()}h ${min.toString()}m` : `${sign}${hr.toString()}h`;
}

/**
 * Format a relative time string (e.g., "2m 14s ago", "in 5m").
 */
export function formatRelative(epochMs: number): string {
  const now = DateTime.utc();
  const then = DateTime.fromMillis(epochMs, { zone: 'utc' });
  const diff = now.diff(then, ['hours', 'minutes', 'seconds']);

  const totalSeconds = Math.abs(diff.as('seconds'));
  const isPast = diff.as('seconds') > 0;

  if (totalSeconds < 60) {
    const s = Math.round(totalSeconds);
    const label = `${s.toString()}s`;
    return isPast ? `${label} ago` : `in ${label}`;
  }
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.round(totalSeconds % 60);
    const label = s > 0 ? `${m.toString()}m ${s.toString()}s` : `${m.toString()}m`;
    return isPast ? `${label} ago` : `in ${label}`;
  }

  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  const label = m > 0 ? `${h.toString()}h ${m.toString()}m` : `${h.toString()}h`;
  return isPast ? `${label} ago` : `in ${label}`;
}

/**
 * Format a Unix epoch in seconds (with optional fractional ms).
 */
export function formatUnix(epochMs: number): string {
  const seconds = epochMs / 1000;
  return Number.isInteger(seconds) ? seconds.toString() : seconds.toFixed(3);
}
