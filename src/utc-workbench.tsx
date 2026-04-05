import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  List,
  showToast,
  Toast,
} from '@raycast/api';
import { showFailureToast, useLocalStorage } from '@raycast/utils';
import { useState, useEffect, useMemo, useRef } from 'react';
import { DateTime } from 'luxon';
import { extractTimestamps } from './lib/parser';
import { reinterpret } from './lib/normalize';
import {
  extractDate,
  extractTime,
  formatDelta,
  formatUnix,
} from './lib/format';
import {
  STORAGE_KEY,
  addEvent,
  addEvents,
  removeEvent,
  sortEvents,
  updateEvent,
} from './lib/store';
import type { Event, ParsedTimestamp } from './types';
import { TextInputForm } from './components/TextInputForm';
import { TimezoneForm } from './components/TimezoneForm';
import { TimestampDetail } from './components/TimestampDetail';
import { ManualEventForm } from './components/ManualEventForm';

/**
 * Unified timestamp scratchpad + curated timeline.
 *
 * The single search bar is the parse/add input. When the user types or
 * pastes, matches appear in a "Parsed" section above the curated timeline,
 * with actions to pin them. Curated events live below, grouped by UTC date.
 *
 * This tool does not offer filtering — Raycast's `List` always renders a
 * searchbar and always binds Enter to the focused ActionPanel, so a filter
 * role would collide semantically with the parse role. Users curate rather
 * than filter.
 */
export default function UTCWorkbench() {
  const {
    value: storedEvents,
    setValue: setStoredEvents,
    removeValue: clearStoredEvents,
    isLoading,
  } = useLocalStorage<readonly Event[]>(STORAGE_KEY, []);

  // Sort invariant enforced on read in one place.
  const events = useMemo(() => sortEvents(storedEvents ?? []), [storedEvents]);

  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<readonly ParsedTimestamp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => DateTime.now().toUTC());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setNow(DateTime.now().toUTC());
    }, 1000);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, []);

  const navTitle = useMemo(() => {
    const utcTime = now.toFormat('HH:mm:ss');
    const local = now.toLocal();
    return `UTC ${utcTime}  \u00B7  ${local.toFormat('ZZZZ')} ${local.toFormat('HH:mm:ss')} (${local.toFormat('ZZ')})`;
  }, [now]);

  useEffect(() => {
    if (!query.trim()) {
      setParsed([]);
      return;
    }
    setParsed(extractTimestamps(query));
  }, [query]);

  function resolveTimezone(index: number, zone: string) {
    setParsed((prev) =>
      prev.map((p, i) => (i === index ? reinterpret(p, zone) : p))
    );
  }

  function updateParsed(index: number, patch: Partial<ParsedTimestamp>) {
    setParsed((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  const timestampById = useMemo(() => {
    const map = new Map<string, number>();
    parsed.forEach((r, i) => {
      map.set(`parsed-${i.toString()}`, r.timestamp);
    });
    events.forEach((e) => {
      map.set(`event-${e.id}`, e.timestamp);
    });
    return map;
  }, [parsed, events]);

  const selectedTimestamp =
    selectedId !== null ? (timestampById.get(selectedId) ?? null) : null;

  function offsetFrom(timestamp: number, itemId: string): string | null {
    if (selectedTimestamp === null) return null;
    if (itemId === selectedId) return null;
    return formatDelta(timestamp - selectedTimestamp);
  }

  // Precondition: `events` is sorted by timestamp ascending, so same-date
  // entries are contiguous and can be grouped in a single pass.
  const eventsByDate = useMemo(() => {
    const groups: { date: string; events: Event[] }[] = [];
    let currentDate = '';
    let currentGroup: Event[] = [];

    for (const event of events) {
      const date = extractDate(event.iso);
      if (date !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, events: currentGroup });
        }
        currentDate = date;
        currentGroup = [event];
      } else {
        currentGroup.push(event);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, events: currentGroup });
    }

    return groups;
  }, [events]);

  async function handlePin(result: ParsedTimestamp) {
    try {
      await setStoredEvents(addEvent(events, result, result.label, result.url));
      setQuery('');
      await showToast({ style: Toast.Style.Success, title: 'Pinned to timeline' });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to pin event' });
    }
  }

  async function handlePinAll(label?: string) {
    if (parsed.length === 0) return;
    const count = parsed.length;
    try {
      await setStoredEvents(addEvents(events, parsed, trimOrNull(label)));
      setQuery('');
      await showToast({
        style: Toast.Style.Success,
        title: `Pinned ${count.toString()} timestamp${count === 1 ? '' : 's'}`,
      });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to pin events' });
    }
  }

  async function handleRemove(id: string) {
    try {
      await setStoredEvents(removeEvent(events, id));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to delete event' });
    }
  }

  async function handleRelabel(id: string, label: string | null) {
    try {
      await setStoredEvents(updateEvent(events, id, { label }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update label' });
    }
  }

  async function handleSetUrl(id: string, url: string | null) {
    try {
      await setStoredEvents(updateEvent(events, id, { url }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update URL' });
    }
  }

  // Note: `data` is intentionally not trimmed — unlike label/url it's free-form
  // log context where leading/trailing whitespace can be meaningful (indentation,
  // trailing newlines from multi-line paste).
  async function handleSetData(id: string, data: string) {
    try {
      await setStoredEvents(updateEvent(events, id, { data }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update data' });
    }
  }

  async function handleClear() {
    const confirmed = await confirmAlert({
      title: 'Delete All Events',
      message: 'Permanently delete all pinned events?',
      primaryAction: { title: 'Delete All', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await clearStoredEvents();
      await showToast({ style: Toast.Style.Success, title: 'All events deleted' });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to clear events' });
    }
  }

  // Memoized on events because these strings are passed as `content` on
  // CopyToClipboard actions inside every row — without memoization each row's
  // render eagerly rebuilds the whole timeline (O(N²) per paint).
  const timelineText = useMemo(
    () =>
      events
        .map((e, i) => {
          const prev = events[i - 1];
          const delta = prev ? formatDelta(e.timestamp - prev.timestamp) : '---';
          const label = e.label ? `[${e.label}] ` : '';
          return `${e.iso} | ${e.local} | ${delta} | ${label}${e.data}`;
        })
        .join('\n'),
    [events]
  );

  const timelineJson = useMemo(
    () =>
      JSON.stringify(
        events.map((e) => ({
          iso: e.iso,
          label: e.label,
          url: e.url,
          data: e.data || null,
        })),
        null,
        2
      ),
    [events]
  );

  const hasParsed = parsed.length > 0;

  return (
    <List
      isLoading={isLoading}
      navigationTitle={navTitle}
      searchText={query}
      onSearchTextChange={setQuery}
      onSelectionChange={(id) => {
        setSelectedId(id ?? null);
      }}
      searchBarPlaceholder="Paste timestamped logs or manually enter with ⌘N"
      filtering={false}
      isShowingDetail
      actions={
        <ActionPanel>
          <Action.Push
            title="New Manual Event"
            icon={Icon.PlusCircle}
            shortcut={{ modifiers: ['cmd'], key: 'n' }}
            target={<ManualEventForm onSubmit={handlePin} />}
          />
          {events.length > 0 ? (
            <ActionPanel.Section title="Timeline">
              <Action.CopyToClipboard
                title="Copy Timeline"
                content={timelineText}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
              />
              <Action.CopyToClipboard
                title="Export Timeline as JSON"
                content={timelineJson}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'j' }}
              />
            </ActionPanel.Section>
          ) : null}
        </ActionPanel>
      }
    >
      {hasParsed ? (
        <List.Section title="Parsed" subtitle={`${parsed.length.toString()} found`}>
          {parsed.map((r, i) => {
            const itemId = `parsed-${i.toString()}`;
            const offset = offsetFrom(r.timestamp, itemId);
            const subtitle = r.ambiguous ? 'No timezone — select one' : offset;
            return (
              <List.Item
                id={itemId}
                key={itemId}
                icon={r.ambiguous ? Icon.Warning : Icon.MagnifyingGlass}
                title={r.iso}
                {...(subtitle !== null ? { subtitle } : {})}
                detail={<TimestampDetail kind="parsed" parsed={r} offset={offset} />}
                actions={
                  <ActionPanel>
                    {r.ambiguous ? (
                      <ActionPanel.Section title="Timezone">
                        <Action
                          title="Interpret as UTC"
                          icon={Icon.Globe}
                          onAction={() => {
                            resolveTimezone(i, 'utc');
                          }}
                        />
                        <Action
                          title="Interpret as Local"
                          icon={Icon.Clock}
                          shortcut={{ modifiers: ['cmd'], key: 'l' }}
                          onAction={() => {
                            resolveTimezone(i, DateTime.local().zoneName);
                          }}
                        />
                        <Action.Push
                          title="Select Timezone"
                          icon={Icon.Globe}
                          shortcut={{ modifiers: ['cmd'], key: 't' }}
                          target={
                            <TimezoneForm
                              title={`Timezone for ${extractTime(r.iso)}`}
                              onSubmit={(zone) => {
                                resolveTimezone(i, zone);
                              }}
                            />
                          }
                        />
                      </ActionPanel.Section>
                    ) : null}
                    <ActionPanel.Section title="Pin">
                      <Action
                        title="Pin to Timeline"
                        icon={Icon.Pin}
                        onAction={() => {
                          void handlePin(r);
                        }}
                      />
                      {parsed.length > 1 ? (
                        <>
                          <Action
                            title="Pin All"
                            icon={Icon.PlusCircle}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
                            onAction={() => {
                              void handlePinAll();
                            }}
                          />
                          <Action.Push
                            title="Pin All with Label"
                            icon={Icon.Tag}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
                            target={
                              <TextInputForm
                                title={`Label for ${parsed.length.toString()} timestamps`}
                                fieldTitle="Label"
                                placeholder="e.g., api-gw, postgres, auth-service"
                                onSubmit={(label) => handlePinAll(label)}
                              />
                            }
                          />
                        </>
                      ) : null}
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Metadata">
                      <Action.Push
                        title={r.label ? 'Edit Label' : 'Add Label'}
                        icon={Icon.Tag}
                        shortcut={{ modifiers: ['cmd'], key: 'l' }}
                        target={
                          <TextInputForm
                            title={`Label for ${extractTime(r.iso)}`}
                            fieldTitle="Label"
                            placeholder="e.g., api-gw, postgres, auth-service"
                            initialValue={r.label ?? ''}
                            onSubmit={(label) => {
                              updateParsed(i, { label: trimOrNull(label) });
                            }}
                          />
                        }
                      />
                      <Action.Push
                        title={r.url ? 'Edit URL' : 'Add URL'}
                        icon={Icon.Link}
                        shortcut={{ modifiers: ['cmd'], key: 'u' }}
                        target={
                          <TextInputForm
                            title={`URL for ${extractTime(r.iso)}`}
                            fieldTitle="URL"
                            placeholder="e.g., https://grafana.internal/d/abc123"
                            initialValue={r.url ?? ''}
                            onSubmit={(url) => {
                              updateParsed(i, { url: trimOrNull(url) });
                            }}
                          />
                        }
                      />
                      <Action.Push
                        title="Edit Data"
                        icon={Icon.Pencil}
                        shortcut={{ modifiers: ['cmd'], key: 'd' }}
                        target={
                          <TextInputForm
                            title={`Data for ${extractTime(r.iso)}`}
                            fieldTitle="Data"
                            placeholder="Log line, annotation, or any context"
                            initialValue={r.data}
                            multiline
                            onSubmit={(data) => {
                              updateParsed(i, { data });
                            }}
                          />
                        }
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Copy">
                      <Action.CopyToClipboard title="Copy ISO" content={r.iso} />
                      <Action.CopyToClipboard title="Copy Local" content={r.local} />
                      <Action.CopyToClipboard
                        title="Copy Unix"
                        content={formatUnix(r.timestamp)}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section title="New">
                      <Action.Push
                        title="New Manual Event"
                        icon={Icon.PlusCircle}
                        shortcut={{ modifiers: ['cmd'], key: 'n' }}
                        target={<ManualEventForm onSubmit={handlePin} />}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : null}

      {eventsByDate.map((group) => (
        <List.Section
          key={group.date}
          title={group.date}
          subtitle={`${group.events.length.toString()} event${group.events.length === 1 ? '' : 's'}`}
        >
          {group.events.map((event) => {
            const itemId = `event-${event.id}`;
            const offset = offsetFrom(event.timestamp, itemId);
            const subtitle = offset ?? event.label;
            return (
              <List.Item
                id={itemId}
                key={itemId}
                icon={event.label ? Icon.Tag : Icon.Clock}
                title={extractTime(event.iso)}
                {...(subtitle !== null ? { subtitle } : {})}
                detail={<TimestampDetail kind="event" event={event} offset={offset} />}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section title="Event">
                      <Action.Push
                        title={event.label ? 'Edit Label' : 'Add Label'}
                        icon={Icon.Tag}
                        shortcut={{ modifiers: ['cmd'], key: 'l' }}
                        target={
                          <TextInputForm
                            title={`Label for ${extractTime(event.iso)}`}
                            fieldTitle="Label"
                            placeholder="e.g., api-gw, postgres, auth-service"
                            initialValue={event.label ?? ''}
                            onSubmit={(label) =>
                              handleRelabel(event.id, trimOrNull(label))
                            }
                          />
                        }
                      />
                      <Action.Push
                        title={event.url ? 'Edit URL' : 'Add URL'}
                        icon={Icon.Link}
                        shortcut={{ modifiers: ['cmd'], key: 'u' }}
                        target={
                          <TextInputForm
                            title={`URL for ${extractTime(event.iso)}`}
                            fieldTitle="URL"
                            placeholder="e.g., https://grafana.internal/d/abc123"
                            initialValue={event.url ?? ''}
                            onSubmit={(url) =>
                              handleSetUrl(event.id, trimOrNull(url))
                            }
                          />
                        }
                      />
                      <Action.Push
                        title="Edit Data"
                        icon={Icon.Pencil}
                        shortcut={{ modifiers: ['cmd'], key: 'd' }}
                        target={
                          <TextInputForm
                            title={`Data for ${extractTime(event.iso)}`}
                            fieldTitle="Data"
                            placeholder="Log line, annotation, or any context"
                            initialValue={event.data}
                            multiline
                            onSubmit={(data) => handleSetData(event.id, data)}
                          />
                        }
                      />
                      {event.url ? (
                        <Action.OpenInBrowser
                          title="Open URL"
                          url={event.url}
                          shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
                        />
                      ) : null}
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Copy">
                      <Action.CopyToClipboard title="Copy ISO" content={event.iso} />
                      <Action.CopyToClipboard title="Copy Data" content={event.data} />
                      <Action.CopyToClipboard
                        title="Copy Timeline"
                        content={timelineText}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
                      />
                      <Action.CopyToClipboard
                        title="Export Timeline as JSON"
                        content={timelineJson}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'j' }}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section title="New">
                      <Action.Push
                        title="New Manual Event"
                        icon={Icon.PlusCircle}
                        shortcut={{ modifiers: ['cmd'], key: 'n' }}
                        target={<ManualEventForm onSubmit={handlePin} />}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Danger">
                      <Action
                        title="Delete Event"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        shortcut={{ modifiers: ['ctrl'], key: 'delete' }}
                        onAction={() => {
                          void handleRemove(event.id);
                        }}
                      />
                      <Action
                        title="Delete All Events"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        shortcut={{ modifiers: ['ctrl', 'shift'], key: 'delete' }}
                        onAction={() => {
                          void handleClear();
                        }}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}

/** Trim a form-input string; return null for empty/whitespace-only values. */
function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
