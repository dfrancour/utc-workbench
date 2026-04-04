# Product Specification

## Name

**UTC Workbench**

### Tagline

*Timestamp interpretation and timeline reconstruction for developer workflows*

---

# 1. Product Definition

## Core Function

**UTC Workbench** is a Raycast extension for:

* Interpreting timestamps across formats (ISO8601, epoch, log formats)
* Normalizing timestamps into a canonical UTC representation
* Reconstructing event timelines from disparate log sources

## Target User

* Developers
* SREs
* Infra engineers
* Anyone debugging distributed systems

---

# 2. Core Principles

1. **UTC-first, always**

   * Canonical ISO8601 UTC timestamp is the primary representation
   * No lossy formatting

2. **Precision over friendliness**

   * Exact timestamps precede humanized views

3. **Clipboard-driven workflows**

   * Optimized for logs, not manual entry

4. **Context preservation**

   * Full log lines retained

5. **Incremental timeline construction**

   * Timeline is built via “pinning,” not pre-loaded datasets

---

# 3. Command Architecture (Raycast)

## 3.1 `Interpret Timestamp`

### Purpose

Inspect a single timestamp or input string

### Input

* Manual entry OR clipboard fallback

### Behavior

* Parse for timestamps
* If one → show detailed interpretation
* If multiple → list parsed candidates (no auto-pin)

### Output (single result)

```text
2026-04-04T18:02:31.123Z
2026-04-04 11:02:31.123 PDT
Unix: 1712253751.123
Relative: 2m 14s ago
```

### Actions

* Copy ISO (default)
* Copy local
* Copy Unix
* Pin entry

---

## 3.2 `Interpret Clipboard`

### Purpose

Fast ingestion of logs

### Behavior

* Read clipboard
* Extract **all timestamps**
* For each timestamp:

  * Normalize
  * Create event
  * Append to timeline

### Output

* Toast: “Added N timestamps to timeline”
* Optional preview list

### Key Design Choice

* **Batch-first ingestion**
* No confirmation step

---

## 3.3 `Pinned Timeline`

### Purpose

View reconstructed event sequence

### View

Raycast `List`, sorted by UTC timestamp

### Entry format

```text
2026-04-04T18:02:31.123Z | 2026-04-04 11:02:31.123 PDT | +2.4s | ERROR retry failed at ...
```

### Fields

* ISO8601 UTC (primary)
* Local time (secondary)
* Delta from previous
* Full original text

### Actions

* Remove entry
* Clear all
* Copy timeline

---

# 4. Technical Stack

## Core Stack

* **TypeScript**
* **React (Raycast UI primitives)**
* **Node.js 22+ runtime**
* **npm**

## Raycast APIs

* `List`, `Detail`, `Form`, `ActionPanel`
* `Clipboard`
* `LocalStorage`
* `showToast`

---

## Libraries

### Primary time library: **Luxon**

Rationale:

* Strong ISO8601 handling
* Explicit timezone control
* Good developer ergonomics
* Reliable UTC ↔ local transformations

### Supporting utilities

* Lightweight regex-based parsing layer (custom)
* Optional: `date-fns` only if needed for edge parsing (not primary)

---

# 5. Architecture

## File Structure

```text
src/
  interpret-timestamp.tsx
  interpret-clipboard.tsx
  pinned-timeline.tsx

  lib/
    parser.ts
    normalize.ts
    format.ts
    store.ts

  types.ts
```

---

## 5.1 Data Model

```ts
type Event = {
  id: string
  timestamp: number        // epoch ms (canonical UTC)
  iso: string              // ISO8601 UTC
  local: string            // localized representation
  rawText: string          // full original log line
  ingestedAt: number
}
```

---

## 5.2 Storage

* MVP: Raycast `LocalStorage`
* Key: `"utc-workbench-events"`
* JSON array of `Event`

---

# 6. Parsing System

## 6.1 Strategy

### Clipboard ingestion

* **Aggressive extraction**
* Extract ALL timestamps from input
* Each match → independent event

---

## 6.2 Supported Formats (MVP)

* ISO8601 (strict + relaxed)
* Unix epoch (seconds + milliseconds)
* Common log formats:

  * `YYYY-MM-DD HH:mm:ss`
  * RFC3339 variants

---

## 6.3 Context Handling

* Preserve **full source text**
* Timestamp is not stripped or rewritten

---

## 6.4 Ambiguous Timezones

### Strategy: **Default + override**

* Default assumption: **UTC**
* If no timezone present:

  * parse as UTC
  * (future) mark as assumed

Future:

* Toggle reinterpretation (local / specific zone)

---

# 7. Timeline Mechanics

## 7.1 Ordering

* Always sorted by `timestamp` (UTC)
* Never by ingestion order

---

## 7.2 Delta Calculation

```ts
delta = current.timestamp - previous.timestamp
```

Display:

* ms / s / min (auto-scaled)

---

## 7.3 Deduplication

* **No deduplication (MVP)**
  Rationale: identical timestamps can represent different events

---

# 8. UX Details

## 8.1 List Rendering

Each `List.Item`:

* **Title:** ISO8601 UTC
* **Subtitle:** local time + delta
* **Accessories:** relative time
* **Detail view:** full raw log line

---

## 8.2 Feedback

* Clipboard ingestion → toast:

  * “Added N timestamps to timeline”

---

## 8.3 Performance Constraints

* Parsing: <50ms typical
* Max timestamps per ingestion: ~50 (guardrail)
* Avoid expensive regex patterns

---

# 9. Non-Goals

* Meeting scheduling
* Calendar integrations
* Visual timeline graphs
* Continuous monitoring
* Rich multi-timezone dashboards

---

# 10. MVP Checklist

* [ ] ISO8601 + epoch parsing
* [ ] Multi-extract clipboard ingestion
* [ ] Single timestamp interpretation UI
* [ ] Timeline list view
* [ ] Delta calculation
* [ ] Full text preservation
* [ ] LocalStorage persistence
* [ ] Copy actions
* [ ] Error handling (no timestamp found)

---

# 11. Positioning

UTC Workbench is not a timezone converter.

> It is a **timestamp normalization and temporal debugging tool** embedded in Raycast.
