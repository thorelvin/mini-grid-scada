import asyncio
from datetime import datetime, timedelta

from backend.app.domain.models import NormalProfileSummary, ScenarioSummary, TimedEventSummary
from backend.app.services.alarm_service import evaluate_snapshot
from backend.app.services.app_state import AppState
from simulator.dynamics import DEFAULT_PROFILE_ID, list_profiles, list_timed_events
from simulator.grid_simulator import build_demo_topology, build_snapshot, create_default_controls
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


async def _refresh_state(app_state: AppState) -> None:
    await app_state.advance_dynamic_state()
    controls = await app_state.get_controls()
    simulator_settings = await app_state.get_simulator_settings()
    snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=simulator_settings.ambientTempC,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
    )
    alarms = evaluate_snapshot(snapshot)
    await app_state.update_frame(snapshot, alarms)


async def _refresh_state_at(app_state: AppState, now: str) -> None:
    await app_state.advance_dynamic_state(now=now)
    controls = await app_state.get_controls()
    simulator_settings = await app_state.get_simulator_settings()
    snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=simulator_settings.ambientTempC,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
    )
    alarms = evaluate_snapshot(snapshot)
    await app_state.update_frame(snapshot, alarms)


def test_acknowledge_all_alarms_marks_unacknowledged_entries():
    async def run():
        app_state = _build_state()
        await app_state.apply_scenario("ev_peak")
        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at) + timedelta(minutes=3)
        await _refresh_state_at(app_state, scenario_started_at.isoformat())

        updated = await app_state.acknowledge_alarms()
        alarms = await app_state.get_active_alarms()

        assert updated
        assert all(alarm.state == "acknowledged" for alarm in alarms)

    asyncio.run(run())


def test_acknowledge_alarms_can_be_scoped_to_one_object():
    async def run():
        app_state = _build_state()
        await app_state.apply_scenario("phase_imbalance")
        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at) + timedelta(minutes=2)
        await _refresh_state_at(app_state, scenario_started_at.isoformat())

        updated = await app_state.acknowledge_alarms(object_id="F1")
        alarms = await app_state.get_active_alarms()
        f1_alarms = [alarm for alarm in alarms if alarm.objectId == "F1"]
        other_alarms = [alarm for alarm in alarms if alarm.objectId != "F1"]

        assert updated
        assert all(alarm.state == "acknowledged" for alarm in f1_alarms)
        assert all(alarm.state != "acknowledged" for alarm in other_alarms)

    asyncio.run(run())
