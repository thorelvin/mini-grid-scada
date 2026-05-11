import asyncio

from backend.app.domain.models import ScenarioSummary
from backend.app.services.app_state import AppState
from simulator.grid_simulator import build_demo_topology, create_default_controls
from simulator.scenarios import list_scenarios


def test_ev_peak_scenario_updates_f3_and_reset_restores_defaults():
    async def run():
        app_state = AppState(
            topology=build_demo_topology("NST-001"),
            controls=create_default_controls(),
            available_scenarios=[ScenarioSummary(**scenario) for scenario in list_scenarios()],
        )

        controls, _settings = await app_state.apply_scenario("ev_peak")
        f3 = next(control for control in controls if control.id == "F3")
        assert f3.loadKw == 260.0
        assert f3.faultMode == "overload"

        reset_controls, _settings = await app_state.reset_simulation()
        reset_f3 = next(control for control in reset_controls if control.id == "F3")
        assert reset_f3.loadKw == 168.0
        assert reset_f3.faultMode == "normal"

    asyncio.run(run())

