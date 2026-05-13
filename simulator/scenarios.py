from __future__ import annotations

from datetime import datetime

from backend.app.domain.models import FeederControlInput, ScenarioSummary, SimulatorSettings


SCENARIO_LIBRARY: dict[str, dict[str, object]] = {
    "ev_peak": {
        "summary": ScenarioSummary(
            id="ev_peak",
            name="Elbil-peak",
            description="F3 ramps inn i tung elbillading uten a tvinge fram en umiddelbar trip.",
        ),
        "rampSec": 90,
        "control_targets": {
            "F3": {"loadKw": 180.0, "reactivePowerKvar": 16.0, "phaseImbalancePercent": 5.0},
        },
        "settings_targets": {"ambientTempC": 24.0},
    },
    "phase_imbalance": {
        "summary": ScenarioSummary(
            id="phase_imbalance",
            name="Faseubalanse",
            description="F1 drifter gradvis inn i tydelig faseubalanse og skal trigge ubalanselogikk.",
        ),
        "rampSec": 80,
        "control_targets": {
            "F1": {"loadKw": 84.0, "phaseImbalancePercent": 30.0},
        },
        "settings_targets": {},
    },
    "comm_loss": {
        "summary": ScenarioSummary(
            id="comm_loss",
            name="Kommunikasjonstap",
            description="Telemetrikvaliteten forringes gradvis og skal redusere tilliten til analyse og kommandoer.",
        ),
        "rampSec": 60,
        "control_targets": {
            "F2": {"communicationState": "lost"},
        },
        "settings_targets": {},
    },
    "breaker_trip": {
        "summary": ScenarioSummary(
            id="breaker_trip",
            name="Brytertrip F2",
            description="F2 bygger opp til en trip-hendelse og skal vise konsekvens og konservativ gjeninnkobling.",
        ),
        "rampSec": 70,
        "switchAt": {"breakerStatus": 0.82, "faultMode": 0.82},
        "control_targets": {
            "F2": {"breakerStatus": "tripped", "faultMode": "forced_trip"},
        },
        "settings_targets": {},
    },
    "high_solar": {
        "summary": ScenarioSummary(
            id="high_solar",
            name="Hoy solproduksjon",
            description="F4 eksporterer gradvis mer kraft og kan lofte spenningen mot overvolt-tilstand.",
        ),
        "rampSec": 120,
        "control_targets": {
            "F4": {"solarKw": 125.0, "reactivePowerKvar": -8.0, "phaseImbalancePercent": 4.0},
        },
        "settings_targets": {"ambientTempC": 12.0},
    },
    "hydro_low_flow": {
        "summary": ScenarioSummary(
            id="hydro_low_flow",
            name="Lav vannforing F5",
            description="Romstad Kraftverk mister gradvis vannforing og leverer mindre lokal produksjon.",
        ),
        "rampSec": 150,
        "control_targets": {
            "F5": {"solarKw": 34.0, "loadKw": 20.0, "reactivePowerKvar": -2.0, "phaseImbalancePercent": 2.4},
        },
        "settings_targets": {"ambientTempC": 17.0},
    },
    "hydro_intake_debris": {
        "summary": ScenarioSummary(
            id="hydro_intake_debris",
            name="Inntaksrist tett F5",
            description="Inntaksristen pa F5 tetter seg gradvis og gir redusert produksjon og svakere datakvalitet.",
        ),
        "rampSec": 120,
        "control_targets": {
            "F5": {
                "solarKw": 48.0,
                "loadKw": 22.0,
                "reactivePowerKvar": 2.0,
                "phaseImbalancePercent": 3.0,
                "communicationState": "estimated",
            },
        },
        "settings_targets": {},
    },
    "hydro_turbine_trip": {
        "summary": ScenarioSummary(
            id="hydro_turbine_trip",
            name="Turbintrip F5",
            description="Romstad Kraftverk faller ut og viser en tydelig produksjonstrip pa F5.",
        ),
        "rampSec": 85,
        "switchAt": {"breakerStatus": 0.86, "faultMode": 0.86},
        "control_targets": {
            "F5": {
                "solarKw": 0.0,
                "loadKw": 6.0,
                "reactivePowerKvar": 1.0,
                "breakerStatus": "tripped",
                "faultMode": "forced_trip",
            },
        },
        "settings_targets": {},
    },
}

QUALITY_STATES = ("good", "estimated", "stale", "invalid", "lost")


def list_scenarios() -> list[dict[str, str]]:
    return [definition["summary"].model_dump(mode="json") for definition in SCENARIO_LIBRARY.values()]


def get_scenario_summary(scenario_id: str) -> ScenarioSummary:
    definition = SCENARIO_LIBRARY.get(scenario_id)
    if definition is None:
        raise KeyError(scenario_id)
    return definition["summary"]


def get_scenario_progress(
    scenario_id: str,
    started_at: str,
    now: str,
    speed_multiplier: float,
) -> float:
    definition = SCENARIO_LIBRARY.get(scenario_id)
    if definition is None:
        raise KeyError(scenario_id)

    ramp_sec = max(float(definition.get("rampSec", 60)), 1.0)
    effective_ramp_sec = ramp_sec / max(speed_multiplier, 0.25)
    elapsed_sec = max(0.0, (datetime.fromisoformat(now) - datetime.fromisoformat(started_at)).total_seconds())
    return max(0.0, min(1.0, elapsed_sec / effective_ramp_sec))


def _blend_numeric(base_value: float, target_value: float, progress: float) -> float:
    return round(base_value + ((target_value - base_value) * progress), 2)


def _blend_quality(base_value: str, target_value: str, progress: float) -> str:
    try:
        base_index = QUALITY_STATES.index(base_value)
        target_index = QUALITY_STATES.index(target_value)
    except ValueError:
        return target_value if progress >= 1.0 else base_value

    if base_index == target_index:
        return base_value

    stepped_index = round(base_index + ((target_index - base_index) * progress))
    stepped_index = max(0, min(len(QUALITY_STATES) - 1, stepped_index))
    return QUALITY_STATES[stepped_index]


def apply_scenario_overlay(
    scenario_id: str,
    baseline_controls: list[FeederControlInput],
    baseline_settings: SimulatorSettings,
    progress: float,
) -> tuple[list[FeederControlInput], SimulatorSettings, ScenarioSummary]:
    definition = SCENARIO_LIBRARY.get(scenario_id)
    if definition is None:
        raise KeyError(scenario_id)

    control_targets: dict[str, dict[str, object]] = definition.get("control_targets", {})
    settings_targets: dict[str, object] = definition.get("settings_targets", {})
    switch_at: dict[str, float] = definition.get("switchAt", {})
    summary: ScenarioSummary = definition["summary"]
    clamped_progress = max(0.0, min(1.0, progress))

    next_controls: list[FeederControlInput] = []
    for control in baseline_controls:
        target_patch = control_targets.get(control.id)
        if not target_patch:
            next_controls.append(control.model_copy(deep=True))
            continue

        updates: dict[str, object] = {}
        for field_name, target_value in target_patch.items():
            current_value = getattr(control, field_name)
            if isinstance(target_value, (int, float)) and isinstance(current_value, (int, float)):
                updates[field_name] = _blend_numeric(float(current_value), float(target_value), clamped_progress)
                continue

            if field_name == "communicationState":
                updates[field_name] = _blend_quality(str(current_value), str(target_value), clamped_progress)
                continue

            threshold = switch_at.get(field_name, 0.82)
            updates[field_name] = target_value if clamped_progress >= threshold else current_value

        next_controls.append(control.model_copy(update=updates))

    settings_updates: dict[str, object] = {}
    for field_name, target_value in settings_targets.items():
        current_value = getattr(baseline_settings, field_name)
        if isinstance(target_value, (int, float)) and isinstance(current_value, (int, float)):
            settings_updates[field_name] = _blend_numeric(float(current_value), float(target_value), clamped_progress)
        else:
            settings_updates[field_name] = target_value if clamped_progress >= 1.0 else current_value

    next_settings = baseline_settings.model_copy(update=settings_updates)
    return next_controls, next_settings, summary
