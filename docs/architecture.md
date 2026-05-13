# Mini Grid SCADA Architecture

## 1. Goal

Mini Grid SCADA is a local demonstration platform for low-voltage grid monitoring. It combines:

- simulated telemetry for a transformer and four feeders
- alarm evaluation and event logging
- conservative breaker command handling with interlocks
- replay and incident review
- an operator-focused dashboard for live supervision

It is a portfolio/demo system only. It must never be connected to real electrical equipment.

## 2. Design Principles

1. Backend is the source of truth.
   Alarm state, interlocks, replay history, and command outcomes are decided in the backend, not in the UI.

2. The simulator is replaceable.
   The current simulator runs in-process, but the telemetry shape is designed so it can later be fed from MQTT without rewriting the alarm or dashboard layers.

3. Topology drives the UI.
   The single-line diagram is a view of assets and edges, not a hardcoded sketch detached from the model.

4. Switching is conservative by default.
   All breaker commands require validation, logging, and explicit impact handling.

5. Fast feedback matters.
   The system should feel responsive even when live telemetry, trends, replay, and simulator controls are all active.

## 3. Runtime Architecture

```mermaid
flowchart LR
    Sim["Python simulator"] --> Ingress["Telemetry ingress"]
    Ingress --> State["Telemetry + state service"]
    State --> Alarm["Alarm engine"]
    State --> Event["Event service"]
    State --> Trends["Trend history"]
    Alarm --> Event
    Event --> API["FastAPI REST + WebSocket"]
    Trends --> API
    API --> UI["React + Vite dashboard"]
    UI --> API
    API --> Cmd["Command + interlock service"]
    Cmd --> Sim
```

## 4. Main Components

### Backend

The backend owns:

- topology and asset metadata
- latest station snapshot
- alarm lifecycle
- event and command audit trail
- trend aggregation
- replay history
- station and feeder breaker command handling

### Frontend

The frontend focuses on:

- rendering the live operator view
- object selection and drilldown
- trend inspection
- replay navigation
- simulator interaction
- report export initiation

### Simulator

The simulator generates:

- continuous normal profiles
- timed operating overlays
- explicit fault scenarios
- derived feeder and transformer values

It currently runs as a local Python service loop started by the backend.

## 5. Topology Model

The station is modeled explicitly:

- `NST-001` station root
- `BRK-IN` inlet breaker
- `T1` transformer
- `LV-BRK` low-voltage station breaker
- `BUS-01` 0.4 kV busbar
- `F1-F4` outgoing feeders

This allows the UI and command layer to reason about:

- supply path to any object
- downstream customer impact
- feeder-vs-station switching consequences
- energized and de-energized route visualization

## 6. Snapshot Model

Each live snapshot contains:

- station metadata and timestamp
- transformer telemetry
- station breaker telemetry
- feeder telemetry
- derived metrics such as utilization, phase imbalance, voltage deviation, and affected customers

Trend payloads are separated from the main snapshot so the dashboard can stay compact while still supporting richer chart windows.

## 7. Simulation Model

### Normal Profiles

Current baseline profiles:

- `weekday`
- `winter_day`
- `weekend`
- `overcast`

These continuously update load, reactive power, solar contribution, and load balance.

### Timed Events

Current timed overlays include:

- school start
- lunch break
- EV rush
- cloud front over solar
- evening peak
- heat pump activity

### Fault Scenarios

Current scenario library includes:

- EV peak
- phase imbalance
- communication loss
- breaker trip
- high solar

## 8. Commands and Interlocks

### Feeder Breakers

Feeder switching already supports:

- open with operator reason and impact confirmation
- close with blocking on active faults, degraded telemetry, or unacknowledged critical alarms
- trip-latch behavior for measured overload

### Station Breakers

`BRK-IN` and `LV-BRK` are now modeled as first-class controllable objects.

They influence:

- transformer energization
- busbar availability
- downstream feeder power state
- customer impact summaries
- command previews in the selected-object panel

Closing a station breaker is intentionally conservative and can be blocked by downstream fault state or unsafe restoration conditions.

## 9. Alarm and Event Flow

For each update cycle:

1. The simulator produces a full snapshot.
2. The backend validates and stores the latest state.
3. Alarm rules evaluate against current values and previous alarm state.
4. Event entries are written for alarm transitions, state transitions, and commands.
5. The dashboard payload is broadcast over WebSocket and exposed over REST.

Alarm and event are deliberately different concepts:

- Alarm = current operational state that may need action
- Event = append-only timeline fact

## 10. Trend and Replay Model

Trend history is collected separately from the live snapshot and exposed through `GET /api/trends`.

Current capabilities:

- independent time windows per chart
- phase-specific voltage trends (`L1`, `L2`, `L3`, `all`)
- hover inspection in the UI
- replay timeline with event filters, stepping, and jump-to-live

Replay uses recent dashboard frames plus recent events to reconstruct an operator-friendly incident timeline.

## 11. Responsiveness and Performance

Current performance choices:

- compact dashboard payload over WebSocket
- backend trend downsampling
- separate trend API for larger windows
- SVG-based diagram for crisp scaling and stateful route rendering
- flat UI state store to avoid unnecessary rerenders

The goal is smooth 2-second live updates without making the UI feel heavy.

## 12. Implemented Status

Implemented in the current version:

- live dashboard
- one-line diagram with feeder and station breaker modeling
- object-centric trends
- replay and incident center
- simulator profiles, timed events, and fault scenarios
- conservative switching flow and audit trail
- report export

## 13. Near-Term Next Steps

Next development packages:

- deeper energized/de-energized continuity in the one-line diagram
- richer station-level restoration previews
- replay bookmarks and better incident slicing
- stronger report outputs and shareable incident bundles
- optional MQTT ingress path after the local core is fully stable
