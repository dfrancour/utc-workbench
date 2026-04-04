export type Event = {
  readonly id: string;
  readonly timestamp: number; // epoch ms (canonical UTC)
  readonly iso: string; // ISO8601 UTC
  readonly local: string; // localized representation
  readonly rawText: string; // full original log line
  readonly label: string | null; // user-assigned source label (e.g., "api-gw", "db")
  readonly url: string | null; // reference URL (e.g., link to log viewer, PR, incident)
  readonly ingestedAt: number;
};

export type ParsedTimestamp = {
  readonly timestamp: number; // epoch ms (assuming UTC if ambiguous)
  readonly iso: string; // ISO8601 UTC
  readonly local: string; // localized representation
  readonly rawText: string; // original matched text or full line
  readonly ambiguous: boolean; // true if no timezone was specified in the source
};
