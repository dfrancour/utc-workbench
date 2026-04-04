import { Action, ActionPanel, Form, Icon, useNavigation } from '@raycast/api';

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

type TimezoneFormProps = {
  readonly title: string;
  readonly onSubmit: (zone: string) => void;
};

export function TimezoneForm({ title, onSubmit }: TimezoneFormProps) {
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
