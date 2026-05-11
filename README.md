# mini-grid-scada

SCADA-inspired operator dashboard for a simulated low-voltage distribution station.

The project is intentionally built as a portfolio/demo system for grid monitoring, alarms, event logging, simulator-driven scenarios and safe command handling. It must not be used to control real electrical equipment.

## Architecture

The working architecture plan lives in [docs/architecture.md](docs/architecture.md).

Current direction:

- `FastAPI` backend as system-of-record for topology, telemetry, alarms, commands and dashboard payloads
- `React + Vite + TypeScript` frontend for the operator GUI
- `Python` simulator for feeder load, solar export, power quality and scenario injection
- `WebSocket` dashboard updates with polling fallback
- `MQTT` kept as a later architecture step, not an MVP dependency

## What Works Now

The repository already contains a functional end-to-end demo skeleton:

- live dashboard payload from backend to frontend
- responsive SCADA-style operator GUI
- single-line diagram with breaker states, transformer feed and feeder cards
- active alarms, event log and selected-object panel
- scenario controls for EV peak, phase imbalance, comms loss, breaker trip and high solar
- manual feeder controls for load, reactive power, breaker state, quality and solar
- interlocked open/close breaker commands
- trend charts for voltage, current and transformer load
- report export from the frontend
- backend tests for alarms, scenarios and command behavior

## Repo Layout

```text
backend/        FastAPI app, routes, services, tests
frontend/       React/Vite operator UI
simulator/      Grid simulation logic and scenario definitions
sample_data/    Default control inputs and seed values
docs/           Architecture and planning
tools/          Local helper wrappers
```

## Quick Start

### 1. Backend

Create a virtual environment and install the backend package:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .\backend[dev]
```

Start the API:

```powershell
.\.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Useful endpoints:

- `GET http://127.0.0.1:8000/api/dashboard`
- `GET http://127.0.0.1:8000/api/topology`
- `GET http://127.0.0.1:8000/api/alarms/active`
- `POST http://127.0.0.1:8000/api/commands/open-breaker`
- `POST http://127.0.0.1:8000/api/commands/close-breaker`
- `POST http://127.0.0.1:8000/api/simulator/scenarios/ev_peak/activate`
- `POST http://127.0.0.1:8000/api/simulator/reset`

### 2. Frontend

Install dependencies:

```powershell
cd frontend
npm install
```

Start the dev server:

```powershell
npm run dev
```

The frontend runs on:

- `http://127.0.0.1:5173/`

## Command and Scenario Behavior

Current command handling is intentionally conservative:

- opening a breaker requires operator reason and impact confirmation
- closing a breaker is blocked when telemetry quality is degraded, a trip/fault is still active, or a critical alarm remains unacknowledged
- command outcomes are reflected back into the dashboard and event log

Scenario handling supports both quick fault injection and return to baseline:

- activate a named scenario from the simulator panel
- return to nominal operation with `Til normaltilstand`
- keep trends and event history visible while scenarios run

## Development Notes

- the backend depends on `websockets` so `/ws/dashboard` stays live instead of falling back to polling
- the frontend is designed to stay lightweight and responsive even while trends and alarms update continuously
- SVG-based diagram symbols are used instead of bitmap assets so the single-line view stays sharp and easy to style

## Verification

Backend tests:

```powershell
.\.venv\Scripts\python -m pytest backend\tests -q
```

Frontend production build:

```powershell
cd frontend
npm run build
```

## Next Steps

Planned next improvements:

- stronger energized/de-energized visualization through the whole one-line diagram
- richer replay and timeline tooling
- more detailed incident summary/report generation
- optional MQTT ingestion path after the MVP core is stable
