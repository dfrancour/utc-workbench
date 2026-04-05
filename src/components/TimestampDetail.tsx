import { Color, List } from '@raycast/api';
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
const DATA_TITLE = '\u2318Data';
const EMPTY = '—';

const HINTS_PARSED =
  '\u21A9 Pin  \u00B7  \u2318L Label  \u00B7  \u2318U URL  \u00B7  \u2318D Data';
const HINTS_EVENT = '\u2303\u232B Delete  \u00B7  \u2303\u21E7\u232B Delete All';

export function TimestampDetail(props: TimestampDetailProps) {
  const base = props.kind === 'parsed' ? props.parsed : props.event;
  const unix = formatUnix(base.timestamp);
  const relative = formatRelative(base.timestamp);
  const ambiguous = props.kind === 'parsed' && props.parsed.ambiguous;

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          {ambiguous ? (
            <>
              <List.Item.Detail.Metadata.TagList title="Timezone">
                <List.Item.Detail.Metadata.TagList.Item
                  text="Required — select a zone"
                  color={Color.Orange}
                />
              </List.Item.Detail.Metadata.TagList>
              <List.Item.Detail.Metadata.Label
                title="Interpret as"
                text="↩ UTC      ⌘L Local      ⌘T Pick zone"
              />
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Label
                title="UTC"
                text={`${base.iso}  (tentative)`}
              />
              <List.Item.Detail.Metadata.Label
                title="Local"
                text={`${base.local}  (tentative)`}
              />
            </>
          ) : (
            <>
              <List.Item.Detail.Metadata.Label title="UTC" text={base.iso} />
              <List.Item.Detail.Metadata.Label title="Local" text={base.local} />
              <List.Item.Detail.Metadata.Label title="Unix" text={unix} />
              <List.Item.Detail.Metadata.Label title="Relative" text={relative} />
              {props.offset !== null ? (
                <List.Item.Detail.Metadata.Label title="Offset" text={props.offset} />
              ) : null}
            </>
          )}
          <List.Item.Detail.Metadata.Separator />
          {base.label !== null ? (
            <List.Item.Detail.Metadata.TagList title={LABEL_TITLE}>
              <List.Item.Detail.Metadata.TagList.Item text={base.label} />
            </List.Item.Detail.Metadata.TagList>
          ) : (
            <List.Item.Detail.Metadata.Label title={LABEL_TITLE} text={EMPTY} />
          )}
          {base.url !== null ? (
            <List.Item.Detail.Metadata.Link
              title={URL_TITLE}
              text={base.url}
              target={base.url}
            />
          ) : (
            <List.Item.Detail.Metadata.Label title={URL_TITLE} text={EMPTY} />
          )}
          <List.Item.Detail.Metadata.Label
            title={DATA_TITLE}
            text={base.data || EMPTY}
          />
          {!ambiguous ? (
            <>
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Label
                title={props.kind === 'event' ? HINTS_EVENT : HINTS_PARSED}
                text=""
              />
            </>
          ) : null}
        </List.Item.Detail.Metadata>
      }
    />
  );
}
