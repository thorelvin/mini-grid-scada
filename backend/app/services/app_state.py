from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
from uuid import uuid4

from backend.app.config import settings
from backend.app.domain.enums import AlarmState, BreakerStatus, CommandAction, FaultMode
from backend.app.domain.models import (
    Alarm,
    BreakerCommandRequest,
    CommandResult,
    DashboardPayload,
    DashboardTrends,
    Event,
    FeederControlInput,
    FeederControlPatch,
    ScenarioSummary,
    SimulatorSettings,
    SimulatorSettingsPatch,
    StationSnapshot,
    StationTopology,
    SystemHealth,
    TrendPoint,
    TrendSeries,
)
from backend.app.services.command_service import evaluate_breaker_command
from simulator.scenarios import apply_scenario_to_baseline


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _alarm_key(alarm: Alarm) -> str:
    return f"{alarm.objectId}:{alarm.title}"


def _trend_series(
    series_id: str,
    label: str,
    unit: str,
    values: list[tuple[str, float]],
    threshold_low: float | None = None,
    threshold_high: float | None = None,
) -> TrendSeries:
    points = [TrendPoint(timestamp=timestamp, value=value) for timestamp, value in values]
    latest_value = values[-1][1] if values else 0.0
    return TrendSeries(
        id=series_id,
        label=label,
        unit=unit,
        latestValue=latest_value,
        thresholdLow=threshold_low,
        thresholdHigh=threshold_high,
        points=points,
    )


def _build_trends(history: list[StationSnapshot]) -> DashboardTrends:
    voltage_series: list[TrendSeries] = []
    current_series: list[TrendSeries] = []

    feeder_ids = ("F1", "F2", "F3", "F4")
    for feeder_id in feeder_ids:
        voltage_points: list[tuple[str, float]] = []
        current_points: list[tuple[str, float]] = []
        for snapshot in history:
            feeder = next((item for item in snapshot.feeders if item.id == feeder_id), None)
            if feeder is None:
                continue
            voltage_points.append((snapshot.timestamp, feeder.voltage.l2))
            current_points.append(
                (
                    snapshot.timestamp,
                    max(feeder.current.l1, feeder.current.l2, feeder.current.l3),
                )
            )

        voltage_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="V",
                values=voltage_points,
                threshold_low=207.0,
                threshold_high=253.0,
            )
        )
        current_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="A",
                values=current_points,
            )
        )

    transformer_values = [
        (snapshot.timestamp, snapshot.transformer.loadPercent)
        for snapshot in history
    ]
    transformer_series = [
        _trend_series(
            series_id="T1",
            label="T1",
            unit="%",
            values=transformer_values,
            threshold_high=100.0,
        )
    ]

    return DashboardTrends(
        voltageL2=voltage_series,
        currentMax=current_series,
        transformerLoad=transformer_series,
    )


class AppState:
    def __init__(
        self,
        topology: StationTopology,
        controls: list[FeederControlInput],
        available_scenarios: list[ScenarioSummary],
    ) -> None:
        self._lock = asyncio.Lock()
        self._topology = topology
        self._controls = {control.id: control for control in controls}
        self._default_controls = {control.id: control.model_copy(deep=True) for control in controls}
        self._simulator_settings = SimulatorSettings()
        self._default_simulator_settings = self._simulator_settings.model_copy(deep=True)
        self._snapshot: StationSnapshot | None = None
        self._snapshot_history: deque[StationSnapshot] = deque(maxlen=240)
        self._active_alarms: list[Alarm] = []
        self._events: deque[Event] = deque(maxlen=120)
        self._simulator_running = False
        self._last_snapshot_at: str | None = None
        self._websocket_clients = 0
        self._available_scenarios = available_scenarios
        self._active_scenario_id: str | None = "normal"
        self._system_started_at = _now_iso()
        self._active_scenario_started_at = self._system_started_at
        self._last_command_result: CommandResult | None = None

        self._events.append(
            Event(
                id=f"evt-{uuid4().hex[:10]}",
                timestamp=_now_iso(),
                type="system",
                source="backend",
                description="SCADA scaffold initialized.",
            )
        )

    async def set_simulator_running(self, running: bool) -> None:
        async with self._lock:
            self._simulator_running = running

    async def set_websocket_clients(self, count: int) -> None:
        async with self._lock:
            self._websocket_clients = count

    async def increment_websocket_clients(self) -> int:
        async with self._lock:
            self._websocket_clients += 1
            return self._websocket_clients

    async def decrement_websocket_clients(self) -> int:
        async with self._lock:
            self._websocket_clients = max(0, self._websocket_clients - 1)
            return self._websocket_clients

    async def update_frame(self, snapshot: StationSnapshot, alarms: list[Alarm]) -> None:
        async with self._lock:
            previous_snapshot = self._snapshot
            previous_alarms_by_key = {_alarm_key(alarm): alarm for alarm in self._active_alarms}
            normalized_alarms: list[Alarm] = []

            for alarm in alarms:
                key = _alarm_key(alarm)
                previous_alarm = previous_alarms_by_key.get(key)
                if previous_alarm is not None:
                    normalized_alarms.append(
                        alarm.model_copy(
                            update={
                                "id": previous_alarm.id,
                                "createdAt": previous_alarm.createdAt,
                                "state": previous_alarm.state,
                            }
                        )
                    )
                else:
                    normalized_alarms.append(alarm)
                    self._events.appendleft(
                        Event(
                            id=f"evt-{uuid4().hex[:10]}",
                            timestamp=snapshot.timestamp,
                            type="alarm_raised",
                            source=alarm.objectId,
                            description=f"{alarm.severity.upper()} alarm raised: {alarm.title}.",
                        )
                    )

            normalized_by_key = {_alarm_key(alarm): alarm for alarm in normalized_alarms}
            for key, previous_alarm in previous_alarms_by_key.items():
                if key not in normalized_by_key:
                    self._events.appendleft(
                        Event(
                            id=f"evt-{uuid4().hex[:10]}",
                            timestamp=snapshot.timestamp,
                            type="alarm_cleared",
                            source=previous_alarm.objectId,
                            description=f"Alarm returned to normal: {previous_alarm.title}.",
                        )
                    )

            if previous_snapshot is not None:
                previous_feeders = {feeder.id: feeder for feeder in previous_snapshot.feeders}
                for feeder in snapshot.feeders:
                    previous_feeder = previous_feeders.get(feeder.id)
                    if previous_feeder is None:
                        continue
                    if feeder.breakerStatus != previous_feeder.breakerStatus:
                        self._events.appendleft(
                            Event(
                                id=f"evt-{uuid4().hex[:10]}",
                                timestamp=snapshot.timestamp,
                                type="breaker_state",
                                source=feeder.id,
                                description=(
                                    f"Breaker state changed for {feeder.id}: "
                                    f"{previous_feeder.breakerStatus} -> {feeder.breakerStatus}."
                                ),
                            )
                        )
                    if feeder.quality != previous_feeder.quality:
                        self._events.appendleft(
                            Event(
                                id=f"evt-{uuid4().hex[:10]}",
                                timestamp=snapshot.timestamp,
                                type="data_quality",
                                source=feeder.id,
                                description=(
                                    f"Data quality changed for {feeder.id}: "
                                    f"{previous_feeder.quality} -> {feeder.quality}."
                                ),
                            )
                        )

            self._snapshot = snapshot
            self._snapshot_history.append(snapshot)
            self._active_alarms = normalized_alarms
            self._last_snapshot_at = snapshot.timestamp

    async def add_event(self, event_type: str, source: str, description: str) -> None:
        async with self._lock:
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=_now_iso(),
                    type=event_type,
                    source=source,
                    description=description,
                )
            )

    async def get_topology(self) -> StationTopology:
        async with self._lock:
            return self._topology

    async def get_snapshot(self) -> StationSnapshot:
        async with self._lock:
            if self._snapshot is None:
                raise RuntimeError("Snapshot has not been initialized yet.")
            return self._snapshot

    async def get_active_alarms(self) -> list[Alarm]:
        async with self._lock:
            return list(self._active_alarms)

    async def get_events(self, limit: int = 50) -> list[Event]:
        async with self._lock:
            return list(self._events)[:limit]

    async def get_controls(self) -> list[FeederControlInput]:
        async with self._lock:
            return list(self._controls.values())

    async def get_simulator_settings(self) -> SimulatorSettings:
        async with self._lock:
            return self._simulator_settings

    async def get_available_scenarios(self) -> list[ScenarioSummary]:
        async with self._lock:
            return list(self._available_scenarios)

    async def get_active_scenario_id(self) -> str | None:
        async with self._lock:
            return self._active_scenario_id

    async def update_control(self, feeder_id: str, patch: FeederControlPatch) -> FeederControlInput:
        updates = patch.model_dump(exclude_none=True)
        async with self._lock:
            control = self._controls.get(feeder_id)
            if control is None:
                raise KeyError(feeder_id)
            updated = control.model_copy(update=updates)
            self._controls[feeder_id] = updated
            self._active_scenario_id = "custom"
            self._active_scenario_started_at = _now_iso()
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=_now_iso(),
                    type="control_update",
                    source=feeder_id,
                    description=f"Updated feeder controls for {feeder_id}: {', '.join(sorted(updates.keys()))}.",
                )
            )
            return updated

    async def execute_breaker_command(
        self,
        action: CommandAction,
        request: BreakerCommandRequest,
    ) -> CommandResult:
        async with self._lock:
            if self._snapshot is None:
                raise RuntimeError("Snapshot has not been initialized yet.")

            feeder = next((item for item in self._snapshot.feeders if item.id == request.objectId), None)
            if feeder is None:
                raise KeyError(request.objectId)

            control = self._controls.get(request.objectId)
            if control is None:
                raise KeyError(request.objectId)

            result = evaluate_breaker_command(
                action=action,
                request=request,
                feeder=feeder,
                control=control,
                active_alarms=self._active_alarms,
            )

            if result.allowed:
                updates: dict[str, object] = {"breakerStatus": result.breakerStatusAfter}
                if action == CommandAction.OPEN_BREAKER and control.faultMode == FaultMode.NORMAL:
                    updates["faultMode"] = FaultMode.PLANNED_OUTAGE
                if action == CommandAction.CLOSE_BREAKER and control.faultMode in {
                    FaultMode.PLANNED_OUTAGE,
                    FaultMode.FORCED_TRIP,
                }:
                    updates["faultMode"] = FaultMode.NORMAL

                updated = control.model_copy(update=updates)
                self._controls[request.objectId] = updated
                self._active_scenario_id = "custom"
                self._active_scenario_started_at = result.timestamp
                self._events.appendleft(
                    Event(
                        id=f"evt-{uuid4().hex[:10]}",
                        timestamp=result.timestamp,
                        type="command_executed",
                        source=request.objectId,
                        description=f"Command executed: {result.action} by {request.operator}.",
                    )
                )
            else:
                self._events.appendleft(
                    Event(
                        id=f"evt-{uuid4().hex[:10]}",
                        timestamp=result.timestamp,
                        type="command_blocked",
                        source=request.objectId,
                        description=f"Command blocked: {result.message}",
                    )
                )

            self._last_command_result = result
            return result

    async def update_simulator_settings(self, patch: SimulatorSettingsPatch) -> SimulatorSettings:
        updates = patch.model_dump(exclude_none=True)
        async with self._lock:
            self._simulator_settings = self._simulator_settings.model_copy(update=updates)
            self._active_scenario_id = "custom"
            self._active_scenario_started_at = _now_iso()
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=_now_iso(),
                    type="simulator_update",
                    source="simulator",
                    description="Updated simulator settings.",
                )
            )
            return self._simulator_settings

    async def apply_scenario(self, scenario_id: str) -> tuple[list[FeederControlInput], SimulatorSettings]:
        async with self._lock:
            next_controls, next_settings, scenario_summary = apply_scenario_to_baseline(
                scenario_id=scenario_id,
                baseline_controls=list(self._default_controls.values()),
                baseline_settings=self._default_simulator_settings,
            )
            self._controls = {control.id: control for control in next_controls}
            self._simulator_settings = next_settings
            self._active_scenario_id = scenario_summary.id
            self._active_scenario_started_at = _now_iso()
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=_now_iso(),
                    type="scenario_start",
                    source=scenario_summary.id,
                    description=f"Scenario activated: {scenario_summary.name}.",
                )
            )
            return list(self._controls.values()), self._simulator_settings

    async def reset_simulation(self) -> tuple[list[FeederControlInput], SimulatorSettings]:
        return await self.apply_scenario("normal")

    async def acknowledge_alarm(self, alarm_id: str) -> Alarm:
        async with self._lock:
            for index, alarm in enumerate(self._active_alarms):
                if alarm.id != alarm_id:
                    continue
                updated = alarm.model_copy(update={"state": AlarmState.ACKNOWLEDGED})
                self._active_alarms[index] = updated
                self._events.appendleft(
                    Event(
                        id=f"evt-{uuid4().hex[:10]}",
                        timestamp=_now_iso(),
                        type="alarm_acknowledged",
                        source=alarm.objectId,
                        description=f"Alarm acknowledged: {alarm.title}.",
                    )
                )
                return updated
        raise KeyError(alarm_id)

    async def acknowledge_alarms(self, object_id: str | None = None) -> list[Alarm]:
        async with self._lock:
            updated_alarms: list[Alarm] = []
            for index, alarm in enumerate(self._active_alarms):
                if alarm.state == AlarmState.ACKNOWLEDGED:
                    continue
                if object_id is not None and alarm.objectId != object_id:
                    continue

                updated = alarm.model_copy(update={"state": AlarmState.ACKNOWLEDGED})
                self._active_alarms[index] = updated
                updated_alarms.append(updated)

            if updated_alarms:
                target_label = object_id if object_id is not None else "system"
                self._events.appendleft(
                    Event(
                        id=f"evt-{uuid4().hex[:10]}",
                        timestamp=_now_iso(),
                        type="alarm_acknowledged_bulk",
                        source=target_label,
                        description=(
                            f"Acknowledged {len(updated_alarms)} active alarm"
                            f"{'' if len(updated_alarms) == 1 else 's'}"
                            + (f" for {object_id}." if object_id is not None else ".")
                        ),
                    )
                )

            return updated_alarms

    async def get_health(self) -> SystemHealth:
        async with self._lock:
            return SystemHealth(
                timestamp=_now_iso(),
                apiStatus="ok",
                simulatorRunning=self._simulator_running,
                updateIntervalSec=settings.update_interval_sec,
                lastSnapshotAt=self._last_snapshot_at,
                websocketClients=self._websocket_clients,
            )

    async def get_dashboard(self) -> DashboardPayload:
        snapshot = await self.get_snapshot()
        topology = await self.get_topology()
        active_alarms = await self.get_active_alarms()
        recent_events = await self.get_events(limit=24)
        health = await self.get_health()
        controls = await self.get_controls()
        simulator_settings = await self.get_simulator_settings()
        available_scenarios = await self.get_available_scenarios()
        active_scenario_id = await self.get_active_scenario_id()
        async with self._lock:
            trends = _build_trends(list(self._snapshot_history))
            system_started_at = self._system_started_at
            active_scenario_started_at = self._active_scenario_started_at
            last_command_result = self._last_command_result
        return DashboardPayload(
            topology=topology,
            snapshot=snapshot,
            activeAlarms=active_alarms,
            recentEvents=recent_events,
            health=health,
            controls=controls,
            simulatorSettings=simulator_settings,
            availableScenarios=available_scenarios,
            activeScenarioId=active_scenario_id,
            activeScenarioStartedAt=active_scenario_started_at,
            systemStartedAt=system_started_at,
            trends=trends,
            lastCommandResult=last_command_result,
        )
