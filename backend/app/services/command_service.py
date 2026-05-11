from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from backend.app.domain.enums import (
    AlarmSeverity,
    AlarmState,
    BreakerStatus,
    CommandAction,
    DataQuality,
    FaultMode,
)
from backend.app.domain.models import (
    Alarm,
    BreakerCommandRequest,
    CommandResult,
    FeederControlInput,
    FeederTelemetry,
    InterlockDecision,
)


BLOCKING_QUALITIES = {DataQuality.STALE, DataQuality.INVALID, DataQuality.LOST}
BLOCKING_FAULTS = {FaultMode.OVERLOAD, FaultMode.SENSOR_FAULT, FaultMode.FORCED_TRIP}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def evaluate_breaker_command(
    action: CommandAction,
    request: BreakerCommandRequest,
    feeder: FeederTelemetry,
    control: FeederControlInput,
    active_alarms: list[Alarm],
) -> CommandResult:
    reasons: list[str] = []
    object_alarms = [alarm for alarm in active_alarms if alarm.objectId == feeder.id]
    unacknowledged_critical_alarms = [
        alarm
        for alarm in active_alarms
        if alarm.severity == AlarmSeverity.CRITICAL and alarm.state != AlarmState.ACKNOWLEDGED
    ]

    if action == CommandAction.OPEN_BREAKER:
        affected_customers = feeder.customers if feeder.breakerStatus == BreakerStatus.CLOSED else 0
        critical_customers = feeder.criticalCustomers if feeder.breakerStatus == BreakerStatus.CLOSED else 0

        if feeder.breakerStatus != BreakerStatus.CLOSED:
            reasons.append("Opening blocked: breaker is not currently closed.")
        if not request.reason or not request.reason.strip():
            reasons.append("Opening blocked: an operator reason is required.")
        if affected_customers > 0 and not request.confirmImpact:
            reasons.append(
                f"Opening blocked: confirm that {affected_customers} customers will be disconnected."
            )

        allowed = not reasons
        interlock = InterlockDecision(
            allowed=allowed,
            reasons=reasons,
            affectedCustomers=affected_customers,
            criticalCustomers=critical_customers,
        )
        return CommandResult(
            id=f"cmd-{uuid4().hex[:12]}",
            timestamp=_now_iso(),
            action=action,
            objectId=feeder.id,
            objectName=feeder.name,
            operator=request.operator,
            reason=request.reason,
            allowed=allowed,
            executed=allowed,
            message=(
                f"Breaker opened for {feeder.id}. {affected_customers} customers affected."
                if allowed
                else reasons[0]
            ),
            breakerStatusBefore=feeder.breakerStatus,
            breakerStatusAfter=BreakerStatus.OPEN if allowed else feeder.breakerStatus,
            interlock=interlock,
        )

    affected_customers = 0
    critical_customers = 0

    if feeder.breakerStatus == BreakerStatus.CLOSED:
        reasons.append("Closing blocked: breaker is already closed.")
    if control.communicationState in BLOCKING_QUALITIES:
        reasons.append("Closing blocked: telemetry quality is degraded.")
    if control.faultMode in BLOCKING_FAULTS:
        reasons.append("Closing blocked: an active fault or trip condition is still present.")
    if unacknowledged_critical_alarms:
        reasons.append("Closing blocked: an unacknowledged critical alarm is active.")
    if any(alarm.title == "Communication degraded" for alarm in object_alarms):
        reasons.append("Closing blocked: the feeder has a communication-quality alarm.")

    allowed = not reasons
    interlock = InterlockDecision(
        allowed=allowed,
        reasons=reasons,
        affectedCustomers=affected_customers,
        criticalCustomers=critical_customers,
    )
    return CommandResult(
        id=f"cmd-{uuid4().hex[:12]}",
        timestamp=_now_iso(),
        action=action,
        objectId=feeder.id,
        objectName=feeder.name,
        operator=request.operator,
        reason=request.reason,
        allowed=allowed,
        executed=allowed,
        message=(
            f"Breaker closed for {feeder.id}. Supply restored."
            if allowed
            else reasons[0]
        ),
        breakerStatusBefore=feeder.breakerStatus,
        breakerStatusAfter=BreakerStatus.CLOSED if allowed else feeder.breakerStatus,
        interlock=interlock,
    )
