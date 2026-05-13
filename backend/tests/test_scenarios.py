import asyncio
from datetime import datetime, timedelta

from backend.app.config import settings
from backend.app.domain.models import NormalProfileSummary, ScenarioSummary, SimulatorSettingsPatch, TimedEventSummary
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


def _build_snapshot_from_state(controls, ambient_temp_c):
    return build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=ambient_temp_c,
        nominal_phase_voltage_v=settings.nominal_phase_voltage_v,
        nominal_line_voltage_v=settings.nominal_line_voltage_v,
        transformer_rating_kva=settings.transformer_rating_kva,
        service_target_phase_voltage_v=settings.service_target_phase_voltage_v,
    )


def test_ev_peak_overlay_ramps_without_immediate_trip_and_reset_restores_profile_mode():
    async def run():
        app_state = _build_state()

        await app_state.activate_profile("winter_day")
        profile_started_at = datetime.fromisoformat(app_state._active_profile_started_at)
        await app_state.advance_dynamic_state(now=profile_started_at.isoformat())
        baseline_controls = await app_state.get_controls()
        baseline_f3 = next(control for control in baseline_controls if control.id == "F3")

        await app_state.apply_scenario("ev_peak")
        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at)

        await app_state.advance_dynamic_state(now=(scenario_started_at + timedelta(seconds=20)).isoformat())
        early_controls = await app_state.get_controls()
        early_f3 = next(control for control in early_controls if control.id == "F3")
        assert early_f3.loadKw > baseline_f3.loadKw
        assert early_f3.loadKw < 180.0

        await app_state.advance_dynamic_state(now=(scenario_started_at + timedelta(minutes=3)).isoformat())
        controls = await app_state.get_controls()
        simulator_settings = await app_state.get_simulator_settings()
        f3 = next(control for control in controls if control.id == "F3")
        snapshot = _build_snapshot_from_state(controls, simulator_settings.ambientTempC)
        snapshot_f3 = next(feeder for feeder in snapshot.feeders if feeder.id == "F3")

        assert f3.loadKw == 180.0
        assert f3.faultMode == "normal"
        assert snapshot_f3.breakerStatus == "closed"
        assert any(alarm.objectId == "F3" for alarm in evaluate_snapshot(snapshot))

        reset_controls, _settings = await app_state.reset_simulation()
        reset_f3 = next(control for control in reset_controls if control.id == "F3")
        assert reset_f3.faultMode == "normal"
        assert await app_state.get_active_profile_id() == DEFAULT_PROFILE_ID
        assert await app_state.get_active_scenario_id() is None

    asyncio.run(run())


def test_hydro_low_flow_reduces_generation_support_without_tripping_f5():
    async def run():
        app_state = _build_state()

        await app_state.activate_profile("weekday")
        baseline_controls = await app_state.get_controls()
        baseline_settings = await app_state.get_simulator_settings()
        baseline_snapshot = _build_snapshot_from_state(baseline_controls, baseline_settings.ambientTempC)
        baseline_f5 = next(feeder for feeder in baseline_snapshot.feeders if feeder.id == "F5")

        await app_state.apply_scenario("hydro_low_flow")
        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at)
        await app_state.advance_dynamic_state(now=(scenario_started_at + timedelta(minutes=3)).isoformat())

        controls = await app_state.get_controls()
        simulator_settings = await app_state.get_simulator_settings()
        snapshot = _build_snapshot_from_state(controls, simulator_settings.ambientTempC)
        f5 = next(feeder for feeder in snapshot.feeders if feeder.id == "F5")

        assert f5.breakerStatus == "closed"
        assert f5.activePowerKw > baseline_f5.activePowerKw
        assert (f5.generationEquivalentHomes or 0) < (baseline_f5.generationEquivalentHomes or 0)

    asyncio.run(run())


def test_hydro_turbine_trip_trips_f5_and_removes_generation_support():
    async def run():
        app_state = _build_state()

        await app_state.activate_profile("weekday")
        await app_state.apply_scenario("hydro_turbine_trip")
        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at)
        await app_state.advance_dynamic_state(now=(scenario_started_at + timedelta(minutes=3)).isoformat())

        controls = await app_state.get_controls()
        simulator_settings = await app_state.get_simulator_settings()
        snapshot = _build_snapshot_from_state(controls, simulator_settings.ambientTempC)
        f5 = next(feeder for feeder in snapshot.feeders if feeder.id == "F5")

        assert f5.breakerStatus == "tripped"
        assert f5.activePowerKw == 0.0
        assert (f5.generationEquivalentHomes or 0) == 0

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


def test_all_scenarios_can_run_as_overlays_on_winter_profile():
    async def run():
        for scenario in list_scenarios():
            app_state = _build_state()
            await app_state.activate_profile("winter_day")
            await app_state.apply_scenario(scenario["id"])
            scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at)
            await app_state.advance_dynamic_state(now=(scenario_started_at + timedelta(minutes=3)).isoformat())

            controls = await app_state.get_controls()
            simulator_settings = await app_state.get_simulator_settings()
            snapshot = _build_snapshot_from_state(controls, simulator_settings.ambientTempC)
            alarms = evaluate_snapshot(snapshot)

            assert await app_state.get_active_profile_id() == "winter_day"
            assert await app_state.get_active_scenario_id() == scenario["id"]
            assert len(controls) == 5
            assert snapshot.stationId == "NST-001"
            assert alarms is not None

    asyncio.run(run())


def test_scenario_speed_multiplier_accelerates_overlay_progress():
    async def run():
        app_state = _build_state()
        await app_state.activate_profile("winter_day")
        await app_state.update_simulator_settings(SimulatorSettingsPatch(scenarioSpeedMultiplier=4.0))
        await app_state.apply_scenario("phase_imbalance")

        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at)
        await app_state.advance_dynamic_state(now=(scenario_started_at + timedelta(seconds=25)).isoformat())
        fast_controls = await app_state.get_controls()
        fast_f1 = next(control for control in fast_controls if control.id == "F1")

        assert fast_f1.phaseImbalancePercent > 20.0
        assert await app_state.get_active_profile_id() == "winter_day"

    asyncio.run(run())


def _parse_iso(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)
