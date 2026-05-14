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


def _get_reclose_block_reason(
    feeder: FeederTelemetry,
    control: FeederControlInput,
    object_alarms: list[Alarm],
) -> str | None:
    if feeder.type == "hydro_generation":
        if (feeder.waterFlowPercent or 0.0) < 24:
            return "Closing blocked: water flow is below minimum start threshold for hydro generation."

        if any(
            alarm.title in {"Low water flow", "Intake restriction suspected"}
            for alarm in object_alarms
        ):
            return "Closing blocked: hydro-specific alarms indicate that water intake or flow is not yet stable."

    if control.faultMode == FaultMode.FORCED_TRIP:
        return "Closing blocked: a forced trip condition is still present."

    if control.faultMode == FaultMode.SENSOR_FAULT:
        return "Closing blocked: a sensor fault is still present."

    if control.faultMode == FaultMode.OVERLOAD:
        overload_alarm_titles = {
            "Protection trip threshold exceeded",
            "Overload warning",
        }
        has_active_overload_alarm = any(alarm.title in overload_alarm_titles for alarm in object_alarms)
        if has_active_overload_alarm or feeder.derived.utilizationPercent >= feeder.protection.warningPercent:
            return "Closing blocked: the overload condition has not cleared yet."

    return None


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
    reclose_block_reason = _get_reclose_block_reason(
        feeder=feeder,
        control=control,
        object_alarms=object_alarms,
    )
    if reclose_block_reason is not None:
        reasons.append(reclose_block_reason)
    if unacknowledged_critical_alarms:
        reasons.append("Closing blocked: an unacknowledged critical alarm is active.")
    if any(alarm.title == "Communication degraded" for alarm in object_alarms):
        reasons.append("Closing blocked: the feeder has a communication-quality alarm.")
    if feeder.type == "hydro_generation" and feeder.quality == DataQuality.ESTIMATED:
        reasons.append("Closing blocked: hydro telemetry is estimated and intake conditions should be inspected first.")

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
