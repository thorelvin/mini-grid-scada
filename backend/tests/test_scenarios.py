import asyncio
from datetime import datetime, timedelta

from backend.app.domain.models import NormalProfileSummary, ScenarioSummary, TimedEventSummary
from backend.app.services.app_state import AppState
from simulator.dynamics import DEFAULT_PROFILE_ID, list_profiles, list_timed_events
from simulator.grid_simulator import build_demo_topology, create_default_controls
from simulator.scenarios import list_scenarios


def _build_state() -> AppState:
    return AppState(
        topology=build_demo_topology("NST-001"),
        controls=create_default_controls(),
        available_scenarios=[ScenarioSummary(**scenario) for scenario in list_scenarios()],
        available_profiles=[NormalProfileSummary(**profile) for profile in list_profiles()],
        available_timed_events=[TimedEventSummary(**event) for event in list_timed_events()],
        default_profile_id=DEFAULT_PROFILE_ID,
    )


def test_ev_peak_scenario_updates_f3_and_reset_restores_profile_mode():
    async def run():
        app_state = _build_state()

        controls, _settings = await app_state.apply_scenario("ev_peak")
        f3 = next(control for control in controls if control.id == "F3")
        assert f3.loadKw == 260.0
        assert f3.faultMode == "overload"

        reset_controls, _settings = await app_state.reset_simulation()
        reset_f3 = next(control for control in reset_controls if control.id == "F3")
        assert reset_f3.faultMode == "normal"
        assert await app_state.get_active_profile_id() == DEFAULT_PROFILE_ID
        assert await app_state.get_active_scenario_id() is None

    asyncio.run(run())


def test_normal_profile_changes_feeder_load_over_time():
    async def run():
        app_state = _build_state()

        await app_state.activate_profile("weekday")
        started_at = _parse_iso(app_state._active_profile_started_at)
        await app_state.advance_dynamic_state(now=started_at.isoformat())
        first_controls = await app_state.get_controls()
        first_f1 = next(control for control in first_controls if control.id == "F1")

        later = started_at + timedelta(minutes=9)
        await app_state.advance_dynamic_state(now=later.isoformat())
        later_controls = await app_state.get_controls()
        later_f1 = next(control for control in later_controls if control.id == "F1")

        assert first_f1.loadKw != later_f1.loadKw

    asyncio.run(run())


def test_timed_event_activates_and_expires():
    async def run():
        app_state = _build_state()

        await app_state.activate_profile("weekday")
        active_event = await app_state.activate_timed_event("ev_rush_10m")
        assert active_event.id == "ev_rush_10m"

        await app_state.advance_dynamic_state(now=active_event.startedAt)
        assert len(await app_state.get_active_timed_events()) == 1

        after_end = _parse_iso(active_event.endsAt) + timedelta(seconds=1)
        await app_state.advance_dynamic_state(now=after_end.isoformat())
        assert await app_state.get_active_timed_events() == []

    asyncio.run(run())


def _parse_iso(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)
