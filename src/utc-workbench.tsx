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
import { useState, useEffect, useRef, useMemo } from 'react';
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

export default function UTCWorkbench() {
  const {
    value: storedEvents,
    setValue: setStoredEvents,
    removeValue: clearStoredEvents,
    isLoading,
  } = useLocalStorage<readonly Event[]>(STORAGE_KEY, []);

  // The `useLocalStorage` store holds events in insertion order. We sort on
  // read so the invariant ("list is timestamp-ordered") is enforced in a
  // single place, independent of how writes happen.
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

  const utcTime = now.toFormat('HH:mm:ss');
  const localTime = now.toLocal().toFormat('HH:mm:ss');
  const localZone = now.toLocal().toFormat('ZZZZ');
  const navTitle = `UTC ${utcTime}  ·  ${localZone} ${localTime}`;

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

  // Precondition: `events` is sorted by timestamp ascending (sortEvents above
  // guarantees this). Because of that, entries with the same UTC date are
  // contiguous, which lets us group in a single pass.
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

  async function handlePin(result: ParsedTimestamp, label?: string) {
    try {
      await setStoredEvents(addEvent(events, result, trimOrNull(label)));
      await showToast({ style: Toast.Style.Success, title: 'Pinned to timeline' });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to pin event' });
    }
  }

  async function handlePinAll(label?: string) {
    if (parsed.length === 0) return;
    try {
      await setStoredEvents(addEvents(events, parsed, trimOrNull(label)));
      await showToast({
        style: Toast.Style.Success,
        title: `Pinned ${parsed.length.toString()} timestamp${parsed.length === 1 ? '' : 's'}`,
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

  async function handleSetNote(id: string, note: string) {
    try {
      await setStoredEvents(updateEvent(events, id, { note }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update note' });
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

  function copyTimeline() {
    return events
      .map((e, i) => {
        const prev = events[i - 1];
        const delta = prev ? formatDelta(e.timestamp - prev.timestamp) : '---';
        const label = e.label ? `[${e.label}] ` : '';
        return `${e.iso} | ${e.local} | ${delta} | ${label}${e.note}`;
      })
      .join('\n');
  }

  function exportTimelineJson() {
    return JSON.stringify(
      events.map((e) => ({
        iso: e.iso,
        label: e.label,
        url: e.url,
        note: e.note || null,
      })),
      null,
      2
    );
  }

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
      searchBarPlaceholder="Paste or type a timestamp..."
      filtering={false}
      isShowingDetail
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
                title={extractTime(r.iso)}
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
                          shortcut={{ modifiers: ['cmd'], key: 't' }}
                          onAction={() => {
                            resolveTimezone(i, DateTime.local().zoneName);
                          }}
                        />
                        <Action.Push
                          title="Select Timezone"
                          icon={Icon.Globe}
                          shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
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
                      <Action.Push
                        title="Pin with Label"
                        icon={Icon.Tag}
                        shortcut={{ modifiers: ['cmd'], key: 'l' }}
                        target={
                          <TextInputForm
                            title={`Label for ${extractTime(r.iso)}`}
                            fieldTitle="Label"
                            placeholder="e.g., api-gw, postgres, auth-service"
                            onSubmit={(label) => handlePin(r, label)}
                          />
                        }
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
                    <ActionPanel.Section title="Copy">
                      <Action.CopyToClipboard title="Copy ISO" content={r.iso} />
                      <Action.CopyToClipboard title="Copy Local" content={r.local} />
                      <Action.CopyToClipboard title="Copy Unix" content={formatUnix(r.timestamp)} />
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
                            onSubmit={(label) => handleRelabel(event.id, trimOrNull(label))}
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
                            onSubmit={(url) => handleSetUrl(event.id, trimOrNull(url))}
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
                      <Action.Push
                        title="Edit Note"
                        icon={Icon.Pencil}
                        shortcut={{ modifiers: ['cmd'], key: 'n' }}
                        target={
                          <TextInputForm
                            title={`Note for ${extractTime(event.iso)}`}
                            fieldTitle="Note"
                            placeholder="Log line, annotation, or any context"
                            initialValue={event.note}
                            multiline
                            onSubmit={(note) => handleSetNote(event.id, note)}
                          />
                        }
                      />
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
                    <ActionPanel.Section title="Copy">
                      <Action.CopyToClipboard title="Copy ISO" content={event.iso} />
                      <Action.CopyToClipboard title="Copy Note" content={event.note} />
                      <Action.CopyToClipboard
                        title="Copy Timeline"
                        content={copyTimeline()}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
                      />
                      <Action.CopyToClipboard
                        title="Export Timeline as JSON"
                        content={exportTimelineJson()}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'j' }}
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
