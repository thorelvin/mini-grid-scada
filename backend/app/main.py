from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes_alarms import router as alarms_router
from backend.app.api.routes_commands import router as commands_router
from backend.app.api.routes_events import router as events_router
from backend.app.api.routes_simulator import router as simulator_router
from backend.app.api.routes_status import router as status_router
from backend.app.api.routes_telemetry import router as telemetry_router
from backend.app.api.ws import router as websocket_router
from backend.app.config import settings
from backend.app.domain.models import NormalProfileSummary, ScenarioSummary, TimedEventSummary
from backend.app.services.app_state import AppState
from backend.app.services.simulator_service import SimulatorService
from simulator.dynamics import DEFAULT_PROFILE_ID, list_profiles, list_timed_events
from simulator.grid_simulator import build_demo_topology, create_default_controls
from simulator.scenarios import list_scenarios


@asynccontextmanager
async def lifespan(app: FastAPI):
    topology = build_demo_topology(settings.station_id)
    controls = create_default_controls()
    available_scenarios = [ScenarioSummary(**scenario) for scenario in list_scenarios()]
    available_profiles = [NormalProfileSummary(**profile) for profile in list_profiles()]
    available_timed_events = [TimedEventSummary(**event) for event in list_timed_events()]
    app_state = AppState(
        topology=topology,
        controls=controls,
        available_scenarios=available_scenarios,
        available_profiles=available_profiles,
        available_timed_events=available_timed_events,
        default_profile_id=DEFAULT_PROFILE_ID,
    )
    simulator_service = SimulatorService(app_state)

    app.state.app_state = app_state
    app.state.simulator_service = simulator_service
    app.state.station_id = settings.station_id

    await simulator_service.start()
    try:
        yield
    finally:
        await simulator_service.stop()


app = FastAPI(title=settings.api_title, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(status_router)
app.include_router(telemetry_router)
app.include_router(alarms_router)
app.include_router(commands_router)
app.include_router(events_router)
app.include_router(simulator_router)
app.include_router(websocket_router)
