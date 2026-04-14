import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import type { ParsedTimestamp } from "../types";
import { extractTimestamps, MAX_EXTRACT } from "../lib/parser";

/**
 * Local test helper: extract and return the first timestamp, or null.
 * The library itself doesn't expose a single-string API because the
 * component only consumes the multi-match form; these tests predate that
 * decision and are easier to read in single-string style.
 */
function parseSingle(input: string): ParsedTimestamp | null {
  const { timestamps } = extractTimestamps(input.trim());
  return timestamps[0] ?? null;
}

describe("parseSingle", () => {
  it("parses ISO8601 with Z suffix", () => {
    const result = parseSingle("2026-04-04T18:02:31.123Z");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-04T18:02:31.123Z");
    expect(result!.timestamp).toBe(1775325751123);
    expect(result!.ambiguous).toBe(false);
  });

  it("parses ISO8601 with timezone offset", () => {
    const result = parseSingle("2026-04-04T13:02:31.123-05:00");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-04T18:02:31.123Z");
    expect(result!.ambiguous).toBe(false);
  });

  it("parses Unix epoch in seconds", () => {
    const result = parseSingle("1712253751");
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1712253751000);
    expect(result!.ambiguous).toBe(false);
  });

  it("parses Unix epoch in milliseconds", () => {
    const result = parseSingle("1712253751123");
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1712253751123);
  });

  it("parses Unix epoch with decimal", () => {
    const result = parseSingle("1712253751.123");
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1712253751123);
  });

  it("parses common log format (no timezone) as ambiguous", () => {
    const result = parseSingle("2026-04-04 18:02:31.123");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-04T18:02:31.123Z");
    expect(result!.ambiguous).toBe(true);
  });

  it("parses common log format (no fractional seconds) as ambiguous", () => {
    const result = parseSingle("2026-04-04 18:02:31");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-04T18:02:31.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it("returns null for non-timestamp input", () => {
    expect(parseSingle("hello world")).toBeNull();
    expect(parseSingle("")).toBeNull();
  });

  it("parses bare ISO with T separator and no timezone as ambiguous", () => {
    const result = parseSingle("2026-04-04T18:02:31");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-04T18:02:31.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it("parses log line with uppercase level word after timestamp as ambiguous", () => {
    // Regression: the optional tz-abbreviation suffix in the log regex
    // used to swallow " INFO" and fail both tz and non-tz parse paths.
    const result = parseSingle("2026-04-03 15:20:50 INFO: Cloning repository");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:50.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it("resolves recognized timezone abbreviations to their offset", () => {
    // PST = UTC-8, so 15:20:50 PST → 23:20:50 UTC.
    const pst = parseSingle("2026-04-04 15:20:50 PST");
    expect(pst).not.toBeNull();
    expect(pst!.iso).toBe("2026-04-04T23:20:50.000Z");
    expect(pst!.ambiguous).toBe(false);

    // EDT = UTC-4, fractional seconds preserved through the offset math.
    const edt = parseSingle("2026-04-04 10:15:30.250 EDT");
    expect(edt).not.toBeNull();
    expect(edt!.iso).toBe("2026-04-04T14:15:30.250Z");
    expect(edt!.ambiguous).toBe(false);

    // CEST = UTC+2.
    const cest = parseSingle("2026-04-04 18:00:00 CEST");
    expect(cest).not.toBeNull();
    expect(cest!.iso).toBe("2026-04-04T16:00:00.000Z");
    expect(cest!.ambiguous).toBe(false);

    // JST = UTC+9.
    const jst = parseSingle("2026-04-04 08:00:00 JST");
    expect(jst).not.toBeNull();
    expect(jst!.iso).toBe("2026-04-03T23:00:00.000Z");
    expect(jst!.ambiguous).toBe(false);
  });

  it("treats regionally ambiguous abbreviations as unresolved", () => {
    // CST = US Central OR China Standard — deliberately omitted from the
    // lookup so the user picks. Falls through to the strip-and-ambiguous
    // path, which means the timestamp is still recognized but flagged.
    const cst = parseSingle("2026-04-04 15:20:50 CST");
    expect(cst).not.toBeNull();
    expect(cst!.iso).toBe("2026-04-04T15:20:50.000Z");
    expect(cst!.ambiguous).toBe(true);
  });

  describe("date-less time", () => {
    // These tests compute expected results against "today's UTC date at
    // parse time" rather than hard-coding a date, so they remain green as
    // the calendar advances. Date math stays ISO and small enough to trust.
    const todayIsoDate = DateTime.utc().toISODate();

    it('parses "HH:mm" as today at that UTC wall-clock, ambiguous', () => {
      const result = parseSingle("15:20");
      expect(result).not.toBeNull();
      expect(result!.iso).toBe(`${todayIsoDate}T15:20:00.000Z`);
      expect(result!.ambiguous).toBe(true);
    });

    it('parses "HH:mm:ss" with seconds', () => {
      const result = parseSingle("15:20:30");
      expect(result).not.toBeNull();
      expect(result!.iso).toBe(`${todayIsoDate}T15:20:30.000Z`);
      expect(result!.ambiguous).toBe(true);
    });

    it('parses "HH:mm:ss.fff" preserving fractional seconds', () => {
      const result = parseSingle("15:20:30.250");
      expect(result).not.toBeNull();
      expect(result!.iso).toBe(`${todayIsoDate}T15:20:30.250Z`);
      expect(result!.ambiguous).toBe(true);
    });

    it("resolves a trailing timezone abbreviation", () => {
      // 15:20 EST = 20:20 UTC (EST = -5).
      const result = parseSingle("15:20 EST");
      expect(result).not.toBeNull();
      expect(result!.iso).toBe(`${todayIsoDate}T20:20:00.000Z`);
      expect(result!.ambiguous).toBe(false);
    });

    it("treats an unrecognized trailing token as ambiguous", () => {
      const result = parseSingle("15:20 FOO");
      expect(result).not.toBeNull();
      expect(result!.iso).toBe(`${todayIsoDate}T15:20:00.000Z`);
      expect(result!.ambiguous).toBe(true);
    });

    it("does not match bare times embedded in log prose", () => {
      // Regression guard: the pattern must be line-anchored so it can't
      // accidentally fire on numbers that happen to look time-shaped.
      expect(parseSingle("request took 15:20 to complete")).toBeNull();
      expect(parseSingle("retry after 30:00")).toBeNull();
    });

    it("defers to the log pattern when a full date-time is present", () => {
      // The log pattern claims the range first, so the date-less pattern
      // never fires on this input — the expected date is 2026-04-04, not
      // today.
      const result = parseSingle("2026-04-04 15:20:00");
      expect(result).not.toBeNull();
      expect(result!.iso).toBe("2026-04-04T15:20:00.000Z");
    });

    it("extracts a bare time on its own line alongside a full date-time", () => {
      const input = ["2026-04-04T10:00:00Z first", "16:00 EST"].join("\n");
      const { timestamps } = extractTimestamps(input);
      expect(timestamps).toHaveLength(2);
      const isos = timestamps.map((r) => r.iso);
      expect(isos).toContain("2026-04-04T10:00:00.000Z");
      expect(isos).toContain(`${todayIsoDate}T21:00:00.000Z`); // 16:00 EST = 21:00 UTC
    });
  });

  it("parses slash-separated date-time as ambiguous", () => {
    const result = parseSingle("2026/04/04 18:02:31");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-04T18:02:31.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it('parses "Apr 3, 2026, 3:20 PM" as ambiguous', () => {
    const result = parseSingle("Apr 3, 2026, 3:20 PM");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:00.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it('parses "April 3, 2026 15:20:45" (full month, 24h, with seconds)', () => {
    const result = parseSingle("April 3, 2026 15:20:45");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:45.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it('parses "Apr 3, 2026" (date only)', () => {
    const result = parseSingle("Apr 3, 2026");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T00:00:00.000Z");
    expect(result!.ambiguous).toBe(true);
  });

  it("accepts mixed-case month names and am/pm markers", () => {
    expect(parseSingle("APR 3, 2026, 3:20 pm")?.iso).toBe("2026-04-03T15:20:00.000Z");
    expect(parseSingle("april 3, 2026, 3:20 AM")?.iso).toBe("2026-04-03T03:20:00.000Z");
  });

  it("parses nginx/apache common log format with brackets", () => {
    const result = parseSingle('127.0.0.1 - - [03/Apr/2026:15:20:50 +0000] "GET /api HTTP/1.1" 200 42');
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:50.000Z");
    expect(result!.ambiguous).toBe(false);
  });

  it("parses nginx/apache format with non-zero offset", () => {
    const result = parseSingle("[03/Apr/2026:10:20:50 -0500]");
    expect(result).not.toBeNull();
    // 10:20:50 -0500 = 15:20:50 UTC
    expect(result!.iso).toBe("2026-04-03T15:20:50.000Z");
    expect(result!.ambiguous).toBe(false);
  });

  it("parses RFC2822 with GMT", () => {
    // Apr 3, 2026 is a Friday — fromRFC2822 validates the weekday.
    const result = parseSingle("Fri, 03 Apr 2026 15:20:50 GMT");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:50.000Z");
    expect(result!.ambiguous).toBe(false);
  });

  it("parses RFC2822 with numeric offset", () => {
    const result = parseSingle("Fri, 03 Apr 2026 10:20:50 -0500");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:50.000Z");
    expect(result!.ambiguous).toBe(false);
  });

  it("parses syslog RFC3164 (no year, no timezone) as ambiguous", () => {
    const result = parseSingle("Apr  3 15:20:50 myhost sshd[1234]: session opened");
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(true);
    const currentYear = new Date().getUTCFullYear();
    expect(result!.iso).toBe(`${currentYear.toString()}-04-03T15:20:50.000Z`);
  });

  it("parses syslog RFC3164 with two-digit day", () => {
    const result = parseSingle("Apr 13 15:20:50 myhost sshd: accepted");
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(true);
    const currentYear = new Date().getUTCFullYear();
    expect(result!.iso).toBe(`${currentYear.toString()}-04-13T15:20:50.000Z`);
  });

  it("parses Unix epoch in microseconds (16 digits)", () => {
    // 2026-04-04T18:02:31.123456Z
    const result = parseSingle("1775325751123456");
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1775325751123);
    expect(result!.ambiguous).toBe(false);
  });

  it("parses Unix epoch in nanoseconds (19 digits)", () => {
    // Go's time.Now().UnixNano() shape; 2026-04-04T18:02:31.123456789Z
    const result = parseSingle("1775325751123456789");
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1775325751123);
    expect(result!.ambiguous).toBe(false);
  });

  it("parses RFC5424 syslog (ISO with fractional seconds + zone)", () => {
    const result = parseSingle("2026-04-03T15:20:50.123456Z host app - - - message");
    expect(result).not.toBeNull();
    expect(result!.iso).toBe("2026-04-03T15:20:50.123Z");
    expect(result!.ambiguous).toBe(false);
  });
});

describe("extractTimestamps", () => {
  it("extracts multiple timestamps from log lines", () => {
    const input = [
      "2026-04-04T18:02:31.123Z ERROR retry failed at handler.go:42",
      "2026-04-04T18:02:33.500Z INFO connection restored",
      "2026-04-04T18:02:35.001Z WARN cache miss for key=abc",
    ].join("\n");

    const { timestamps, truncated } = extractTimestamps(input);
    expect(timestamps).toHaveLength(3);
    expect(truncated).toBe(false);
    expect(timestamps[0]!.iso).toBe("2026-04-04T18:02:31.123Z");
    expect(timestamps[1]!.iso).toBe("2026-04-04T18:02:33.500Z");
    expect(timestamps[2]!.iso).toBe("2026-04-04T18:02:35.001Z");
  });

  it("captures the full source line as data", () => {
    const input = "2026-04-04T18:02:31.123Z ERROR something broke";
    const { timestamps } = extractTimestamps(input);
    expect(timestamps[0]!.data).toBe(input);
  });

  it("caps at MAX_EXTRACT and flags truncated", () => {
    // Generate MAX_EXTRACT + 50 unique timestamps so the cap is exceeded
    // regardless of the configured value. Stride by 1s, so 600 of them
    // span ten minutes — safely within Date's range.
    const lines = Array.from({ length: MAX_EXTRACT + 50 }, (_, i) => {
      const iso = new Date(Date.UTC(2026, 3, 4, 0, 0, i)).toISOString();
      return `${iso} line ${i.toString()}`;
    }).join("\n");

    const { timestamps, truncated } = extractTimestamps(lines);
    expect(timestamps).toHaveLength(MAX_EXTRACT);
    expect(truncated).toBe(true);
  });

  it("does not flag truncated when under the cap", () => {
    const lines = Array.from(
      { length: 5 },
      (_, i) => `2026-04-04T18:02:${String(i).padStart(2, "0")}.000Z line ${i.toString()}`
    ).join("\n");
    const { timestamps, truncated } = extractTimestamps(lines);
    expect(timestamps).toHaveLength(5);
    expect(truncated).toBe(false);
  });

  it("returns empty result for no timestamps", () => {
    expect(extractTimestamps("no timestamps here").timestamps).toHaveLength(0);
    expect(extractTimestamps("").timestamps).toHaveLength(0);
    expect(extractTimestamps("").truncated).toBe(false);
  });

  it("does not double-match ISO-with-Z as both ISO and bare-log format", () => {
    // Regression: when the log-format regex was relaxed to accept a `T`
    // separator, its substring match (19 chars) of an ISO-with-Z match
    // (20 chars) started colliding with the dedup key. Range-overlap
    // dedup should prevent this.
    const { timestamps } = extractTimestamps("2026-04-04T18:02:31Z");
    expect(timestamps).toHaveLength(1);
    expect(timestamps[0]!.ambiguous).toBe(false);
  });

  it("extracts a mix of formats from one input", () => {
    const input = [
      "2026-04-04T18:02:31Z first",
      "Apr 3, 2026, 3:20 PM calendar entry",
      "2026/04/05 09:15:00 slash format",
      "1712253751 epoch",
    ].join("\n");
    const { timestamps } = extractTimestamps(input);
    expect(timestamps).toHaveLength(4);
    // Results are returned pattern-by-pattern, not in source order.
    const isos = timestamps.map((r) => r.iso).sort();
    expect(isos).toContain("2026-04-04T18:02:31.000Z");
    expect(isos).toContain("2026-04-03T15:20:00.000Z");
    expect(isos).toContain("2026-04-05T09:15:00.000Z");
    expect(isos).toContain("2024-04-04T18:02:31.000Z"); // 1712253751 → 2024-04-04
  });
});
