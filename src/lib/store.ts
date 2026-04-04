import { LocalStorage } from '@raycast/api';
import type { Event } from '../types';
import type { ParsedTimestamp } from '../types';

const STORAGE_KEY = 'utc-workbench-events';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Load all pinned events from storage, sorted by timestamp (UTC).
 */
export async function loadEvents(): Promise<readonly Event[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];

  return (parsed as Event[]).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Save events to storage.
 */
async function saveEvents(events: readonly Event[]): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

/**
 * Pin a parsed timestamp to the timeline.
 */
export async function pinEvent(parsed: ParsedTimestamp, label?: string): Promise<Event> {
  const events = await loadEvents();
  const event: Event = {
    id: generateId(),
    timestamp: parsed.timestamp,
    iso: parsed.iso,
    local: parsed.local,
    rawText: parsed.rawText,
    label: label?.trim() || null,
    url: null,
    ingestedAt: Date.now(),
  };

  await saveEvents([...events, event]);
  return event;
}

/**
 * Pin multiple parsed timestamps to the timeline.
 */
export async function pinEvents(timestamps: readonly ParsedTimestamp[], label?: string): Promise<readonly Event[]> {
  const existing = await loadEvents();
  const now = Date.now();
  const resolvedLabel = label?.trim() || null;

  const newEvents: Event[] = timestamps.map((parsed, i) => ({
    id: generateId() + i.toString(),
    timestamp: parsed.timestamp,
    iso: parsed.iso,
    local: parsed.local,
    rawText: parsed.rawText,
    label: resolvedLabel,
    url: null,
    ingestedAt: now,
  }));

  await saveEvents([...existing, ...newEvents]);
  return newEvents;
}

/**
 * Update the label on an existing event.
 */
export async function updateEventLabel(id: string, label: string | null): Promise<void> {
  const events = await loadEvents();
  const updated = events.map((e) => (e.id === id ? { ...e, label: label?.trim() || null } : e));
  await saveEvents(updated);
}

/**
 * Update the URL on an existing event.
 */
export async function updateEventUrl(id: string, url: string | null): Promise<void> {
  const events = await loadEvents();
  const updated = events.map((e) => (e.id === id ? { ...e, url: url?.trim() || null } : e));
  await saveEvents(updated);
}

/**
 * Update the note (rawText) on an existing event.
 */
export async function updateEventNote(id: string, note: string): Promise<void> {
  const events = await loadEvents();
  const updated = events.map((e) => (e.id === id ? { ...e, rawText: note } : e));
  await saveEvents(updated);
}

/**
 * Remove a single event by ID.
 */
export async function removeEvent(id: string): Promise<void> {
  const events = await loadEvents();
  await saveEvents(events.filter((e) => e.id !== id));
}

/**
 * Clear all events.
 */
export async function clearEvents(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
