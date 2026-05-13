import asyncio
from datetime import datetime, timedelta, timezone

from backend.app.domain.models import NormalProfileSummary, ScenarioSummary, TimedEventSummary
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


def _snapshot_at(minute_offset: int):
    controls = create_default_controls()
    controls[0] = controls[0].model_copy(update={"loadKw": 70.0 + minute_offset})
    controls[2] = controls[2].model_copy(update={"loadKw": 115.0 + minute_offset * 2})
    timestamp = datetime(2026, 5, 12, 8, 0, tzinfo=timezone.utc) + timedelta(minutes=minute_offset)
    snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=18.0,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
        service_target_phase_voltage_v=232.0,
    )
    return snapshot.model_copy(update={"timestamp": timestamp.isoformat()})


def test_trend_windows_can_be_requested_per_metric():
    async def run():
        app_state = _build_state()

        for minute_offset in (0, 10, 20, 30, 40, 50):
            await app_state.update_frame(_snapshot_at(minute_offset), [])

        trends = await app_state.get_trends(
            voltage_window_sec=15 * 60,
            current_window_sec=30 * 60,
            transformer_window_sec=60 * 60,
        )

        assert len(trends.voltageL1[0].points) == 2
        assert len(trends.voltageL2[0].points) == 2
        assert len(trends.voltageL3[0].points) == 2
        assert len(trends.currentMax[0].points) == 4
        assert len(trends.transformerLoad[0].points) == 6

    asyncio.run(run())
