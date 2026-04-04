import type { Event, ParsedTimestamp } from '../types';

/**
 * Pure event-list transforms. Persistence is owned by the component via
 * `useLocalStorage` from `@raycast/utils` — this module deliberately knows
 * nothing about Raycast storage APIs, which makes every helper trivially
 * testable.
 */

export const STORAGE_KEY = 'utc-workbench-events';

type EventPatch = Partial<Pick<Event, 'label' | 'url' | 'note'>>;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a new Event from a parsed timestamp. */
export function createEvent(parsed: ParsedTimestamp, label?: string | null): Event {
  return {
    id: generateId(),
    timestamp: parsed.timestamp,
    iso: parsed.iso,
    local: parsed.local,
    note: parsed.note,
    label: label ?? null,
    url: null,
    ingestedAt: Date.now(),
  };
}

/** Return a new list sorted by UTC timestamp ascending (stable copy). */
export function sortEvents(events: readonly Event[]): readonly Event[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

/** Append one newly-created event to a list. Caller sorts on read. */
export function addEvent(
  events: readonly Event[],
  parsed: ParsedTimestamp,
  label?: string | null
): readonly Event[] {
  return [...events, createEvent(parsed, label)];
}

/** Append many newly-created events in a single update. */
export function addEvents(
  events: readonly Event[],
  timestamps: readonly ParsedTimestamp[],
  label?: string | null
): readonly Event[] {
  return [...events, ...timestamps.map((t) => createEvent(t, label))];
}

/** Return a new list with a single event patched. No-op if id is not found. */
export function updateEvent(
  events: readonly Event[],
  id: string,
  patch: EventPatch
): readonly Event[] {
  return events.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

/** Return a new list with the event removed. */
export function removeEvent(
  events: readonly Event[],
  id: string
): readonly Event[] {
  return events.filter((e) => e.id !== id);
}
