from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from backend.app.domain.enums import AlarmSeverity, AlarmState, BreakerStatus, DataQuality
from backend.app.domain.models import Alarm, StationSnapshot


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _alarm(
    object_id: str,
    object_name: str,
    severity: AlarmSeverity,
    title: str,
    message: str,
    measured: float | None = None,
    threshold: float | None = None,
    unit: str | None = None,
) -> Alarm:
    return Alarm(
        id=f"alarm-{uuid4().hex[:12]}",
        createdAt=_now_iso(),
        objectId=object_id,
        objectName=object_name,
        severity=severity,
        state=AlarmState.ACTIVE,
        title=title,
        message=message,
        measuredValue=measured,
        threshold=threshold,
        unit=unit,
    )


def evaluate_snapshot(snapshot: StationSnapshot) -> list[Alarm]:
    alarms: list[Alarm] = []

    for feeder in snapshot.feeders:
        min_voltage = min(feeder.voltage.l1, feeder.voltage.l2, feeder.voltage.l3)
        max_voltage = max(feeder.voltage.l1, feeder.voltage.l2, feeder.voltage.l3)
        utilization = feeder.derived.utilizationPercent

        if feeder.quality in {DataQuality.LOST, DataQuality.INVALID, DataQuality.STALE}:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.HIGH,
                    "Communication degraded",
                    "Telemetry quality is degraded and command handling should stay conservative.",
                )
            )

        if feeder.breakerStatus == BreakerStatus.TRIPPED:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.CRITICAL,
                    "Breaker tripped",
                    "Feeder breaker is tripped and reclose should be blocked until the fault is cleared.",
                )
            )

        if min_voltage > 0 and min_voltage < 207:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.HIGH,
                    "Undervoltage",
                    "One or more phases are below the low-voltage threshold.",
                    measured=min_voltage,
                    threshold=207,
                    unit="V",
                )
            )

        if max_voltage > 253:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.MEDIUM,
                    "Overvoltage",
                    "Voltage is above the recommended limit and may be driven by export or light loading.",
                    measured=max_voltage,
                    threshold=253,
                    unit="V",
                )
            )

        if feeder.derived.phaseImbalancePercent > 25:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.HIGH,
                    "Phase imbalance",
                    "Current spread between phases is above the configured imbalance threshold.",
                    measured=feeder.derived.phaseImbalancePercent,
                    threshold=25,
                    unit="%",
                )
            )

        if utilization >= feeder.protection.tripPercent:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.CRITICAL,
                    "Protection trip threshold exceeded",
                    "The feeder has exceeded its trip threshold and should move to a tripped state if sustained.",
                    measured=utilization,
                    threshold=feeder.protection.tripPercent,
                    unit="%",
                )
            )
        elif utilization >= feeder.protection.warningPercent:
            alarms.append(
                _alarm(
                    feeder.id,
                    feeder.name,
                    AlarmSeverity.HIGH,
                    "Overload warning",
                    "Current utilization is approaching the protection trip threshold.",
                    measured=utilization,
                    threshold=feeder.protection.warningPercent,
                    unit="%",
                )
            )

    if snapshot.transformer.topOilTempC > 85:
        alarms.append(
            _alarm(
                snapshot.transformer.id,
                "Transformer T1",
                AlarmSeverity.HIGH,
                "Transformer temperature high",
                "The simulated transformer top-oil temperature is above the configured high limit.",
                measured=snapshot.transformer.topOilTempC,
                threshold=85,
                unit="C",
            )
        )

    return alarms

