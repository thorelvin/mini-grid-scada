import asyncio

from backend.app.domain.enums import CommandAction
from backend.app.domain.models import BreakerCommandRequest, FeederControlPatch, NormalProfileSummary, ScenarioSummary, TimedEventSummary
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


def test_close_breaker_is_blocked_when_trip_fault_is_active():
    async def run():
        app_state = _build_state()
        await app_state.apply_scenario("breaker_trip")
        await _refresh_state(app_state)

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
