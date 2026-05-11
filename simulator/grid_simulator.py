from __future__ import annotations

from datetime import datetime, timezone
from math import sqrt

from backend.app.domain.enums import AssetKind, BreakerStatus, DataQuality, FaultMode, PowerDirection
from backend.app.domain.models import (
    Asset,
    DerivedMetrics,
    FeederControlInput,
    FeederTelemetry,
    PhaseValues,
    ProtectionSettings,
    StationSnapshot,
    StationTopology,
    TopologyEdge,
    TransformerTelemetry,
)
from simulator.profiles import FEEDER_PROFILES


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_demo_topology(station_id: str) -> StationTopology:
    assets = [
        Asset(id=station_id, name="Mini Grid SCADA Station", kind=AssetKind.STATION),
        Asset(id="BRK-IN", name="Inntaksbryter", kind=AssetKind.BREAKER, parentId=station_id),
        Asset(id="T1", name="Trafo T1 22/0.4 kV", kind=AssetKind.TRANSFORMER, parentId=station_id),
        Asset(id="BUS-01", name="0.4 kV samleskinne", kind=AssetKind.BUSBAR, parentId="T1"),
        Asset(id="F1", name=FEEDER_PROFILES["F1"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
        Asset(id="F2", name=FEEDER_PROFILES["F2"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
        Asset(id="F3", name=FEEDER_PROFILES["F3"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
        Asset(id="F4", name=FEEDER_PROFILES["F4"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
    ]

    edges = [
        TopologyEdge(sourceId=station_id, targetId="BRK-IN", relation="contains"),
        TopologyEdge(sourceId="BRK-IN", targetId="T1", relation="feeds"),
        TopologyEdge(sourceId="T1", targetId="BUS-01", relation="steps_down_to"),
        TopologyEdge(sourceId="BUS-01", targetId="F1", relation="supplies"),
        TopologyEdge(sourceId="BUS-01", targetId="F2", relation="supplies"),
        TopologyEdge(sourceId="BUS-01", targetId="F3", relation="supplies"),
        TopologyEdge(sourceId="BUS-01", targetId="F4", relation="supplies"),
    ]

    return StationTopology(stationId=station_id, assets=assets, edges=edges)


def create_default_controls() -> list[FeederControlInput]:
    controls: list[FeederControlInput] = []

    for feeder_id, profile in FEEDER_PROFILES.items():
        controls.append(
            FeederControlInput(
                id=feeder_id,
                loadKw=float(profile["defaultLoadKw"]),
                reactivePowerKvar=float(profile["defaultReactivePowerKvar"]),
                phaseImbalancePercent=6.0 if feeder_id == "F1" else 3.0,
                solarKw=float(profile.get("defaultSolarKw", 0.0)),
            )
        )

    return controls


def _quality_from_control(control: FeederControlInput) -> DataQuality:
    if control.faultMode == FaultMode.SENSOR_FAULT:
        return DataQuality.INVALID
    return control.communicationState


def _power_direction(net_kw: float) -> PowerDirection:
    if net_kw > 1:
        return PowerDirection.IMPORT
    if net_kw < -1:
        return PowerDirection.EXPORT
    return PowerDirection.NEUTRAL


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _phase_values(mean_value: float, imbalance_percent: float, invert: bool = False) -> PhaseValues:
    spread = mean_value * (imbalance_percent / 100.0) * (0.75 if invert else 1.0)
    return PhaseValues(
        l1=round(max(0.0, mean_value + spread), 1),
        l2=round(max(0.0, mean_value), 1),
        l3=round(max(0.0, mean_value - spread), 1),
    )


def _build_feeder_telemetry(
    control: FeederControlInput,
    timestamp: str,
    nominal_phase_voltage_v: float,
    nominal_line_voltage_v: float,
) -> FeederTelemetry:
    profile = FEEDER_PROFILES[control.id]
    quality = _quality_from_control(control)
    breaker_status = control.breakerStatus

    load_kw = control.loadKw
    reactive_kvar = control.reactivePowerKvar
    solar_kw = control.solarKw

    if control.faultMode == FaultMode.OVERLOAD:
        load_kw *= 1.25
        reactive_kvar *= 1.15

    if control.faultMode == FaultMode.FORCED_TRIP:
        breaker_status = BreakerStatus.TRIPPED
    elif control.faultMode == FaultMode.PLANNED_OUTAGE:
        breaker_status = BreakerStatus.OPEN

    net_kw = load_kw - solar_kw
    apparent_kva = sqrt((net_kw**2) + (reactive_kvar**2))
    mean_current = (apparent_kva * 1000) / max(sqrt(3) * nominal_line_voltage_v, 1.0)

    if breaker_status != BreakerStatus.CLOSED:
        net_kw = 0.0
        reactive_kvar = 0.0
        mean_current = 0.0
        voltage = PhaseValues(l1=0.0, l2=0.0, l3=0.0)
    else:
        load_pressure = max(net_kw, 0.0) / max(load_kw + 1.0, 1.0)
        solar_lift = max(solar_kw - load_kw, 0.0) / max(profile["ratingA"], 1.0)
        base_voltage = nominal_phase_voltage_v - (mean_current / profile["ratingA"]) * 16.0 + (solar_lift * 4.0)
        base_voltage = _bounded(base_voltage, 188.0, 260.0)
        voltage = _phase_values(base_voltage, control.phaseImbalancePercent / max(load_pressure, 0.35), invert=True)

    current = _phase_values(mean_current, control.phaseImbalancePercent)
    max_current = max(current.l1, current.l2, current.l3)
    utilization = (max_current / profile["ratingA"]) * 100 if profile["ratingA"] else 0.0
    avg_voltage = (voltage.l1 + voltage.l2 + voltage.l3) / 3 if breaker_status == BreakerStatus.CLOSED else 0.0
    voltage_deviation = ((nominal_phase_voltage_v - avg_voltage) / nominal_phase_voltage_v) * 100 if avg_voltage else 100.0

    protection = ProtectionSettings(
        ratingA=profile["ratingA"],
        warningPercent=profile["warningPercent"],
        tripPercent=profile["tripPercent"],
        tripDelaySec=profile["tripDelaySec"],
        lastTripReason="forced_trip" if control.faultMode == FaultMode.FORCED_TRIP else None,
        lastTripAt=timestamp if control.faultMode == FaultMode.FORCED_TRIP else None,
    )

    return FeederTelemetry(
        id=control.id,
        name=profile["name"],
        type=profile["type"],
        timestamp=timestamp,
        breakerStatus=breaker_status,
        voltage=voltage,
        current=current,
        activePowerKw=round(net_kw, 1),
        reactivePowerKvar=round(reactive_kvar, 1),
        customers=int(profile["customers"]),
        criticalCustomers=int(profile["criticalCustomers"]),
        quality=quality,
        protection=protection,
        derived=DerivedMetrics(
            utilizationPercent=round(utilization, 1),
            phaseImbalancePercent=round(control.phaseImbalancePercent, 1),
            voltageDeviationPercent=round(voltage_deviation, 1),
            powerDirection=_power_direction(net_kw),
            affectedCustomers=0 if breaker_status == BreakerStatus.CLOSED else int(profile["customers"]),
        ),
    )


def build_snapshot(
    station_id: str,
    mode: str,
    controls: list[FeederControlInput],
    ambient_temp_c: float,
    nominal_phase_voltage_v: float,
    nominal_line_voltage_v: float,
    transformer_rating_kva: float,
) -> StationSnapshot:
    timestamp = _now_iso()
    feeders = [
        _build_feeder_telemetry(
            control=control,
            timestamp=timestamp,
            nominal_phase_voltage_v=nominal_phase_voltage_v,
            nominal_line_voltage_v=nominal_line_voltage_v,
        )
        for control in controls
    ]

    total_kw = sum(feeder.activePowerKw for feeder in feeders)
    total_kvar = sum(feeder.reactivePowerKvar for feeder in feeders)
    apparent_kva = sqrt((total_kw**2) + (total_kvar**2))
    load_percent = (apparent_kva / transformer_rating_kva) * 100 if transformer_rating_kva else 0.0
    avg_phase_voltage = sum((feeder.voltage.l1 + feeder.voltage.l2 + feeder.voltage.l3) / 3 for feeder in feeders) / max(len(feeders), 1)
    communication_ok = all(feeder.quality not in {DataQuality.INVALID, DataQuality.LOST} for feeder in feeders)

    transformer = TransformerTelemetry(
        id="T1",
        timestamp=timestamp,
        loadPercent=round(load_percent, 1),
        activePowerKw=round(total_kw, 1),
        apparentPowerKva=round(apparent_kva, 1),
        secondaryVoltageV=round(avg_phase_voltage * sqrt(3), 1),
        topOilTempC=round(ambient_temp_c + 34.0 + load_percent * 0.32, 1),
        communicationOk=communication_ok,
        quality=DataQuality.GOOD if communication_ok else DataQuality.LOST,
    )

    return StationSnapshot(
        stationId=station_id,
        timestamp=timestamp,
        mode=mode,
        transformer=transformer,
        feeders=feeders,
    )
