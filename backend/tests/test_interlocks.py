import asyncio
from datetime import datetime, timedelta

from backend.app.domain.enums import CommandAction
from backend.app.domain.models import BreakerCommandRequest, FeederControlPatch, NormalProfileSummary, ScenarioSummary, TimedEventSummary
from backend.app.services.alarm_service import evaluate_snapshot
from backend.app.services.app_state import AppState
from backend.app.services.simulator_service import SimulatorService
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
    station_breakers = await app_state.get_station_breakers()
    simulator_settings = await app_state.get_simulator_settings()
    snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=simulator_settings.ambientTempC,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
        station_breaker_states=station_breakers,
    )
    alarms = evaluate_snapshot(snapshot)
    await app_state.update_frame(snapshot, alarms)


async def _refresh_state_at(app_state: AppState, now: str) -> None:
    await app_state.advance_dynamic_state(now=now)
    controls = await app_state.get_controls()
    station_breakers = await app_state.get_station_breakers()
    simulator_settings = await app_state.get_simulator_settings()
    snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=simulator_settings.ambientTempC,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
        station_breaker_states=station_breakers,
    )
    alarms = evaluate_snapshot(snapshot)
    await app_state.update_frame(snapshot, alarms)


def test_open_breaker_requires_reason_and_confirmation():
    async def run():
        app_state = _build_state()
        await _refresh_state(app_state)

        blocked = await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(objectId="F1", operator="operator", reason="", confirmImpact=False),
        )
        assert blocked.allowed is False
        assert blocked.interlock.affectedCustomers == 124

        allowed = await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(
                objectId="F1",
                operator="operator",
                reason="Planned switching",
                confirmImpact=True,
            ),
        )
        assert allowed.allowed is True
        controls = await app_state.get_controls()
        f1 = next(control for control in controls if control.id == "F1")
        assert f1.breakerStatus == "open"

    asyncio.run(run())


def test_lv_breaker_open_deenergizes_all_closed_downstream_feeders():
    async def run():
        app_state = _build_state()
        await _refresh_state(app_state)

        result = await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(
                objectId="LV-BRK",
                operator="operator",
                reason="Station maintenance",
                confirmImpact=True,
            ),
        )
        assert result.allowed is True

        await _refresh_state(app_state)
        snapshot = await app_state.get_snapshot()

        assert next(item for item in snapshot.stationBreakers if item.id == "LV-BRK").breakerStatus == "open"
        assert snapshot.transformer.secondaryVoltageV > 0
        assert all(feeder.activePowerKw == 0 for feeder in snapshot.feeders)
        assert all(feeder.derived.affectedCustomers == feeder.customers for feeder in snapshot.feeders)

    asyncio.run(run())


def test_lv_breaker_close_allows_restore_when_tripped_feeder_is_isolated():
    async def run():
        app_state = _build_state()
        await app_state.update_control("F3", FeederControlPatch(loadKw=320.0))
        await _refresh_state(app_state)

        opened = await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(
                objectId="LV-BRK",
                operator="operator",
                reason="Testing",
                confirmImpact=True,
            ),
        )
        assert opened.allowed is True

        restored = await app_state.execute_breaker_command(
            CommandAction.CLOSE_BREAKER,
            BreakerCommandRequest(objectId="LV-BRK", operator="operator", reason="Restore bus"),
        )

        assert restored.allowed is True

        await _refresh_state(app_state)
        snapshot = await app_state.get_snapshot()
        feeders = {feeder.id: feeder for feeder in snapshot.feeders}

        assert next(item for item in snapshot.stationBreakers if item.id == "LV-BRK").breakerStatus == "closed"
        assert feeders["F3"].breakerStatus == "tripped"
        assert feeders["F3"].activePowerKw == 0
        assert feeders["F1"].activePowerKw > 0
        assert feeders["F2"].activePowerKw > 0

    asyncio.run(run())


def test_lv_breaker_close_is_blocked_when_closed_downstream_fault_is_active():
    async def run():
        app_state = _build_state()
        await app_state.update_control("F2", FeederControlPatch(faultMode="sensor_fault"))
        await _refresh_state(app_state)

        opened = await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(
                objectId="LV-BRK",
                operator="operator",
                reason="Testing",
                confirmImpact=True,
            ),
        )
        assert opened.allowed is True

        blocked = await app_state.execute_breaker_command(
            CommandAction.CLOSE_BREAKER,
            BreakerCommandRequest(objectId="LV-BRK", operator="operator", reason="Restore bus"),
        )

        assert blocked.allowed is False
        assert any("fault" in reason.lower() for reason in blocked.interlock.reasons)

    asyncio.run(run())


def test_brk_in_can_close_with_lv_breaker_open_while_downstream_trip_stays_isolated():
    async def run():
        app_state = _build_state()
        await app_state.update_control("F3", FeederControlPatch(loadKw=320.0))
        await _refresh_state(app_state)

        await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(
                objectId="LV-BRK",
                operator="operator",
                reason="Bus isolation",
                confirmImpact=True,
            ),
        )
        await app_state.execute_breaker_command(
            CommandAction.OPEN_BREAKER,
            BreakerCommandRequest(
                objectId="BRK-IN",
                operator="operator",
                reason="Transformer isolation",
                confirmImpact=True,
            ),
        )

        restored = await app_state.execute_breaker_command(
            CommandAction.CLOSE_BREAKER,
            BreakerCommandRequest(objectId="BRK-IN", operator="operator", reason="Transformer restore first"),
        )

        assert restored.allowed is True

        await _refresh_state(app_state)
        snapshot = await app_state.get_snapshot()

        assert next(item for item in snapshot.stationBreakers if item.id == "BRK-IN").breakerStatus == "closed"
        assert next(item for item in snapshot.stationBreakers if item.id == "LV-BRK").breakerStatus == "open"
        assert snapshot.transformer.secondaryVoltageV > 0
        assert all(feeder.activePowerKw == 0 for feeder in snapshot.feeders)

    asyncio.run(run())


def test_close_breaker_is_blocked_when_trip_fault_is_active():
    async def run():
        app_state = _build_state()
        await app_state.apply_scenario("breaker_trip")
        scenario_started_at = datetime.fromisoformat(app_state._active_scenario_started_at) + timedelta(minutes=2)
        await _refresh_state_at(app_state, scenario_started_at.isoformat())

        result = await app_state.execute_breaker_command(
            CommandAction.CLOSE_BREAKER,
            BreakerCommandRequest(objectId="F2", operator="operator", reason="Restore supply"),
        )

        assert result.allowed is False
        assert any("fault" in reason.lower() or "critical" in reason.lower() for reason in result.interlock.reasons)

    asyncio.run(run())


def test_measured_overload_latches_trip_until_operator_clears_fault():
    async def run():
        app_state = _build_state()
        await app_state.update_control("F3", FeederControlPatch(loadKw=320.0))
        await _refresh_state(app_state)

        snapshot = await app_state.get_snapshot()
        controls = await app_state.get_controls()
        f3_snapshot = next(feeder for feeder in snapshot.feeders if feeder.id == "F3")
        f3_control = next(control for control in controls if control.id == "F3")

        assert f3_snapshot.breakerStatus == "tripped"
        assert f3_control.breakerStatus == "tripped"
        assert f3_control.faultMode == "overload"

        await app_state.update_control(
            "F3",
            FeederControlPatch(loadKw=120.0, faultMode="normal", breakerStatus="open"),
        )
        controls_after_clear = await app_state.get_controls()
        f3_after_clear = next(control for control in controls_after_clear if control.id == "F3")
        assert f3_after_clear.faultMode == "normal"
        assert f3_after_clear.breakerStatus == "open"

    asyncio.run(run())


def test_measured_overload_can_reclose_after_load_reduction_and_acknowledge():
    async def run():
        app_state = _build_state()
        await app_state.update_control("F3", FeederControlPatch(loadKw=320.0))
        await _refresh_state(app_state)

        first_snapshot = await app_state.get_snapshot()
        first_feeder = next(feeder for feeder in first_snapshot.feeders if feeder.id == "F3")
        assert first_feeder.breakerStatus == "tripped"
        assert first_feeder.derived.utilizationPercent >= first_feeder.protection.tripPercent

        await app_state.acknowledge_alarms("F3")
        await app_state.update_control("F3", FeederControlPatch(loadKw=120.0))
        await _refresh_state(app_state)

        second_snapshot = await app_state.get_snapshot()
        second_feeder = next(feeder for feeder in second_snapshot.feeders if feeder.id == "F3")
        assert second_feeder.breakerStatus == "tripped"
        assert second_feeder.derived.utilizationPercent < second_feeder.protection.warningPercent

        result = await app_state.execute_breaker_command(
            CommandAction.CLOSE_BREAKER,
            BreakerCommandRequest(objectId="F3", operator="operator", reason="Restore after overload"),
        )

        assert result.allowed is True

        controls = await app_state.get_controls()
        f3_control = next(control for control in controls if control.id == "F3")
        assert f3_control.breakerStatus == "closed"
        assert f3_control.faultMode == "normal"

    asyncio.run(run())


def test_profile_to_custom_transition_preserves_other_live_feeders():
    async def run():
        app_state = _build_state()
        await app_state.activate_profile("weekday")

        started_at = datetime.fromisoformat(app_state._active_profile_started_at)
        first_tick = (started_at + timedelta(minutes=9)).isoformat()
        second_tick = (started_at + timedelta(minutes=10)).isoformat()

        await app_state.advance_dynamic_state(now=first_tick)
        live_controls = await app_state.get_controls()
        f1_before = next(control for control in live_controls if control.id == "F1")
        f3_before = next(control for control in live_controls if control.id == "F3")

        assert f3_before.loadKw != 168.0

        await app_state.update_control("F1", FeederControlPatch(loadKw=round(f1_before.loadKw + 15.0, 1)))
        await app_state.advance_dynamic_state(now=second_tick)

        custom_controls = await app_state.get_controls()
        f1_after = next(control for control in custom_controls if control.id == "F1")
        f3_after = next(control for control in custom_controls if control.id == "F3")

        assert f1_after.loadKw == round(f1_before.loadKw + 15.0, 1)
        assert f3_after.loadKw == f3_before.loadKw

    asyncio.run(run())


def test_refresh_now_preserves_other_live_feeders_after_manual_update():
    async def run():
        app_state = _build_state()
        simulator = SimulatorService(app_state)
        await simulator.start()

        try:
            await app_state.reset_simulation()

            before = await app_state.get_dashboard()
            before_controls = {control.id: control for control in before.controls}

            assert before_controls["F3"].loadKw != 168.0

            await app_state.update_control("F1", FeederControlPatch(loadKw=100.0))
            await simulator.refresh_now()

            after = await app_state.get_dashboard()
            after_controls = {control.id: control for control in after.controls}

            assert after_controls["F1"].loadKw == 100.0
            assert after_controls["F2"].loadKw == before_controls["F2"].loadKw
            assert after_controls["F3"].loadKw == before_controls["F3"].loadKw
            assert after_controls["F4"].loadKw == before_controls["F4"].loadKw
        finally:
            await simulator.stop()

    asyncio.run(run())
