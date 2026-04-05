import { describe, it, expect } from 'vitest';
import {
  addEvent,
  addEvents,
  createEvent,
  removeEvent,
  replaceEventFields,
  sortEvents,
  updateEvent,
} from '../lib/store';
import type { Event, ParsedTimestamp } from '../types';

function parsed(timestamp: number, data = 'raw'): ParsedTimestamp {
  return {
    timestamp,
    iso: new Date(timestamp).toISOString(),
    local: 'irrelevant',
    data,
    ambiguous: false,
    label: null,
    url: null,
  };
}

describe('createEvent', () => {
  it('copies parsed fields and normalizes label', () => {
    const e = createEvent(parsed(1_000, 'line'), 'api-gw');
    expect(e.timestamp).toBe(1_000);
    expect(e.data).toBe('line');
    expect(e.label).toBe('api-gw');
    expect(e.url).toBeNull();
  });

  it('defaults label to null when omitted', () => {
    expect(createEvent(parsed(1_000)).label).toBeNull();
  });

  it('assigns a unique id per call', () => {
    const a = createEvent(parsed(1_000));
    const b = createEvent(parsed(1_000));
    expect(a.id).not.toBe(b.id);
  });
});

describe('sortEvents', () => {
  it('sorts by timestamp ascending without mutating input', () => {
    const input: Event[] = [
      createEvent(parsed(3_000)),
      createEvent(parsed(1_000)),
      createEvent(parsed(2_000)),
    ];
    const sorted = sortEvents(input);
    expect(sorted.map((e) => e.timestamp)).toEqual([1_000, 2_000, 3_000]);
    // Original order preserved.
    expect(input.map((e) => e.timestamp)).toEqual([3_000, 1_000, 2_000]);
  });
});

describe('addEvent / addEvents', () => {
  it('appends a single event', () => {
    const result = addEvent([], parsed(1_000), 'api-gw');
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('api-gw');
  });

  it('appends many events sharing a label', () => {
    const result = addEvents([], [parsed(1_000), parsed(2_000)], 'db');
    expect(result.map((e) => e.label)).toEqual(['db', 'db']);
  });

  it('preserves existing events', () => {
    const existing = [createEvent(parsed(1_000))];
    const result = addEvent(existing, parsed(2_000));
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing[0]);
  });
});

describe('updateEvent', () => {
  it('patches only the matching event', () => {
    const a = createEvent(parsed(1_000));
    const b = createEvent(parsed(2_000));
    const result = updateEvent([a, b], b.id, { label: 'db' });
    expect(result[0]).toBe(a);
    expect(result[1]?.label).toBe('db');
  });

  it('is a no-op when id is unknown', () => {
    const a = createEvent(parsed(1_000));
    const result = updateEvent([a], 'missing', { label: 'x' });
    expect(result).toEqual([a]);
  });

  it('supports multi-field patches', () => {
    const a = createEvent(parsed(1_000));
    const result = updateEvent([a], a.id, { label: 'db', url: 'https://x', data: 'n' });
    expect(result[0]).toMatchObject({ label: 'db', url: 'https://x', data: 'n' });
  });
});

describe('replaceEventFields', () => {
  it('replaces timestamp and metadata while preserving id and ingestedAt', () => {
    const original = createEvent(parsed(1_000, 'old'), 'old-label', 'https://old');
    const next: ParsedTimestamp = {
      timestamp: 5_000,
      iso: '1970-01-01T00:00:05.000Z',
      local: 'irrelevant',
      data: 'new',
      ambiguous: false,
      label: 'new-label',
      url: 'https://new',
    };
    const result = replaceEventFields([original], original.id, next);
    expect(result[0]?.id).toBe(original.id);
    expect(result[0]?.ingestedAt).toBe(original.ingestedAt);
    expect(result[0]?.timestamp).toBe(5_000);
    expect(result[0]?.iso).toBe('1970-01-01T00:00:05.000Z');
    expect(result[0]?.data).toBe('new');
    expect(result[0]?.label).toBe('new-label');
    expect(result[0]?.url).toBe('https://new');
  });

  it('is a no-op when id is unknown', () => {
    const a = createEvent(parsed(1_000));
    const next: ParsedTimestamp = { ...parsed(2_000), label: null, url: null };
    expect(replaceEventFields([a], 'missing', next)).toEqual([a]);
  });
});

describe('removeEvent', () => {
  it('drops the matching event', () => {
    const a = createEvent(parsed(1_000));
    const b = createEvent(parsed(2_000));
    expect(removeEvent([a, b], a.id)).toEqual([b]);
  });

  it('is a no-op when id is unknown', () => {
    const a = createEvent(parsed(1_000));
    expect(removeEvent([a], 'missing')).toEqual([a]);
  });
});
