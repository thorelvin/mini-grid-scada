from __future__ import annotations

from backend.app.domain.models import FeederControlInput, ScenarioSummary, SimulatorSettings


SCENARIO_LIBRARY: dict[str, dict[str, object]] = {
    "normal": {
        "summary": ScenarioSummary(
            id="normal",
            name="Normal drift",
            description="All feeders operate within nominal loading, quality, and breaker limits.",
        ),
        "control_patches": {},
        "settings_patch": {},
    },
    "ev_peak": {
        "summary": ScenarioSummary(
            id="ev_peak",
            name="Elbil-peak",
            description="F3 ramps into heavy EV demand and stresses current and voltage.",
        ),
        "control_patches": {
            "F3": {"loadKw": 260.0, "reactivePowerKvar": 24.0, "phaseImbalancePercent": 9.0, "faultMode": "overload"},
        },
        "settings_patch": {"ambientTempC": 24.0},
    },
    "phase_imbalance": {
        "summary": ScenarioSummary(
            id="phase_imbalance",
            name="Faseubalanse",
            description="F1 drifts into asymmetric phase loading and should trigger imbalance logic.",
        ),
        "control_patches": {
            "F1": {"loadKw": 110.0, "phaseImbalancePercent": 34.0},
        },
        "settings_patch": {},
    },
    "comm_loss": {
        "summary": ScenarioSummary(
            id="comm_loss",
            name="Kommunikasjonstap",
            description="Telemetry quality degrades and should block confidence in commands and analysis.",
        ),
        "control_patches": {
            "F2": {"communicationState": "lost"},
        },
        "settings_patch": {},
    },
    "breaker_trip": {
        "summary": ScenarioSummary(
            id="breaker_trip",
            name="Brytertrip F2",
            description="F2 trips and should show outage impact and conservative recovery behavior.",
        ),
        "control_patches": {
            "F2": {"breakerStatus": "tripped", "faultMode": "forced_trip"},
        },
        "settings_patch": {},
    },
    "high_solar": {
        "summary": ScenarioSummary(
            id="high_solar",
            name="Høy solproduksjon",
            description="F4 exports strongly and can lift voltage toward an overvoltage condition.",
        ),
        "control_patches": {
            "F4": {"solarKw": 180.0, "reactivePowerKvar": -12.0, "phaseImbalancePercent": 5.0},
        },
        "settings_patch": {"ambientTempC": 12.0},
    },
}


def list_scenarios() -> list[dict[str, str]]:
    return [definition["summary"].model_dump(mode="json") for definition in SCENARIO_LIBRARY.values()]


def apply_scenario_to_baseline(
    scenario_id: str,
    baseline_controls: list[FeederControlInput],
    baseline_settings: SimulatorSettings,
) -> tuple[list[FeederControlInput], SimulatorSettings, ScenarioSummary]:
    definition = SCENARIO_LIBRARY.get(scenario_id)
    if definition is None:
        raise KeyError(scenario_id)

    control_patches = definition["control_patches"]
    settings_patch = definition["settings_patch"]
    summary = definition["summary"]

    next_controls: list[FeederControlInput] = []
    for control in baseline_controls:
        patch = control_patches.get(control.id, {})
        next_controls.append(control.model_copy(update=patch))

    next_settings = baseline_settings.model_copy(update=settings_patch)
    return next_controls, next_settings, summary
