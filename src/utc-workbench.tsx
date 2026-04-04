import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DateTime } from 'luxon';
import { extractTimestamps } from './lib/parser';
import { reinterpret } from './lib/normalize';
import { formatDelta, formatRelative, formatUnix } from './lib/format';
import {
  loadEvents,
  pinEvent,
  pinEvents,
  removeEvent,
  updateEventLabel,
  updateEventUrl,
  updateEventNote,
  clearEvents,
} from './lib/store';
import type { Event, ParsedTimestamp } from './types';

export default function UTCWorkbench() {
  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<readonly ParsedTimestamp[]>([]);
  const [events, setEvents] = useState<readonly Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  const refresh = useCallback(async () => {
    const loaded = await loadEvents();
    setEvents(loaded);
  }, []);

  useEffect(() => {
    void refresh().then(() => {
      setIsLoading(false);
    });
  }, [refresh]);

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

  const selectedTimestamp = selectedId !== null ? (timestampById.get(selectedId) ?? null) : null;

  function offsetFrom(timestamp: number, itemId: string): string | null {
    if (selectedTimestamp === null) return null;
    if (itemId === selectedId) return null;
    return formatDelta(timestamp - selectedTimestamp);
  }

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
    await pinEvent(result, label);
    await refresh();
    await showToast({ style: Toast.Style.Success, title: 'Pinned to timeline' });
  }

  async function handlePinAll(label?: string) {
    if (parsed.length === 0) return;
    await pinEvents(parsed, label);
    await refresh();
    await showToast({
      style: Toast.Style.Success,
      title: `Pinned ${parsed.length.toString()} timestamp${parsed.length === 1 ? '' : 's'}`,
    });
  }

  async function handleRemove(id: string) {
    await removeEvent(id);
    await refresh();
  }

  async function handleRelabel(id: string, label: string | null) {
    await updateEventLabel(id, label);
    await refresh();
  }

  async function handleSetUrl(id: string, url: string | null) {
    await updateEventUrl(id, url);
    await refresh();
  }

  async function handleSetNote(id: string, note: string) {
    await updateEventNote(id, note);
    await refresh();
  }

  async function handleClear() {
    const confirmed = await confirmAlert({
      title: 'Delete All Events',
      message: 'Permanently delete all pinned events?',
      primaryAction: { title: 'Delete All', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await clearEvents();
    setEvents([]);
    await showToast({ style: Toast.Style.Success, title: 'All events deleted' });
  }

  function copyTimeline() {
    return events
      .map((e, i) => {
        const prev = events[i - 1];
        const delta = prev ? formatDelta(e.timestamp - prev.timestamp) : '---';
        const label = e.label ? `[${e.label}] ` : '';
        return `${e.iso} | ${e.local} | ${delta} | ${label}${e.rawText}`;
      })
      .join('\n');
  }

  function exportTimelineJson() {
    return JSON.stringify(
      events.map((e) => ({
        iso: e.iso,
        label: e.label,
        url: e.url,
        note: e.rawText || null,
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
                detail={<TimestampDetail iso={r.iso} local={r.local} timestamp={r.timestamp} rawText={r.rawText} label={null} url={null} offset={offset} kind="parsed" ambiguous={r.ambiguous} />}
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
                              onSubmit={(zone) => {
                                resolveTimezone(i, zone);
                              }}
                              title={`Timezone for ${extractTime(r.iso)}`}
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
                          <LabelForm
                            onSubmit={(label) => handlePin(r, label)}
                            title={`Label for ${extractTime(r.iso)}`}
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
                              <LabelForm
                                onSubmit={(label) => handlePinAll(label)}
                                title={`Label for ${parsed.length.toString()} timestamps`}
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
        <List.Section key={group.date} title={group.date} subtitle={`${group.events.length.toString()} event${group.events.length === 1 ? '' : 's'}`}>
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
                detail={<TimestampDetail iso={event.iso} local={event.local} timestamp={event.timestamp} rawText={event.rawText} label={event.label} url={event.url} offset={offset} kind="event" />}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section title="Event">
                      <Action.Push
                        title={event.label ? 'Edit Label' : 'Add Label'}
                        icon={Icon.Tag}
                        shortcut={{ modifiers: ['cmd'], key: 'l' }}
                        target={
                          <LabelForm
                            initialLabel={event.label ?? ''}
                            onSubmit={(label) => handleRelabel(event.id, label || null)}
                            title={`Label for ${extractTime(event.iso)}`}
                          />
                        }
                      />
                      <Action.Push
                        title={event.url ? 'Edit URL' : 'Add URL'}
                        icon={Icon.Link}
                        shortcut={{ modifiers: ['cmd'], key: 'u' }}
                        target={
                          <UrlForm
                            initialUrl={event.url ?? ''}
                            onSubmit={(url) => handleSetUrl(event.id, url || null)}
                            title={`URL for ${extractTime(event.iso)}`}
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
                          <NoteForm
                            initialNote={event.rawText}
                            onSubmit={(note) => handleSetNote(event.id, note)}
                            title={`Note for ${extractTime(event.iso)}`}
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
                      <Action.CopyToClipboard title="Copy Note" content={event.rawText} />
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

function LabelForm({
  initialLabel,
  onSubmit,
  title,
}: {
  readonly initialLabel?: string;
  readonly onSubmit: (label: string) => Promise<void> | void;
  readonly title: string;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={async (values: { label: string }) => {
              await onSubmit(values.label);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="label"
        title="Label"
        placeholder="e.g., api-gw, postgres, auth-service"
        defaultValue={initialLabel ?? ''}
      />
    </Form>
  );
}

function UrlForm({
  initialUrl,
  onSubmit,
  title,
}: {
  readonly initialUrl?: string;
  readonly onSubmit: (url: string) => Promise<void> | void;
  readonly title: string;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={async (values: { url: string }) => {
              await onSubmit(values.url);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="url"
        title="URL"
        placeholder="e.g., https://grafana.internal/d/abc123"
        defaultValue={initialUrl ?? ''}
      />
    </Form>
  );
}

function NoteForm({
  initialNote,
  onSubmit,
  title,
}: {
  readonly initialNote?: string;
  readonly onSubmit: (note: string) => Promise<void> | void;
  readonly title: string;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={async (values: { note: string }) => {
              await onSubmit(values.note);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="note"
        title="Note"
        placeholder="Log line, annotation, or any context"
        defaultValue={initialNote ?? ''}
      />
    </Form>
  );
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

function TimezoneForm({
  onSubmit,
  title,
}: {
  readonly onSubmit: (zone: string) => void;
  readonly title: string;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Apply"
            icon={Icon.Check}
            onSubmit={(values: { timezone: string }) => {
              onSubmit(values.timezone);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="timezone" title="Timezone" defaultValue="UTC">
        {COMMON_TIMEZONES.map((tz) => (
          <Form.Dropdown.Item key={tz} value={tz} title={tz} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function TimestampDetail({
  iso,
  local,
  timestamp,
  rawText,
  label,
  url,
  offset,
  kind,
  ambiguous,
}: {
  readonly iso: string;
  readonly local: string;
  readonly timestamp: number;
  readonly rawText: string;
  readonly label: string | null;
  readonly url: string | null;
  readonly offset: string | null;
  readonly kind: 'parsed' | 'event';
  readonly ambiguous?: boolean;
}) {
  const unix = formatUnix(timestamp);
  const relative = formatRelative(timestamp);
  const isEvent = kind === 'event';

  // Shortcut-prefixed field titles (⌘ adjacent to the first letter, which is the hotkey)
  const labelTitle = '\u2318Label';
  const urlTitle = '\u2318URL';
  const noteTitle = '\u2318Note';

  const hints = ambiguous
    ? '\u21A9 UTC  \u00B7  \u2318T Local  \u00B7  \u2318\u21E7T Pick zone'
    : kind === 'parsed'
      ? '\u21A9 Pin  \u00B7  \u2318\u21E7\u21A9 Pin All  \u00B7  \u2318L Pin w/ label'
      : '\u2303\u232B Delete  \u00B7  \u2303\u21E7\u232B Delete All';

  const empty = '—';

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="UTC" text={iso} />
          <List.Item.Detail.Metadata.Label title="Local" text={local} />
          <List.Item.Detail.Metadata.Label title="Unix" text={unix} />
          <List.Item.Detail.Metadata.Label title="Relative" text={relative} />
          {offset !== null ? (
            <List.Item.Detail.Metadata.Label title="Offset" text={offset} />
          ) : null}
          {isEvent ? (
            <>
              <List.Item.Detail.Metadata.Separator />
              {label !== null ? (
                <List.Item.Detail.Metadata.TagList title={labelTitle}>
                  <List.Item.Detail.Metadata.TagList.Item text={label} />
                </List.Item.Detail.Metadata.TagList>
              ) : (
                <List.Item.Detail.Metadata.Label title={labelTitle} text={empty} />
              )}
              {url !== null ? (
                <List.Item.Detail.Metadata.Link title={urlTitle} text={url} target={url} />
              ) : (
                <List.Item.Detail.Metadata.Label title={urlTitle} text={empty} />
              )}
              <List.Item.Detail.Metadata.Label title={noteTitle} text={rawText || empty} />
            </>
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title={hints} text="" />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

/** Extract just the time portion (HH:mm:ss.SSS) from an ISO string. */
function extractTime(iso: string): string {
  const match = /T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z/.exec(iso);
  return match?.[1] ?? iso;
}

/** Extract just the date portion (YYYY-MM-DD) from an ISO string. */
function extractDate(iso: string): string {
  return iso.slice(0, 10);
}

