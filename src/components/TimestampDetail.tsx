import { List } from '@raycast/api';
import { formatRelative, formatUnix } from '../lib/format';
import type { Event, ParsedTimestamp } from '../types';

type TimestampDetailProps =
  | {
      readonly kind: 'parsed';
      readonly parsed: ParsedTimestamp;
      readonly offset: string | null;
    }
  | {
      readonly kind: 'event';
      readonly event: Event;
      readonly offset: string | null;
    };

// Shortcut-prefixed field titles (⌘ adjacent to the first letter, which is the hotkey).
const LABEL_TITLE = '\u2318Label';
const URL_TITLE = '\u2318URL';
const NOTE_TITLE = '\u2318Note';
const EMPTY = '—';

const HINTS_AMBIGUOUS =
  '\u21A9 UTC  \u00B7  \u2318T Local  \u00B7  \u2318\u21E7T Pick zone';
const HINTS_PARSED =
  '\u21A9 Pin  \u00B7  \u2318\u21E7\u21A9 Pin All  \u00B7  \u2318L Pin w/ label';
const HINTS_EVENT = '\u2303\u232B Delete  \u00B7  \u2303\u21E7\u232B Delete All';

export function TimestampDetail(props: TimestampDetailProps) {
  const base = props.kind === 'parsed' ? props.parsed : props.event;
  const unix = formatUnix(base.timestamp);
  const relative = formatRelative(base.timestamp);
  const hints = pickHints(props);

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="UTC" text={base.iso} />
          <List.Item.Detail.Metadata.Label title="Local" text={base.local} />
          <List.Item.Detail.Metadata.Label title="Unix" text={unix} />
          <List.Item.Detail.Metadata.Label title="Relative" text={relative} />
          {props.offset !== null ? (
            <List.Item.Detail.Metadata.Label title="Offset" text={props.offset} />
          ) : null}
          {props.kind === 'event' ? (
            <>
              <List.Item.Detail.Metadata.Separator />
              {props.event.label !== null ? (
                <List.Item.Detail.Metadata.TagList title={LABEL_TITLE}>
                  <List.Item.Detail.Metadata.TagList.Item text={props.event.label} />
                </List.Item.Detail.Metadata.TagList>
              ) : (
                <List.Item.Detail.Metadata.Label title={LABEL_TITLE} text={EMPTY} />
              )}
              {props.event.url !== null ? (
                <List.Item.Detail.Metadata.Link
                  title={URL_TITLE}
                  text={props.event.url}
                  target={props.event.url}
                />
              ) : (
                <List.Item.Detail.Metadata.Label title={URL_TITLE} text={EMPTY} />
              )}
              <List.Item.Detail.Metadata.Label
                title={NOTE_TITLE}
                text={props.event.note || EMPTY}
              />
            </>
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title={hints} text="" />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function pickHints(props: TimestampDetailProps): string {
  if (props.kind === 'event') return HINTS_EVENT;
  return props.parsed.ambiguous ? HINTS_AMBIGUOUS : HINTS_PARSED;
}
