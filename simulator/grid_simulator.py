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
    StationBreakerTelemetry,
    StationSnapshot,
    StationTopology,
    TopologyEdge,
    TransformerTelemetry,
)
from simulator.profiles import FEEDER_PROFILES

SERVICE_VOLTAGE_DROP_AT_FULL_LOAD_V = 10.0
VOLTAGE_IMBALANCE_SPREAD_FACTOR = 0.28


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_demo_topology(station_id: str) -> StationTopology:
    assets = [
        Asset(id=station_id, name="Mini Grid SCADA Station", kind=AssetKind.STATION),
        Asset(id="BRK-IN", name="Inntaksbryter", kind=AssetKind.BREAKER, parentId=station_id),
        Asset(id="T1", name="Trafo T1 22/0.4 kV", kind=AssetKind.TRANSFORMER, parentId=station_id),
        Asset(id="LV-BRK", name="Lavspent hovedbryter", kind=AssetKind.BREAKER, parentId="T1"),
        Asset(id="BUS-01", name="0.4 kV samleskinne", kind=AssetKind.BUSBAR, parentId="LV-BRK"),
        Asset(id="F1", name=FEEDER_PROFILES["F1"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
        Asset(id="F2", name=FEEDER_PROFILES["F2"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
        Asset(id="F3", name=FEEDER_PROFILES["F3"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
        Asset(id="F4", name=FEEDER_PROFILES["F4"]["name"], kind=AssetKind.FEEDER, parentId="BUS-01"),
    ]

    edges = [
        TopologyEdge(sourceId=station_id, targetId="BRK-IN", relation="contains"),
        TopologyEdge(sourceId="BRK-IN", targetId="T1", relation="feeds"),
        TopologyEdge(sourceId="T1", targetId="LV-BRK", relation="steps_down_to"),
        TopologyEdge(sourceId="LV-BRK", targetId="BUS-01", relation="feeds"),
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


def _phase_values(mean_value: float, imbalance_percent: float, spread_factor: float = 1.0) -> PhaseValues:
    spread = mean_value * (imbalance_percent / 100.0) * spread_factor
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
    supply_available: bool,
    service_target_phase_voltage_v: float | None = None,
) -> FeederTelemetry:
    profile = FEEDER_PROFILES[control.id]
    quality = _quality_from_control(control)
    breaker_status = control.breakerStatus
    last_trip_reason: str | None = None
    last_trip_at: str | None = None
    service_target = service_target_phase_voltage_v if service_target_phase_voltage_v is not None else nominal_phase_voltage_v + 2.0

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
    potential_current = _phase_values(mean_current, control.phaseImbalancePercent)
    potential_max_current = max(potential_current.l1, potential_current.l2, potential_current.l3)
    potential_utilization = (potential_max_current / profile["ratingA"]) * 100 if profile["ratingA"] else 0.0

    if breaker_status == BreakerStatus.CLOSED and potential_utilization >= profile["tripPercent"]:
        breaker_status = BreakerStatus.TRIPPED
        last_trip_reason = "overload"
        last_trip_at = timestamp

    if breaker_status != BreakerStatus.CLOSED or not supply_available:
        net_kw = 0.0
        reactive_kvar = 0.0
        mean_current = 0.0
        voltage = PhaseValues(l1=0.0, l2=0.0, l3=0.0)
    else:
        load_pressure = max(net_kw, 0.0) / max(load_kw + 1.0, 1.0)
        solar_lift = max(solar_kw - load_kw, 0.0) / max(profile["ratingA"], 1.0)
        base_voltage = service_target - (mean_current / profile["ratingA"]) * SERVICE_VOLTAGE_DROP_AT_FULL_LOAD_V + (solar_lift * 4.0)
        base_voltage = _bounded(base_voltage, 188.0, 260.0)
        voltage = _phase_values(
            base_voltage,
            control.phaseImbalancePercent / max(load_pressure, 0.35),
            spread_factor=VOLTAGE_IMBALANCE_SPREAD_FACTOR,
        )

    current = _phase_values(mean_current, control.phaseImbalancePercent)
    max_current = max(current.l1, current.l2, current.l3)
    utilization = (max_current / profile["ratingA"]) * 100 if profile["ratingA"] else 0.0
    display_utilization = utilization
    if breaker_status != BreakerStatus.CLOSED:
        display_utilization = (
            potential_utilization if control.faultMode == FaultMode.OVERLOAD or last_trip_reason == "overload" else 0.0
        )
    avg_voltage = (voltage.l1 + voltage.l2 + voltage.l3) / 3 if breaker_status == BreakerStatus.CLOSED else 0.0
    voltage_deviation = ((nominal_phase_voltage_v - avg_voltage) / nominal_phase_voltage_v) * 100 if avg_voltage else 100.0

    protection = ProtectionSettings(
        ratingA=profile["ratingA"],
        warningPercent=profile["warningPercent"],
        tripPercent=profile["tripPercent"],
        tripDelaySec=profile["tripDelaySec"],
        lastTripReason=(
            last_trip_reason if last_trip_reason is not None else "forced_trip" if control.faultMode == FaultMode.FORCED_TRIP else None
        ),
        lastTripAt=(
            last_trip_at if last_trip_at is not None else timestamp if control.faultMode == FaultMode.FORCED_TRIP else None
        ),
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
            utilizationPercent=round(display_utilization, 1),
            phaseImbalancePercent=round(control.phaseImbalancePercent, 1),
            voltageDeviationPercent=round(voltage_deviation, 1),
            powerDirection=_power_direction(net_kw),
            affectedCustomers=(
                0
                if breaker_status == BreakerStatus.CLOSED and supply_available
                else int(profile["customers"])
            ),
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
    station_breaker_states: dict[str, BreakerStatus] | None = None,
    service_target_phase_voltage_v: float | None = None,
) -> StationSnapshot:
    timestamp = _now_iso()
    station_breaker_states = station_breaker_states or {
        "BRK-IN": BreakerStatus.CLOSED,
        "LV-BRK": BreakerStatus.CLOSED,
    }
    inlet_breaker_status = station_breaker_states.get("BRK-IN", BreakerStatus.CLOSED)
    lv_breaker_status = station_breaker_states.get("LV-BRK", BreakerStatus.CLOSED)
    transformer_energized = inlet_breaker_status == BreakerStatus.CLOSED
    bus_energized = transformer_energized and lv_breaker_status == BreakerStatus.CLOSED
    feeders = [
        _build_feeder_telemetry(
            control=control,
            timestamp=timestamp,
            nominal_phase_voltage_v=nominal_phase_voltage_v,
            nominal_line_voltage_v=nominal_line_voltage_v,
            supply_available=bus_energized,
            service_target_phase_voltage_v=service_target_phase_voltage_v,
        )
        for control in controls
    ]

    total_kw = sum(feeder.activePowerKw for feeder in feeders) if bus_energized else 0.0
    total_kvar = sum(feeder.reactivePowerKvar for feeder in feeders) if bus_energized else 0.0
    apparent_kva = sqrt((total_kw**2) + (total_kvar**2))
    load_percent = (apparent_kva / transformer_rating_kva) * 100 if transformer_rating_kva else 0.0
    no_load_line_voltage = round((service_target_phase_voltage_v or nominal_phase_voltage_v + 2.0) * sqrt(3), 1)
    closed_feeders = [feeder for feeder in feeders if feeder.breakerStatus == BreakerStatus.CLOSED]
    avg_phase_voltage = (
        sum((feeder.voltage.l1 + feeder.voltage.l2 + feeder.voltage.l3) / 3 for feeder in closed_feeders)
        / max(len(closed_feeders), 1)
        if bus_energized and closed_feeders
        else 0.0
    )
    communication_ok = all(feeder.quality not in {DataQuality.INVALID, DataQuality.LOST} for feeder in feeders)

    transformer = TransformerTelemetry(
        id="T1",
        timestamp=timestamp,
        loadPercent=round(load_percent, 1),
        activePowerKw=round(total_kw, 1),
        apparentPowerKva=round(apparent_kva, 1),
        secondaryVoltageV=(
            round(avg_phase_voltage * sqrt(3), 1)
            if bus_energized and closed_feeders
            else no_load_line_voltage if transformer_energized
            else 0.0
        ),
        topOilTempC=round(
            ambient_temp_c + (8.0 if transformer_energized else 2.0) + load_percent * 0.32,
            1,
        ),
        communicationOk=communication_ok,
        quality=DataQuality.GOOD if communication_ok else DataQuality.LOST,
    )

    station_breakers = [
        StationBreakerTelemetry(
            id="BRK-IN",
            name="Inntaksbryter",
            timestamp=timestamp,
            breakerStatus=inlet_breaker_status,
            quality=DataQuality.GOOD,
        ),
        StationBreakerTelemetry(
            id="LV-BRK",
            name="Lavspent hovedbryter",
            timestamp=timestamp,
            breakerStatus=lv_breaker_status,
            quality=DataQuality.GOOD,
        ),
    ]

    return StationSnapshot(
        stationId=station_id,
        timestamp=timestamp,
        mode=mode,
        transformer=transformer,
        stationBreakers=station_breakers,
        feeders=feeders,
    )
