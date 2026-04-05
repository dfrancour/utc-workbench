export type Event = {
  readonly id: string;
  readonly timestamp: number; // epoch ms (canonical UTC)
  readonly iso: string; // ISO8601 UTC
  readonly local: string; // localized representation
  readonly data: string; // free-form context (initially the source log line; editable)
  readonly label: string | null; // user-assigned source label (e.g., "api-gw", "db")
  readonly url: string | null; // reference URL (e.g., link to log viewer, PR, incident)
  readonly ingestedAt: number;
};

export type ParsedTimestamp = {
  // Epoch ms. For ambiguous inputs this is a tentative value assuming UTC;
  // once `reinterpret` has run the value is authoritative and `ambiguous`
  // flips to false.
  readonly timestamp: number;
  readonly iso: string; // ISO8601 UTC
  readonly local: string; // localized representation
  readonly data: string; // source line the timestamp was extracted from
  readonly ambiguous: boolean; // true if no timezone was specified in the source
  readonly label: string | null; // user-assigned label, editable before pinning
  readonly url: string | null; // user-assigned URL, editable before pinning
};
