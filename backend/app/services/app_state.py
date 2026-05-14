from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
from math import ceil
from uuid import uuid4

from backend.app.config import settings
from backend.app.domain.enums import AlarmState, BreakerStatus, CommandAction, DataQuality, FaultMode
from backend.app.domain.models import (
    ActiveTimedEvent,
    Alarm,
    BreakerCommandRequest,
    CommandResult,
    DashboardPayload,
    DashboardTrends,
    Event,
    FeederControlInput,
    FeederControlPatch,
    NormalProfileSummary,
    ScenarioSummary,
    SimulatorSettings,
    SimulatorSettingsPatch,
    StationSnapshot,
    StationTopology,
    SystemHealth,
    TimedEventSummary,
    TrendPoint,
    TrendSeries,
    InterlockDecision,
)
from backend.app.services.command_service import evaluate_breaker_command
from simulator.dynamics import (
    DEFAULT_PROFILE_ID,
    activate_timed_event,
    apply_timed_events,
    sample_profile,
)
from simulator.scenarios import apply_scenario_overlay, get_scenario_progress, get_scenario_summary


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


def _filter_history_window(history: list[StationSnapshot], window_sec: int) -> list[StationSnapshot]:
    if not history:
        return []
    if window_sec <= 0:
        return history

    end_time = datetime.fromisoformat(history[-1].timestamp)
    filtered = [
        snapshot
        for snapshot in history
        if (end_time - datetime.fromisoformat(snapshot.timestamp)).total_seconds() <= window_sec
    ]
    return filtered or [history[-1]]


def _downsample_values(values: list[tuple[str, float]], max_points: int) -> list[tuple[str, float]]:
    if max_points <= 0 or len(values) <= max_points:
        return values

    step = ceil(len(values) / max_points)
    sampled = values[::step]
    if sampled[-1] != values[-1]:
        sampled.append(values[-1])
    return sampled


def _build_trends(
    history: list[StationSnapshot],
    voltage_window_sec: int,
    current_window_sec: int,
    active_power_window_sec: int,
    water_flow_window_sec: int,
    generation_support_window_sec: int,
    transformer_window_sec: int,
    max_points: int,
) -> DashboardTrends:
    voltage_l1_series: list[TrendSeries] = []
    voltage_l2_series: list[TrendSeries] = []
    voltage_l3_series: list[TrendSeries] = []
    current_series: list[TrendSeries] = []
    active_power_series: list[TrendSeries] = []
    water_flow_series: list[TrendSeries] = []
    generation_support_series: list[TrendSeries] = []
    voltage_history = _filter_history_window(history, voltage_window_sec)
    current_history = _filter_history_window(history, current_window_sec)
    active_power_history = _filter_history_window(history, active_power_window_sec)
    water_flow_history = _filter_history_window(history, water_flow_window_sec)
    generation_support_history = _filter_history_window(history, generation_support_window_sec)
    transformer_history = _filter_history_window(history, transformer_window_sec)

    feeder_ids = tuple(feeder.id for feeder in history[-1].feeders) if history else ()
    for feeder_id in feeder_ids:
        voltage_l1_points: list[tuple[str, float]] = []
        voltage_l2_points: list[tuple[str, float]] = []
        voltage_l3_points: list[tuple[str, float]] = []
        current_points: list[tuple[str, float]] = []
        active_power_points: list[tuple[str, float]] = []
        water_flow_points: list[tuple[str, float]] = []
        generation_support_points: list[tuple[str, float]] = []
        for snapshot in voltage_history:
            feeder = next((item for item in snapshot.feeders if item.id == feeder_id), None)
            if feeder is None:
                continue
            voltage_l1_points.append((snapshot.timestamp, feeder.voltage.l1))
            voltage_l2_points.append((snapshot.timestamp, feeder.voltage.l2))
            voltage_l3_points.append((snapshot.timestamp, feeder.voltage.l3))
        for snapshot in current_history:
            feeder = next((item for item in snapshot.feeders if item.id == feeder_id), None)
            if feeder is None:
                continue
            current_points.append(
                (
                    snapshot.timestamp,
                    max(feeder.current.l1, feeder.current.l2, feeder.current.l3),
                )
            )
        for snapshot in active_power_history:
            feeder = next((item for item in snapshot.feeders if item.id == feeder_id), None)
            if feeder is None:
                continue
            active_power_points.append((snapshot.timestamp, feeder.activePowerKw))
        for snapshot in water_flow_history:
            feeder = next((item for item in snapshot.feeders if item.id == feeder_id), None)
            if feeder is None or feeder.waterFlowPercent is None:
                continue
            water_flow_points.append((snapshot.timestamp, feeder.waterFlowPercent))
        for snapshot in generation_support_history:
            feeder = next((item for item in snapshot.feeders if item.id == feeder_id), None)
            if feeder is None or feeder.generationEquivalentHomes is None:
                continue
            generation_support_points.append((snapshot.timestamp, float(feeder.generationEquivalentHomes)))

        voltage_l1_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="V",
                values=_downsample_values(voltage_l1_points, max_points),
                threshold_low=207.0,
                threshold_high=253.0,
            )
        )
        voltage_l2_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="V",
                values=_downsample_values(voltage_l2_points, max_points),
                threshold_low=207.0,
                threshold_high=253.0,
            )
        )
        voltage_l3_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="V",
                values=_downsample_values(voltage_l3_points, max_points),
                threshold_low=207.0,
                threshold_high=253.0,
            )
        )
        current_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="A",
                values=_downsample_values(current_points, max_points),
            )
        )
        active_power_series.append(
            _trend_series(
                series_id=feeder_id,
                label=feeder_id,
                unit="kW",
                values=_downsample_values(active_power_points, max_points),
            )
        )
        if water_flow_points:
            water_flow_series.append(
                _trend_series(
                    series_id=feeder_id,
                    label=feeder_id,
                    unit="%",
                    values=_downsample_values(water_flow_points, max_points),
                    threshold_low=38.0,
                )
            )
        if generation_support_points:
            generation_support_series.append(
                _trend_series(
                    series_id=feeder_id,
                    label=feeder_id,
                    unit="boliger",
                    values=_downsample_values(generation_support_points, max_points),
                )
            )

    transformer_values = [
        (snapshot.timestamp, snapshot.transformer.loadPercent)
        for snapshot in transformer_history
    ]
    transformer_series = [
        _trend_series(
            series_id="T1",
            label="T1",
            unit="%",
            values=_downsample_values(transformer_values, max_points),
            threshold_high=100.0,
        )
    ]

    return DashboardTrends(
        voltageL1=voltage_l1_series,
        voltageL2=voltage_l2_series,
        voltageL3=voltage_l3_series,
        currentMax=current_series,
        activePower=active_power_series,
        waterFlowPercent=water_flow_series,
        generationSupportHomes=generation_support_series,
        transformerLoad=transformer_series,
    )


class AppState:
    def __init__(
        self,
        topology: StationTopology,
        controls: list[FeederControlInput],
        available_scenarios: list[ScenarioSummary],
        available_profiles: list[NormalProfileSummary],
        available_timed_events: list[TimedEventSummary],
        default_profile_id: str = DEFAULT_PROFILE_ID,
    ) -> None:
        self._lock = asyncio.Lock()
        self._topology = topology
        self._controls = {control.id: control for control in controls}
        self._default_controls = {control.id: control.model_copy(deep=True) for control in controls}
        self._custom_base_controls = {control.id: control.model_copy(deep=True) for control in controls}
        self._simulator_settings = SimulatorSettings()
        self._default_simulator_settings = self._simulator_settings.model_copy(deep=True)
        self._custom_base_settings = self._simulator_settings.model_copy(deep=True)
        self._snapshot: StationSnapshot | None = None
        self._snapshot_history: deque[StationSnapshot] = deque(maxlen=settings.trend_history_max_snapshots)
        self._active_alarms: list[Alarm] = []
        self._events: deque[Event] = deque(maxlen=120)
        self._simulator_running = False
        self._last_snapshot_at: str | None = None
        self._websocket_clients = 0
        self._available_scenarios = available_scenarios
        self._available_profiles = available_profiles
        self._available_timed_events = available_timed_events
        self._default_profile_id = default_profile_id
        self._active_profile_id: str = default_profile_id
        self._system_started_at = _now_iso()
        self._active_profile_started_at = self._system_started_at
        self._active_timed_events: list[ActiveTimedEvent] = []
        self._active_scenario_id: str | None = None
        self._active_scenario_started_at = self._system_started_at
        self._last_command_result: CommandResult | None = None
        self._latched_trip_reasons: dict[str, str] = {}
        self._station_breakers: dict[str, BreakerStatus] = {
            "BRK-IN": BreakerStatus.CLOSED,
            "LV-BRK": BreakerStatus.CLOSED,
        }

        self._events.append(
            Event(
                id=f"evt-{uuid4().hex[:10]}",
                timestamp=_now_iso(),
                type="system",
                source="backend",
                description="SCADA scaffold initialized.",
            )
        )

    def _seed_custom_baseline_from_live_state_unlocked(self) -> None:
        self._custom_base_controls = {
            control.id: control.model_copy(deep=True)
            for control in self._controls.values()
        }
        self._custom_base_settings = self._simulator_settings.model_copy(deep=True)

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

            for feeder in snapshot.feeders:
                control = self._controls.get(feeder.id)
                if control is None:
                    continue
                if feeder.breakerStatus != BreakerStatus.TRIPPED or control.breakerStatus == BreakerStatus.TRIPPED:
                    continue

                trip_reason = feeder.protection.lastTripReason or "forced_trip"
                next_fault_mode = FaultMode.OVERLOAD if trip_reason == "overload" else FaultMode.FORCED_TRIP
                self._latched_trip_reasons[feeder.id] = trip_reason
                updated_control = control.model_copy(
                    update={
                        "breakerStatus": BreakerStatus.TRIPPED,
                        "faultMode": next_fault_mode,
                    }
                )
                self._controls[feeder.id] = updated_control
                self._custom_base_controls[feeder.id] = updated_control
                self._events.appendleft(
                    Event(
                        id=f"evt-{uuid4().hex[:10]}",
                        timestamp=snapshot.timestamp,
                        type="protection_trip",
                        source=feeder.id,
                        description=f"Protection trip latched for {feeder.id}: {trip_reason.replace('_', ' ')}.",
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

    async def get_station_breakers(self) -> dict[str, BreakerStatus]:
        async with self._lock:
            return dict(self._station_breakers)

    async def get_simulator_settings(self) -> SimulatorSettings:
        async with self._lock:
            return self._simulator_settings

    async def get_available_scenarios(self) -> list[ScenarioSummary]:
        async with self._lock:
            return list(self._available_scenarios)

    async def get_available_profiles(self) -> list[NormalProfileSummary]:
        async with self._lock:
            return list(self._available_profiles)

    async def get_available_timed_events(self) -> list[TimedEventSummary]:
        async with self._lock:
            return list(self._available_timed_events)

    async def get_active_profile_id(self) -> str:
        async with self._lock:
            return self._active_profile_id

    async def get_active_timed_events(self) -> list[ActiveTimedEvent]:
        async with self._lock:
            return [event.model_copy(deep=True) for event in self._active_timed_events]

    async def get_active_scenario_id(self) -> str | None:
        async with self._lock:
            return self._active_scenario_id

    async def activate_profile(self, profile_id: str) -> str:
        async with self._lock:
            if all(profile.id != profile_id for profile in self._available_profiles):
                raise KeyError(profile_id)
            timestamp = _now_iso()
            self._active_profile_id = profile_id
            self._active_profile_started_at = timestamp
            self._active_timed_events = []
            self._active_scenario_id = None
            self._active_scenario_started_at = timestamp
            self._last_command_result = None
            self._latched_trip_reasons = {}
            self._station_breakers = {
                "BRK-IN": BreakerStatus.CLOSED,
                "LV-BRK": BreakerStatus.CLOSED,
            }
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=timestamp,
                    type="profile_start",
                    source=profile_id,
                    description=f"Normalprofil aktivert: {profile_id}.",
                )
            )
            return profile_id

    async def activate_timed_event(self, event_id: str) -> ActiveTimedEvent:
        timestamp = _now_iso()
        next_event = activate_timed_event(event_id, now=timestamp)
        async with self._lock:
            if all(item.id != event_id for item in self._available_timed_events):
                raise KeyError(event_id)
            self._active_timed_events = [
                active_event for active_event in self._active_timed_events if active_event.id != event_id
            ]
            self._active_timed_events.append(next_event)
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=timestamp,
                    type="timed_event_start",
                    source=event_id,
                    description=f"Tidsavgrenset hendelse startet: {next_event.name}.",
                )
            )
            return next_event

    async def advance_dynamic_state(self, now: str | None = None) -> None:
        timestamp = now or _now_iso()
        async with self._lock:
            if self._active_profile_id == "custom":
                base_controls = [control.model_copy(deep=True) for control in self._custom_base_controls.values()]
                base_settings = self._custom_base_settings.model_copy(deep=True)
            else:
                base_controls, base_settings = sample_profile(
                    profile_id=self._active_profile_id,
                    default_controls=list(self._default_controls.values()),
                    default_settings=self._default_simulator_settings,
                    started_at=self._active_profile_started_at,
                    now=timestamp,
                )
                base_settings = base_settings.model_copy(
                    update={"scenarioSpeedMultiplier": self._simulator_settings.scenarioSpeedMultiplier}
                )

            next_controls, next_settings, still_active = apply_timed_events(
                controls=base_controls,
                settings=base_settings,
                active_events=self._active_timed_events,
                now=timestamp,
            )

            if self._active_scenario_id and self._active_scenario_id != "custom":
                overlay_progress = get_scenario_progress(
                    scenario_id=self._active_scenario_id,
                    started_at=self._active_scenario_started_at,
                    now=timestamp,
                    speed_multiplier=next_settings.scenarioSpeedMultiplier,
                )
                next_controls, next_settings, _scenario = apply_scenario_overlay(
                    scenario_id=self._active_scenario_id,
                    baseline_controls=next_controls,
                    baseline_settings=next_settings,
                    progress=overlay_progress,
                )

            expired_event_ids = {
                event.id for event in self._active_timed_events
                if all(candidate.id != event.id for candidate in still_active)
            }
            for event in self._active_timed_events:
                if event.id not in expired_event_ids:
                    continue
                self._events.appendleft(
                    Event(
                        id=f"evt-{uuid4().hex[:10]}",
                        timestamp=timestamp,
                        type="timed_event_end",
                        source=event.id,
                        description=f"Tidsavgrenset hendelse avsluttet: {event.name}.",
                    )
                )

            self._active_timed_events = still_active
            if self._latched_trip_reasons:
                next_controls = [
                    control.model_copy(
                        update={
                            "breakerStatus": BreakerStatus.TRIPPED,
                            "faultMode": (
                                FaultMode.OVERLOAD
                                if self._latched_trip_reasons.get(control.id) == "overload"
                                else FaultMode.FORCED_TRIP
                            ),
                        }
                    )
                    if control.id in self._latched_trip_reasons
                    else control
                    for control in next_controls
                ]
            self._controls = {control.id: control for control in next_controls}
            self._simulator_settings = next_settings

    async def update_control(self, feeder_id: str, patch: FeederControlPatch) -> FeederControlInput:
        updates = patch.model_dump(exclude_none=True)
        async with self._lock:
            if self._active_profile_id != "custom":
                self._seed_custom_baseline_from_live_state_unlocked()
            control = self._custom_base_controls.get(feeder_id) if self._active_profile_id == "custom" else self._controls.get(feeder_id)
            if control is None:
                raise KeyError(feeder_id)
            updated = control.model_copy(update=updates)
            if patch.breakerStatus is not None and patch.breakerStatus != BreakerStatus.TRIPPED:
                self._latched_trip_reasons.pop(feeder_id, None)
            if patch.faultMode is not None and patch.faultMode not in {FaultMode.OVERLOAD, FaultMode.FORCED_TRIP}:
                self._latched_trip_reasons.pop(feeder_id, None)
            self._custom_base_controls[feeder_id] = updated
            self._controls[feeder_id] = updated
            self._active_profile_id = "custom"
            self._active_profile_started_at = _now_iso()
            self._active_timed_events = []
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
            if self._active_profile_id != "custom":
                self._seed_custom_baseline_from_live_state_unlocked()
            if self._snapshot is None:
                raise RuntimeError("Snapshot has not been initialized yet.")

            if request.objectId in self._station_breakers:
                current_status = self._station_breakers[request.objectId]
                object_name = "Inntaksbryter" if request.objectId == "BRK-IN" else "Lavspent hovedbryter"
                downstream_feeders = list(self._snapshot.feeders)
                affected_customers = sum(
                    feeder.customers for feeder in downstream_feeders if feeder.breakerStatus == BreakerStatus.CLOSED
                )
                critical_customers = sum(
                    feeder.criticalCustomers
                    for feeder in downstream_feeders
                    if feeder.breakerStatus == BreakerStatus.CLOSED
                )
                reasons: list[str] = []

                if action == CommandAction.OPEN_BREAKER:
                    if current_status != BreakerStatus.CLOSED:
                        reasons.append("Opening blocked: breaker is not currently closed.")
                    if not request.reason or not request.reason.strip():
                        reasons.append("Opening blocked: an operator reason is required.")
                    if affected_customers > 0 and not request.confirmImpact:
                        reasons.append(
                            f"Opening blocked: confirm that {affected_customers} customers will be disconnected."
                        )
                else:
                    if current_status == BreakerStatus.CLOSED:
                        reasons.append("Closing blocked: breaker is already closed.")
                    if request.objectId == "LV-BRK" and self._station_breakers["BRK-IN"] != BreakerStatus.CLOSED:
                        reasons.append("Closing blocked: BRK-IN must be closed before LV-BRK can be energized.")
                    would_energize_bus = request.objectId == "LV-BRK" or (
                        request.objectId == "BRK-IN"
                        and self._station_breakers["LV-BRK"] == BreakerStatus.CLOSED
                    )
                    if would_energize_bus:
                        closed_downstream_ids = {
                            control.id
                            for control in self._controls.values()
                            if control.breakerStatus == BreakerStatus.CLOSED
                        }
                        if any(
                            alarm.severity == "critical"
                            and alarm.state != AlarmState.ACKNOWLEDGED
                            and (alarm.objectId == "T1" or alarm.objectId in closed_downstream_ids)
                            for alarm in self._active_alarms
                        ):
                            reasons.append(
                                "Closing blocked: acknowledge critical transformer or downstream alarms before bus restore."
                            )

                        degraded_downstream = [
                            control.id
                            for control in self._controls.values()
                            if control.breakerStatus == BreakerStatus.CLOSED
                            and control.communicationState in {DataQuality.STALE, DataQuality.INVALID, DataQuality.LOST}
                        ]
                        if degraded_downstream:
                            reasons.append(
                                "Closing blocked: telemetry is degraded on downstream closed feeders "
                                f"({', '.join(degraded_downstream)})."
                            )

                        unsafe_downstream = [
                            control.id
                            for control in self._controls.values()
                            if control.breakerStatus == BreakerStatus.CLOSED
                            and control.faultMode in {FaultMode.OVERLOAD, FaultMode.FORCED_TRIP, FaultMode.SENSOR_FAULT}
                        ]
                        if unsafe_downstream:
                            reasons.append(
                                "Closing blocked: downstream closed feeders still carry active fault conditions "
                                f"({', '.join(unsafe_downstream)})."
                            )

                allowed = not reasons
                next_status = (
                    BreakerStatus.OPEN if action == CommandAction.OPEN_BREAKER else BreakerStatus.CLOSED
                ) if allowed else current_status
                result = CommandResult(
                    id=f"cmd-{uuid4().hex[:12]}",
                    timestamp=_now_iso(),
                    action=action,
                    objectId=request.objectId,
                    objectName=object_name,
                    operator=request.operator,
                    reason=request.reason,
                    allowed=allowed,
                    executed=allowed,
                    message=(
                        f"{request.objectId} {'opened' if action == CommandAction.OPEN_BREAKER else 'closed'} successfully."
                        if allowed
                        else reasons[0]
                    ),
                    breakerStatusBefore=current_status,
                    breakerStatusAfter=next_status,
                    interlock=InterlockDecision(
                        allowed=allowed,
                        reasons=reasons,
                        affectedCustomers=affected_customers,
                        criticalCustomers=critical_customers,
                    ),
                )

                if result.allowed:
                    self._station_breakers[request.objectId] = result.breakerStatusAfter
                    self._active_profile_id = "custom"
                    self._active_profile_started_at = result.timestamp
                    self._active_timed_events = []
                    self._active_scenario_id = "custom"
                    self._active_scenario_started_at = result.timestamp
                    self._events.appendleft(
                        Event(
                            id=f"evt-{uuid4().hex[:10]}",
                            timestamp=result.timestamp,
                            type="command_executed",
                            source=request.objectId,
                            description=f"Station command executed: {result.action} by {request.operator}.",
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
                    FaultMode.OVERLOAD,
                    FaultMode.FORCED_TRIP,
                }:
                    updates["faultMode"] = FaultMode.NORMAL

                updated = control.model_copy(update=updates)
                if action == CommandAction.CLOSE_BREAKER:
                    self._latched_trip_reasons.pop(request.objectId, None)
                self._custom_base_controls[request.objectId] = updated
                self._controls[request.objectId] = updated
                self._active_profile_id = "custom"
                self._active_profile_started_at = result.timestamp
                self._active_timed_events = []
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
            speed_only_update = set(updates.keys()) == {"scenarioSpeedMultiplier"}
            if not speed_only_update and self._active_profile_id != "custom":
                self._seed_custom_baseline_from_live_state_unlocked()

            if speed_only_update:
                self._simulator_settings = self._simulator_settings.model_copy(update=updates)
                self._custom_base_settings = self._custom_base_settings.model_copy(update=updates)
            else:
                self._custom_base_settings = self._simulator_settings.model_copy(update=updates)
                self._simulator_settings = self._custom_base_settings
                self._active_profile_id = "custom"
                self._active_profile_started_at = _now_iso()
                self._active_timed_events = []
                self._active_scenario_id = "custom"
                self._active_scenario_started_at = _now_iso()

            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=_now_iso(),
                    type="simulator_update",
                    source="simulator",
                    description=(
                        "Oppdaterte scenariohastighet."
                        if speed_only_update
                        else "Updated simulator settings."
                    ),
                )
            )
            return self._simulator_settings

    async def apply_scenario(self, scenario_id: str) -> tuple[list[FeederControlInput], SimulatorSettings]:
        async with self._lock:
            scenario_summary = get_scenario_summary(scenario_id)
            self._active_scenario_id = scenario_summary.id
            self._active_scenario_started_at = _now_iso()
            self._events.appendleft(
                Event(
                    id=f"evt-{uuid4().hex[:10]}",
                    timestamp=_now_iso(),
                    type="scenario_start",
                    source=scenario_summary.id,
                    description=f"Feilscenario aktivert som overlay: {scenario_summary.name}.",
                )
            )
            return list(self._controls.values()), self._simulator_settings

    async def reset_simulation(self) -> tuple[list[FeederControlInput], SimulatorSettings]:
        await self.activate_profile(self._default_profile_id)
        await self.advance_dynamic_state()
        async with self._lock:
            return list(self._controls.values()), self._simulator_settings

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

    async def get_trends(
        self,
        voltage_window_sec: int | None = None,
        current_window_sec: int | None = None,
        active_power_window_sec: int | None = None,
        water_flow_window_sec: int | None = None,
        generation_support_window_sec: int | None = None,
        transformer_window_sec: int | None = None,
    ) -> DashboardTrends:
        async with self._lock:
            history = list(self._snapshot_history)
        default_window_sec = settings.default_trend_window_sec
        return _build_trends(
            history=history,
            voltage_window_sec=voltage_window_sec or default_window_sec,
            current_window_sec=current_window_sec or default_window_sec,
            active_power_window_sec=active_power_window_sec or default_window_sec,
            water_flow_window_sec=water_flow_window_sec or default_window_sec,
            generation_support_window_sec=generation_support_window_sec or default_window_sec,
            transformer_window_sec=transformer_window_sec or default_window_sec,
            max_points=settings.trend_max_points,
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
        available_profiles = await self.get_available_profiles()
        available_timed_events = await self.get_available_timed_events()
        active_scenario_id = await self.get_active_scenario_id()
        active_profile_id = await self.get_active_profile_id()
        active_timed_events = await self.get_active_timed_events()
        trends = await self.get_trends()
        async with self._lock:
            system_started_at = self._system_started_at
            active_profile_started_at = self._active_profile_started_at
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
            availableProfiles=available_profiles,
            availableTimedEvents=available_timed_events,
            activeProfileId=active_profile_id,
            activeProfileStartedAt=active_profile_started_at,
            activeTimedEvents=active_timed_events,
            activeScenarioId=active_scenario_id,
            activeScenarioStartedAt=active_scenario_started_at,
            systemStartedAt=system_started_at,
            trends=trends,
            lastCommandResult=last_command_result,
        )
