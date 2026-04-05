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
import { showFailureToast, useCachedState } from '@raycast/utils';
import { useState, useEffect, useMemo } from 'react';
import { DateTime } from 'luxon';
import { extractTimestamps } from './lib/parser';
import { reinterpret } from './lib/normalize';
import { extractDate, extractTime, formatDelta } from './lib/format';
import {
  addEvent,
  addEvents,
  removeEvent,
  replaceEventFields,
  sortEvents,
  updateEvent,
} from './lib/store';
import {
  EMPTY_SESSION_STATE,
  SESSIONS_STORAGE_KEY,
  createDraftSession,
  createSession,
  getActiveSession,
  updateActiveSessionEvents,
} from './lib/sessions';
import { useSessionDelete } from './lib/use-session-delete';
import type { Event, ParsedTimestamp } from './types';
import { TextInputForm } from './components/TextInputForm';
import { TimezoneForm } from './components/TimezoneForm';
import { TimestampDetail } from './components/TimestampDetail';
import { ManualEventForm } from './components/ManualEventForm';
import { SessionPicker } from './components/SessionPicker';

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
  // Cache-backed state (vs. LocalStorage-backed) because both this
  // component and `SessionPicker` subscribe to the same key, and only
  // `useCachedState` propagates writes across hook instances via
  // `useSyncExternalStore`. With `useLocalStorage`, a write from the
  // picker would not reach this component's copy until the component
  // unmounted and remounted — the bug that caused new sessions to
  // display stale events from the previously active session.
  const [sessionState, setStoredState] = useCachedState(SESSIONS_STORAGE_KEY, EMPTY_SESSION_STATE);
  const activeSession = getActiveSession(sessionState);

  // Sort invariant enforced on read in one place, sourced from the active
  // session's events (or empty when no session exists yet).
  const events = useMemo(() => sortEvents(activeSession?.events ?? []), [activeSession]);

  // Every event-list mutation goes through this wrapper: the existing
  // store.ts transform (addEvent, removeEvent, etc.) is passed in as a
  // function over the active session's events, and the wrapper handles
  // the session-state bookkeeping. Keeps call sites readable and the
  // session machinery in one place.
  //
  // Lazily creates a draft "Untitled Session" if none exists so a
  // user's first pin (typed paste, manual form, etc.) Just Works
  // rather than silently no-opping. The draft is promoted to a real
  // session (createdAt stamped) in the same commit by
  // `updateActiveSessionEvents`, so the user sees a normal session
  // timestamped at the moment of their first pin — not at mount time.
  // They can rename via ⌘S when convenient.
  //
  // Uses the functional form of `setStoredState` so `current` is read
  // from the Cache's ref rather than from the closed-over `sessionState`
  // at render time. This matters when a mutation handler is invoked
  // from a pushed component after the state has changed (e.g., a
  // delete in the picker) — without the functional form, a stale
  // closure could overwrite the fresh state and "resurrect" deleted
  // sessions or events.
  function mutateEvents(updater: (events: readonly Event[]) => readonly Event[]) {
    setStoredState((current) => {
      const base = current.activeSessionId === null ? createDraftSession(current) : current;
      return updateActiveSessionEvents(base, updater);
    });
  }

  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<readonly ParsedTimestamp[]>([]);
  const [parsedTruncated, setParsedTruncated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Explicit "reference row" for delta calculation. When set, it overrides
  // the default selection-follows behavior so the user can navigate around
  // without losing their anchor point — the core ergonomic need for
  // cross-service latency analysis. When null, selection doubles as the
  // reference (zero-setup for the common case of a quick comparison).
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [now, setNow] = useState(() => DateTime.now().toUTC());

  // Mounts the two-phase session-delete effects and returns a function
  // for this (foregrounded) view's own delete action. Session deletes
  // from pushed views (SessionPicker) are forwarded here via a shared
  // cache key. See `use-session-delete.ts` for the full explanation.
  const deleteSessionSafely = useSessionDelete(sessionState.activeSessionId, setStoredState);

  // The nav title shows an HH:mm clock. Ticking every second would force the
  // parent `<List>` to re-render (and reconcile every row) 60× more often
  // than the display actually changes, so we align the interval to the next
  // wall-clock minute boundary and then tick once per minute from there.
  useEffect(() => {
    function tick() {
      setNow(DateTime.now().toUTC());
    }
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, []);

  const navTitle = useMemo(() => {
    const utcTime = now.toFormat('HH:mm');
    const local = now.toLocal();
    const clock = `UTC ${utcTime}  \u00B7  ${local.toFormat('ZZZZ')} ${local.toFormat('HH:mm')} (${local.toFormat('ZZ')})`;
    const session = activeSession ? activeSession.label : 'No Session';
    return `${clock}  \u00B7  ${session}`;
  }, [now, activeSession]);

  useEffect(() => {
    if (!query.trim()) {
      setParsed([]);
      setParsedTruncated(false);
      return;
    }
    const { timestamps, truncated } = extractTimestamps(query);
    setParsed(timestamps);
    setParsedTruncated(truncated);
  }, [query]);

  function resolveTimezone(index: number, zone: string) {
    setParsed((prev) => prev.map((p, i) => (i === index ? reinterpret(p, zone) : p)));
  }

  function updateParsed(index: number, patch: Partial<ParsedTimestamp>) {
    setParsed((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  // Content-derived IDs for parsed rows so mid-query edits don't relocate
  // selection onto an unrelated timestamp. The per-index suffix is a
  // tiebreaker for the (rare) case where the same timestamp + data appears
  // twice in a single paste. Zipped with the parsed result here so the
  // render loop never has to line up two parallel arrays by index.
  const parsedRows = useMemo(
    () =>
      parsed.map((result, i) => ({
        id: `parsed-${result.timestamp.toString()}-${hashString(result.data)}-${i.toString()}`,
        result,
      })),
    [parsed]
  );

  const timestampById = useMemo(() => {
    const map = new Map<string, number>();
    for (const { id, result } of parsedRows) {
      map.set(id, result.timestamp);
    }
    for (const event of events) {
      map.set(`event-${event.id}`, event.timestamp);
    }
    return map;
  }, [parsedRows, events]);

  // An explicit reference wins over selection; if neither is valid, falls
  // back to null and no deltas are shown anywhere.
  const effectiveReferenceId = referenceId ?? selectedId;
  const referenceTimestamp =
    effectiveReferenceId !== null ? (timestampById.get(effectiveReferenceId) ?? null) : null;

  // If an explicit reference becomes stale (row no longer exists after a
  // query edit or deletion), clear it so the UI doesn't show stale offsets.
  useEffect(() => {
    if (referenceId !== null && !timestampById.has(referenceId)) {
      setReferenceId(null);
    }
  }, [referenceId, timestampById]);

  // Same guard for `selectedId` — keeps downstream delta calculations
  // and reference-row logic consistent after row removal.
  useEffect(() => {
    if (selectedId !== null && !timestampById.has(selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, timestampById]);

  function offsetFrom(timestamp: number, itemId: string): string | null {
    if (referenceTimestamp === null) return null;
    if (itemId === effectiveReferenceId) return null;
    return formatDelta(timestamp - referenceTimestamp);
  }

  function handleSetReference(id: string) {
    setReferenceId(id);
    void showToast({ style: Toast.Style.Success, title: 'Reference set' });
  }

  function handleClearReference() {
    setReferenceId(null);
    void showToast({ style: Toast.Style.Success, title: 'Reference cleared' });
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
      mutateEvents((current) => addEvent(current, result, result.label, result.url));
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
      mutateEvents((current) => addEvents(current, parsed, trimOrNull(label)));
      setQuery('');
      await showToast({
        style: Toast.Style.Success,
        title: `Pinned ${count.toString()} timestamp${count === 1 ? '' : 's'}`,
      });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to pin events' });
    }
  }

  async function handleEditEvent(id: string, parsed: ParsedTimestamp) {
    try {
      mutateEvents((current) => replaceEventFields(current, id, parsed));
      await showToast({ style: Toast.Style.Success, title: 'Event updated' });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update event' });
    }
  }

  async function handleRemove(id: string) {
    try {
      mutateEvents((current) => removeEvent(current, id));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to delete event' });
    }
  }

  async function handleRelabel(id: string, label: string | null) {
    try {
      mutateEvents((current) => updateEvent(current, id, { label }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update label' });
    }
  }

  async function handleSetUrl(id: string, url: string | null) {
    try {
      mutateEvents((current) => updateEvent(current, id, { url }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update URL' });
    }
  }

  // Note: `data` is intentionally not trimmed — unlike label/url it's free-form
  // log context where leading/trailing whitespace can be meaningful (indentation,
  // trailing newlines from multi-line paste).
  async function handleSetData(id: string, data: string) {
    try {
      mutateEvents((current) => updateEvent(current, id, { data }));
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to update data' });
    }
  }

  async function handleCreateSession(label: string) {
    const trimmed = label.trim();
    if (!trimmed) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Session label required',
      });
      return;
    }
    try {
      setStoredState((current) => createSession(current, trimmed));
      await showToast({
        style: Toast.Style.Success,
        title: `Session "${trimmed}" created`,
      });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to create session' });
    }
  }

  async function handleDeleteSession() {
    const currentId = sessionState.activeSessionId;
    if (currentId === null) return;
    const current = sessionState.sessions[currentId];
    if (current === undefined) return;

    const eventCount = current.events.length;
    const confirmed = await confirmAlert({
      title: `Delete "${current.label}"?`,
      message:
        eventCount === 0
          ? 'Delete this empty session?'
          : `Permanently delete ${eventCount.toString()} event${eventCount === 1 ? '' : 's'} in this session.`,
      primaryAction: {
        title: 'Delete Session',
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    try {
      deleteSessionSafely(currentId);
      await showToast({
        style: Toast.Style.Success,
        title: `Session "${current.label}" deleted`,
      });
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to delete session' });
    }
  }

  // Memoized on events because these strings are passed as `content` on
  // CopyToClipboard actions inside every row — without memoization each row's
  // render eagerly rebuilds the whole timeline (O(N²) per paint).
  const timelineMarkdown = useMemo(() => {
    if (events.length === 0) return '';
    const header = '| UTC | Δ | Event | Link |\n| --- | --- | --- | --- |';
    const rows = events.map((e, i) => {
      const prev = events[i - 1];
      const delta = prev ? formatDelta(e.timestamp - prev.timestamp) : '—';
      const labelPrefix = e.label ? `[${e.label}] ` : '';
      // Angle-bracket link form handles URLs containing parens without
      // requiring percent-encoding; pipes in URLs are vanishingly rare but
      // still escaped for table safety.
      const link = e.url ? `[Link](<${e.url.replace(/\|/g, '%7C')}>)` : '';
      return `| ${escapeMdCell(e.iso)} | ${delta} | ${escapeMdCell(labelPrefix + e.data)} | ${link} |`;
    });
    return [header, ...rows].join('\n');
  }, [events]);

  const timelineJson = useMemo(
    () =>
      JSON.stringify(
        events.map((e) => ({
          utc: e.iso,
          label: e.label,
          url: e.url,
          data: e.data || null,
        })),
        null,
        2
      ),
    [events]
  );

  const timelineCsv = useMemo(() => {
    if (events.length === 0) return '';
    const escapeCsvField = (v: string) => {
      if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const header = 'UTC,Delta,Event,Link';
    const rows = events.map((e, i) => {
      const prev = events[i - 1];
      const delta = prev ? formatDelta(e.timestamp - prev.timestamp) : '';
      const labelPrefix = e.label ? `[${e.label}] ` : '';
      return [
        escapeCsvField(e.iso),
        escapeCsvField(delta),
        escapeCsvField(labelPrefix + e.data),
        escapeCsvField(e.url || ''),
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }, [events]);

  const hasParsed = parsed.length > 0;

  // Shared "Session" ActionPanel section — rendered on the top-level List
  // actions AND on every row, so ⌘S reaches the session picker from
  // wherever the user currently has focus. Raycast doesn't inherit
  // top-level actions onto selected rows, so without this the shortcut
  // silently stops working as soon as anything is pinned.
  const sessionSection = (
    <ActionPanel.Section title="Session">
      <Action.Push
        title="Sessions"
        icon={Icon.Folder}
        shortcut={{ modifiers: ['cmd'], key: 's' }}
        target={<SessionPicker />}
      />
      <Action.Push
        title="New Session"
        icon={Icon.PlusCircle}
        shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
        target={
          <TextInputForm
            title="New Session"
            fieldTitle="Label"
            placeholder="e.g., db-outage 2026-04-05"
            onSubmit={handleCreateSession}
          />
        }
      />
    </ActionPanel.Section>
  );

  return (
    <List
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
          {sessionSection}
          {events.length > 0 ? (
            <ActionPanel.Section title="Timeline">
              <Action.CopyToClipboard
                title="Copy Timeline as Markdown"
                content={timelineMarkdown}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
              />
              <Action.CopyToClipboard
                title="Copy Timeline as JSON"
                content={timelineJson}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'j' }}
              />
              <Action.CopyToClipboard
                title="Copy Timeline as CSV"
                content={timelineCsv}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
              />
            </ActionPanel.Section>
          ) : null}
          {activeSession !== null ? (
            <ActionPanel.Section title="Danger">
              <Action
                title="Delete Session"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ['ctrl', 'shift'], key: 'delete' }}
                onAction={() => {
                  void handleDeleteSession();
                }}
              />
            </ActionPanel.Section>
          ) : null}
        </ActionPanel>
      }
    >
      {hasParsed ? (
        <List.Section
          title="Parsed"
          subtitle={
            parsedTruncated
              ? `${parsed.length.toString()} shown — input has more, refine to see the rest`
              : `${parsed.length.toString()} found`
          }
        >
          {parsedRows.map(({ id: itemId, result: r }, i) => {
            const offset = offsetFrom(r.timestamp, itemId);
            // List subtitle never shows the delta — that lives in the
            // detail pane. Here we surface the ambiguity warning or the
            // user's label, whichever is relevant.
            const subtitle = r.ambiguous ? 'No timezone — select one' : r.label;
            return (
              <List.Item
                id={itemId}
                key={itemId}
                icon={r.ambiguous ? Icon.Warning : Icon.MagnifyingGlass}
                title={r.iso}
                {...(subtitle !== null ? { subtitle } : {})}
                detail={
                  <TimestampDetail
                    kind="parsed"
                    parsed={r}
                    offset={offset}
                    isReference={referenceId === itemId}
                  />
                }
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
                    <ActionPanel.Section title="Compare">
                      <Action
                        title="Set as Reference"
                        icon={Icon.BullsEye}
                        shortcut={{ modifiers: ['cmd'], key: 'r' }}
                        onAction={() => {
                          handleSetReference(itemId);
                        }}
                      />
                      {referenceId !== null ? (
                        <Action
                          title="Clear Reference"
                          icon={Icon.XMarkCircle}
                          onAction={handleClearReference}
                        />
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
                      <Action.CopyToClipboard title="Copy UTC" content={r.iso} />
                      <Action.CopyToClipboard title="Copy Local" content={r.local} />
                      {r.url ? <Action.CopyToClipboard title="Copy URL" content={r.url} /> : null}
                    </ActionPanel.Section>
                    <ActionPanel.Section title="New">
                      <Action.Push
                        title="New Manual Event"
                        icon={Icon.PlusCircle}
                        shortcut={{ modifiers: ['cmd'], key: 'n' }}
                        target={<ManualEventForm onSubmit={handlePin} />}
                      />
                    </ActionPanel.Section>
                    {sessionSection}
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
          title={`${group.date} UTC`}
          subtitle={`${group.events.length.toString()} event${group.events.length === 1 ? '' : 's'}`}
        >
          {group.events.map((event) => {
            const itemId = `event-${event.id}`;
            const offset = offsetFrom(event.timestamp, itemId);
            const subtitle = event.label;
            return (
              <List.Item
                id={itemId}
                key={itemId}
                icon={event.label ? Icon.Tag : Icon.Clock}
                title={extractTime(event.iso)}
                {...(subtitle !== null ? { subtitle } : {})}
                detail={
                  <TimestampDetail
                    kind="event"
                    event={event}
                    offset={offset}
                    isReference={referenceId === itemId}
                  />
                }
                actions={
                  <ActionPanel>
                    <ActionPanel.Section title="Event">
                      <Action.Push
                        title="Edit Event"
                        icon={Icon.Pencil}
                        shortcut={{ modifiers: ['cmd'], key: 'e' }}
                        target={
                          <ManualEventForm
                            initialEvent={event}
                            onSubmit={(parsed) => handleEditEvent(event.id, parsed)}
                          />
                        }
                      />
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
                    <ActionPanel.Section title="Compare">
                      <Action
                        title="Set as Reference"
                        icon={Icon.BullsEye}
                        shortcut={{ modifiers: ['cmd'], key: 'r' }}
                        onAction={() => {
                          handleSetReference(itemId);
                        }}
                      />
                      {referenceId !== null ? (
                        <Action
                          title="Clear Reference"
                          icon={Icon.XMarkCircle}
                          onAction={handleClearReference}
                        />
                      ) : null}
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Copy">
                      <Action.CopyToClipboard title="Copy UTC" content={event.iso} />
                      <Action.CopyToClipboard title="Copy Local" content={event.local} />
                      <Action.CopyToClipboard title="Copy Data" content={event.data} />
                      {event.url ? (
                        <Action.CopyToClipboard title="Copy URL" content={event.url} />
                      ) : null}
                      <Action.CopyToClipboard
                        title="Copy Timeline as Markdown"
                        content={timelineMarkdown}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
                      />
                      <Action.CopyToClipboard
                        title="Copy Timeline as JSON"
                        content={timelineJson}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'j' }}
                      />
                      <Action.CopyToClipboard
                        title="Copy Timeline as CSV"
                        content={timelineCsv}
                        shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
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
                    {sessionSection}
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
                        title="Delete Session"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        shortcut={{ modifiers: ['ctrl', 'shift'], key: 'delete' }}
                        onAction={() => {
                          void handleDeleteSession();
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

/**
 * djb2 hash of a string, rendered as base-36. Used only to build stable
 * Raycast list item IDs for parsed rows — not cryptographic.
 */
function hashString(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Escape a cell value for a GitHub-flavored markdown table: pipes become
 * `\|` (otherwise they'd break the column), and any internal newlines become
 * `<br>` since md tables can't span multiple lines natively.
 */
function escapeMdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
