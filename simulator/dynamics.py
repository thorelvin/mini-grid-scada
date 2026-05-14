from __future__ import annotations

from datetime import datetime, timedelta

from backend.app.domain.models import (
    ActiveTimedEvent,
    FeederControlInput,
    NormalProfileSummary,
    SimulatorSettings,
    TimedEventSummary,
)


DEFAULT_PROFILE_ID = "weekday"


NORMAL_PROFILE_LIBRARY: dict[str, dict[str, object]] = {
    "weekday": {
        "summary": NormalProfileSummary(
            id="weekday",
            name="Hverdag",
            description="Balansert hverdagslast med skole, næring, elbillading og normal solkurve.",
            cycleMinutes=18,
        ),
        "ambientTempC": [(0.0, 16.0), (0.35, 18.0), (0.68, 21.0), (1.0, 17.0)],
        "feeders": {
            "F1": {
                "load": [(0.0, 0.72), (0.18, 0.82), (0.32, 0.64), (0.58, 0.74), (0.82, 1.12), (1.0, 0.72)],
                "reactive": [(0.0, 0.82), (0.82, 1.12), (1.0, 0.82)],
                "imbalance": [(0.0, 6.0), (0.55, 4.5), (0.82, 7.5), (1.0, 6.0)],
            },
            "F2": {
                "load": [(0.0, 0.52), (0.16, 0.92), (0.34, 1.08), (0.54, 0.92), (0.82, 0.58), (1.0, 0.52)],
                "reactive": [(0.0, 0.64), (0.32, 1.12), (0.84, 0.62), (1.0, 0.64)],
                "imbalance": [(0.0, 3.0), (0.42, 4.2), (1.0, 3.0)],
            },
            "F3": {
                "load": [(0.0, 0.48), (0.18, 0.58), (0.5, 0.76), (0.78, 1.02), (0.92, 1.08), (1.0, 0.48)],
                "reactive": [(0.0, 0.85), (0.8, 1.18), (1.0, 0.85)],
                "imbalance": [(0.0, 2.5), (0.84, 4.8), (1.0, 2.5)],
            },
            "F4": {
                "load": [(0.0, 0.88), (0.4, 0.78), (0.72, 0.84), (1.0, 0.88)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.08), (0.18, 0.42), (0.5, 1.08), (0.78, 0.38), (1.0, 0.08)],
                "imbalance": [(0.0, 2.0), (0.5, 3.4), (1.0, 2.0)],
            },
            "F5": {
                "load": [(0.0, 0.92), (0.4, 0.84), (0.76, 0.9), (1.0, 0.92)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.92), (0.24, 0.98), (0.52, 1.06), (0.82, 0.96), (1.0, 0.92)],
                "waterFlow": [(0.0, 0.88), (0.24, 0.94), (0.52, 1.0), (0.82, 0.92), (1.0, 0.88)],
                "imbalance": [(0.0, 1.8), (1.0, 1.8)],
            },
        },
    },
    "winter_day": {
        "summary": NormalProfileSummary(
            id="winter_day",
            name="Vinterhverdag",
            description="Høyere boliglast, mindre solproduksjon og tydeligere morgen- og kveldstopper.",
            cycleMinutes=20,
        ),
        "ambientTempC": [(0.0, -7.0), (0.45, -2.0), (1.0, -5.0)],
        "feeders": {
            "F1": {
                "load": [(0.0, 0.92), (0.16, 1.18), (0.34, 0.88), (0.56, 0.94), (0.84, 1.28), (1.0, 0.92)],
                "reactive": [(0.0, 1.02), (0.84, 1.18), (1.0, 1.02)],
                "imbalance": [(0.0, 7.0), (0.84, 8.8), (1.0, 7.0)],
            },
            "F2": {
                "load": [(0.0, 0.62), (0.2, 0.98), (0.36, 1.12), (0.58, 0.96), (0.82, 0.7), (1.0, 0.62)],
                "reactive": [(0.0, 0.72), (0.36, 1.2), (1.0, 0.72)],
                "imbalance": [(0.0, 3.6), (1.0, 3.6)],
            },
            "F3": {
                "load": [(0.0, 0.42), (0.22, 0.56), (0.56, 0.82), (0.82, 1.12), (1.0, 0.42)],
                "reactive": [(0.0, 0.92), (0.82, 1.18), (1.0, 0.92)],
                "imbalance": [(0.0, 2.8), (0.82, 5.2), (1.0, 2.8)],
            },
            "F4": {
                "load": [(0.0, 0.96), (0.48, 0.86), (1.0, 0.96)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.02), (0.28, 0.12), (0.52, 0.28), (0.76, 0.08), (1.0, 0.02)],
                "imbalance": [(0.0, 2.0), (1.0, 2.0)],
            },
            "F5": {
                "load": [(0.0, 0.94), (0.44, 0.9), (1.0, 0.94)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 1.04), (0.22, 1.1), (0.56, 1.18), (0.82, 1.08), (1.0, 1.04)],
                "waterFlow": [(0.0, 0.94), (0.22, 1.02), (0.56, 1.08), (0.82, 1.0), (1.0, 0.94)],
                "imbalance": [(0.0, 1.6), (1.0, 1.6)],
            },
        },
    },
    "weekend": {
        "summary": NormalProfileSummary(
            id="weekend",
            name="Helg",
            description="Roligere næringslast, senere boligoppstart og jevnere forbruk utover dagen.",
            cycleMinutes=18,
        ),
        "ambientTempC": [(0.0, 15.0), (0.5, 19.0), (1.0, 16.0)],
        "feeders": {
            "F1": {
                "load": [(0.0, 0.78), (0.24, 0.72), (0.48, 0.92), (0.74, 1.04), (1.0, 0.78)],
                "reactive": [(0.0, 0.84), (0.72, 1.06), (1.0, 0.84)],
                "imbalance": [(0.0, 5.4), (0.74, 6.4), (1.0, 5.4)],
            },
            "F2": {
                "load": [(0.0, 0.38), (0.36, 0.52), (0.6, 0.48), (1.0, 0.38)],
                "reactive": [(0.0, 0.58), (0.52, 0.72), (1.0, 0.58)],
                "imbalance": [(0.0, 2.8), (1.0, 2.8)],
            },
            "F3": {
                "load": [(0.0, 0.58), (0.28, 0.68), (0.52, 0.72), (0.82, 0.88), (1.0, 0.58)],
                "reactive": [(0.0, 0.88), (0.84, 1.08), (1.0, 0.88)],
                "imbalance": [(0.0, 2.4), (0.84, 4.4), (1.0, 2.4)],
            },
            "F4": {
                "load": [(0.0, 0.84), (0.44, 0.76), (1.0, 0.84)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.1), (0.26, 0.46), (0.52, 1.02), (0.8, 0.32), (1.0, 0.1)],
                "imbalance": [(0.0, 2.1), (1.0, 2.1)],
            },
            "F5": {
                "load": [(0.0, 0.88), (0.38, 0.82), (0.7, 0.9), (1.0, 0.88)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.94), (0.28, 1.0), (0.54, 1.08), (0.82, 0.98), (1.0, 0.94)],
                "waterFlow": [(0.0, 0.9), (0.28, 0.96), (0.54, 1.02), (0.82, 0.98), (1.0, 0.9)],
                "imbalance": [(0.0, 1.7), (1.0, 1.7)],
            },
        },
    },
    "overcast": {
        "summary": NormalProfileSummary(
            id="overcast",
            name="Overskyet dag",
            description="Normal hverdagslast med svakere og mer ustabil solproduksjon.",
            cycleMinutes=16,
        ),
        "ambientTempC": [(0.0, 13.0), (0.5, 15.0), (1.0, 13.0)],
        "feeders": {
            "F1": {
                "load": [(0.0, 0.74), (0.2, 0.82), (0.58, 0.76), (0.82, 1.08), (1.0, 0.74)],
                "reactive": [(0.0, 0.84), (0.82, 1.1), (1.0, 0.84)],
                "imbalance": [(0.0, 5.8), (1.0, 5.8)],
            },
            "F2": {
                "load": [(0.0, 0.54), (0.18, 0.92), (0.36, 1.02), (0.74, 0.62), (1.0, 0.54)],
                "reactive": [(0.0, 0.66), (0.34, 1.12), (1.0, 0.66)],
                "imbalance": [(0.0, 3.0), (1.0, 3.0)],
            },
            "F3": {
                "load": [(0.0, 0.5), (0.28, 0.58), (0.62, 0.8), (0.86, 1.0), (1.0, 0.5)],
                "reactive": [(0.0, 0.88), (0.84, 1.14), (1.0, 0.88)],
                "imbalance": [(0.0, 2.4), (0.84, 4.8), (1.0, 2.4)],
            },
            "F4": {
                "load": [(0.0, 0.88), (0.5, 0.82), (1.0, 0.88)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.06), (0.18, 0.22), (0.3, 0.54), (0.42, 0.18), (0.56, 0.62), (0.7, 0.26), (1.0, 0.06)],
                "imbalance": [(0.0, 2.2), (1.0, 2.2)],
            },
            "F5": {
                "load": [(0.0, 0.9), (0.42, 0.84), (0.74, 0.92), (1.0, 0.9)],
                "reactive": [(0.0, 1.0), (1.0, 1.0)],
                "solar": [(0.0, 0.96), (0.22, 1.04), (0.38, 0.86), (0.58, 1.08), (0.78, 0.92), (1.0, 0.96)],
                "waterFlow": [(0.0, 0.92), (0.22, 0.98), (0.38, 0.94), (0.58, 1.02), (0.78, 0.96), (1.0, 0.92)],
                "imbalance": [(0.0, 1.9), (1.0, 1.9)],
            },
        },
    },
}


TIMED_EVENT_LIBRARY: dict[str, dict[str, object]] = {
    "school_start_10m": {
        "summary": TimedEventSummary(
            id="school_start_10m",
            name="Skolestart (10 min)",
            description="Kort morgenpuls som gir ekstra aktivitet på F2 og et lite boligløft rundt stasjonen.",
            durationSec=600,
        ),
        "rampInSec": 90,
        "rampOutSec": 90,
        "effects": {
            "F1": {"loadMultiplier": 1.06},
            "F2": {"loadMultiplier": 1.28, "reactiveMultiplier": 1.16, "phaseImbalanceDelta": 2.0},
        },
    },
    "lunch_break_10m": {
        "summary": TimedEventSummary(
            id="lunch_break_10m",
            name="Lunsjpause (10 min)",
            description="Kort topplast hos næring og skole med et lite utslag på elbillading.",
            durationSec=600,
        ),
        "rampInSec": 60,
        "rampOutSec": 60,
        "effects": {
            "F2": {"loadMultiplier": 1.18, "reactiveMultiplier": 1.12},
            "F3": {"loadMultiplier": 1.08},
        },
    },
    "ev_rush_10m": {
        "summary": TimedEventSummary(
            id="ev_rush_10m",
            name="Elbilladingsrush (10 min)",
            description="Kort, tydelig lasthopp på F3 som viser hurtig endring i ladesegmentet.",
            durationSec=600,
        ),
        "rampInSec": 90,
        "rampOutSec": 90,
        "effects": {
            "F3": {"loadMultiplier": 1.35, "reactiveMultiplier": 1.2, "phaseImbalanceDelta": 4.0},
        },
    },
    "cloud_front_10m": {
        "summary": TimedEventSummary(
            id="cloud_front_10m",
            name="Skyfront over sol (10 min)",
            description="F4 mister produksjon raskt og bygger seg rolig opp igjen etter passasjen.",
            durationSec=600,
        ),
        "rampInSec": 120,
        "rampOutSec": 120,
        "effects": {
            "F4": {"solarMultiplier": 0.24, "loadMultiplier": 1.06},
            "F5": {"solarMultiplier": 0.88},
        },
    },
    "evening_peak_60m": {
        "summary": TimedEventSummary(
            id="evening_peak_60m",
            name="Kveldstopp (60 min)",
            description="Bolig- og ladeforbruk bygger seg opp over en lengre kveldsperiode.",
            durationSec=3600,
        ),
        "rampInSec": 300,
        "rampOutSec": 300,
        "effects": {
            "F1": {"loadMultiplier": 1.24, "reactiveMultiplier": 1.14, "phaseImbalanceDelta": 1.6},
            "F3": {"loadMultiplier": 1.18, "reactiveMultiplier": 1.08},
            "F5": {"solarMultiplier": 1.04},
        },
        "ambientTempDelta": -1.0,
    },
    "heat_pump_60m": {
        "summary": TimedEventSummary(
            id="heat_pump_60m",
            name="Varmepumpe-innslag (60 min)",
            description="Lengre høylast i boligfeltet som ofte oppstår ved kald start eller værskifte.",
            durationSec=3600,
        ),
        "rampInSec": 240,
        "rampOutSec": 240,
        "effects": {
            "F1": {"loadMultiplier": 1.3, "reactiveMultiplier": 1.16, "phaseImbalanceDelta": 2.2},
            "F2": {"loadMultiplier": 1.08},
        },
        "ambientTempDelta": -4.0,
    },
}


def _parse_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)


def _progress(started_at: str, cycle_minutes: int, now: str) -> float:
    elapsed_sec = max(0.0, (_parse_timestamp(now) - _parse_timestamp(started_at)).total_seconds())
    cycle_sec = max(60.0, cycle_minutes * 60.0)
    return (elapsed_sec % cycle_sec) / cycle_sec


def _interpolate(points: list[tuple[float, float]], position: float, default: float) -> float:
    if not points:
        return default
    if len(points) == 1:
        return points[0][1]

    ordered = sorted(points, key=lambda item: item[0])
    if position <= ordered[0][0]:
        return ordered[0][1]
    for index in range(1, len(ordered)):
        left_fraction, left_value = ordered[index - 1]
        right_fraction, right_value = ordered[index]
        if position <= right_fraction:
            span = max(right_fraction - left_fraction, 1e-6)
            alpha = (position - left_fraction) / span
            return left_value + (right_value - left_value) * alpha
    return ordered[-1][1]


def list_profiles() -> list[dict[str, object]]:
    return [definition["summary"].model_dump(mode="json") for definition in NORMAL_PROFILE_LIBRARY.values()]


def list_timed_events() -> list[dict[str, object]]:
    return [definition["summary"].model_dump(mode="json") for definition in TIMED_EVENT_LIBRARY.values()]


def sample_profile(
    profile_id: str,
    default_controls: list[FeederControlInput],
    default_settings: SimulatorSettings,
    started_at: str,
    now: str,
) -> tuple[list[FeederControlInput], SimulatorSettings]:
    definition = NORMAL_PROFILE_LIBRARY.get(profile_id)
    if definition is None:
        raise KeyError(profile_id)

    position = _progress(started_at, int(definition["summary"].cycleMinutes), now)
    feeder_schedules = definition["feeders"]
    controls: list[FeederControlInput] = []

    for control in default_controls:
        schedules = feeder_schedules.get(control.id, {})
        load_multiplier = _interpolate(schedules.get("load", []), position, 1.0)
        reactive_multiplier = _interpolate(schedules.get("reactive", []), position, 1.0)
        imbalance = _interpolate(schedules.get("imbalance", []), position, control.phaseImbalancePercent)
        solar_multiplier = _interpolate(schedules.get("solar", []), position, 1.0)
        water_flow_multiplier = _interpolate(schedules.get("waterFlow", []), position, 1.0)

        controls.append(
            control.model_copy(
                update={
                    "loadKw": round(control.loadKw * load_multiplier, 1),
                    "reactivePowerKvar": round(control.reactivePowerKvar * reactive_multiplier, 1),
                    "phaseImbalancePercent": round(imbalance, 1),
                    "solarKw": round(control.solarKw * solar_multiplier, 1),
                    "waterFlowPercent": round(control.waterFlowPercent * water_flow_multiplier, 1),
                }
            )
        )

    ambient_temp_c = _interpolate(definition["ambientTempC"], position, default_settings.ambientTempC)
    settings = default_settings.model_copy(update={"ambientTempC": round(ambient_temp_c, 1)})
    return controls, settings


def activate_timed_event(event_id: str, now: str) -> ActiveTimedEvent:
    definition = TIMED_EVENT_LIBRARY.get(event_id)
    if definition is None:
        raise KeyError(event_id)
    summary = definition["summary"]
    ends_at = _parse_timestamp(now) + timedelta(seconds=summary.durationSec)
    return ActiveTimedEvent(
        id=summary.id,
        name=summary.name,
        description=summary.description,
        durationSec=summary.durationSec,
        startedAt=now,
        endsAt=ends_at.isoformat(),
    )


def _event_strength(active_event: ActiveTimedEvent, now: str, ramp_in_sec: int, ramp_out_sec: int) -> float:
    now_dt = _parse_timestamp(now)
    started_dt = _parse_timestamp(active_event.startedAt)
    ends_dt = _parse_timestamp(active_event.endsAt)
    if now_dt >= ends_dt:
        return 0.0

    elapsed_sec = max(0.0, (now_dt - started_dt).total_seconds())
    remaining_sec = max(0.0, (ends_dt - now_dt).total_seconds())

    ramp_in = 1.0 if ramp_in_sec <= 0 else min(1.0, elapsed_sec / ramp_in_sec)
    ramp_out = 1.0 if ramp_out_sec <= 0 else min(1.0, remaining_sec / ramp_out_sec)
    return max(0.0, min(ramp_in, ramp_out))


def apply_timed_events(
    controls: list[FeederControlInput],
    settings: SimulatorSettings,
    active_events: list[ActiveTimedEvent],
    now: str,
) -> tuple[list[FeederControlInput], SimulatorSettings, list[ActiveTimedEvent]]:
    effective_controls = {control.id: control.model_copy(deep=True) for control in controls}
    effective_settings = settings.model_copy(deep=True)
    still_active: list[ActiveTimedEvent] = []

    for active_event in active_events:
        definition = TIMED_EVENT_LIBRARY.get(active_event.id)
        if definition is None:
            continue
        if _parse_timestamp(now) >= _parse_timestamp(active_event.endsAt):
            continue

        strength = _event_strength(
            active_event,
            now=now,
            ramp_in_sec=int(definition.get("rampInSec", 0)),
            ramp_out_sec=int(definition.get("rampOutSec", 0)),
        )
        if strength <= 0:
            still_active.append(active_event)
            continue

        for feeder_id, effect in definition.get("effects", {}).items():
            control = effective_controls.get(feeder_id)
            if control is None:
                continue

            updates: dict[str, float] = {}
            if "loadMultiplier" in effect:
                multiplier = 1.0 + ((float(effect["loadMultiplier"]) - 1.0) * strength)
                updates["loadKw"] = round(control.loadKw * multiplier, 1)
            if "reactiveMultiplier" in effect:
                multiplier = 1.0 + ((float(effect["reactiveMultiplier"]) - 1.0) * strength)
                updates["reactivePowerKvar"] = round(control.reactivePowerKvar * multiplier, 1)
            if "solarMultiplier" in effect:
                multiplier = 1.0 + ((float(effect["solarMultiplier"]) - 1.0) * strength)
                updates["solarKw"] = round(control.solarKw * multiplier, 1)
            if "waterFlowMultiplier" in effect:
                multiplier = 1.0 + ((float(effect["waterFlowMultiplier"]) - 1.0) * strength)
                updates["waterFlowPercent"] = round(control.waterFlowPercent * multiplier, 1)
            if "waterFlowDelta" in effect:
                updates["waterFlowPercent"] = round(
                    control.waterFlowPercent + (float(effect["waterFlowDelta"]) * strength),
                    1,
                )
            if "phaseImbalanceDelta" in effect:
                updates["phaseImbalancePercent"] = round(
                    control.phaseImbalancePercent + (float(effect["phaseImbalanceDelta"]) * strength),
                    1,
                )

            effective_controls[feeder_id] = control.model_copy(update=updates)

        if "ambientTempDelta" in definition:
            effective_settings = effective_settings.model_copy(
                update={
                    "ambientTempC": round(
                        effective_settings.ambientTempC + (float(definition["ambientTempDelta"]) * strength),
                        1,
                    )
                }
            )

        still_active.append(active_event)

    return list(effective_controls.values()), effective_settings, still_active
