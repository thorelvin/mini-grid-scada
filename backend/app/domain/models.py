from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .enums import (
    AlarmSeverity,
    AlarmState,
    AssetKind,
    BreakerStatus,
    CommandAction,
    DataQuality,
    FaultMode,
    FeederType,
    PowerDirection,
)


class DomainModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, use_enum_values=True)


class PhaseValues(DomainModel):
    l1: float
    l2: float
    l3: float


class ProtectionSettings(DomainModel):
    ratingA: float
    warningPercent: float
    tripPercent: float
    tripDelaySec: float
    lastTripReason: str | None = None
    lastTripAt: str | None = None


class DerivedMetrics(DomainModel):
    utilizationPercent: float
    phaseImbalancePercent: float
    voltageDeviationPercent: float
    powerDirection: PowerDirection
    affectedCustomers: int


class Asset(DomainModel):
    id: str
    name: str
    kind: AssetKind
    parentId: str | None = None
    metadata: dict[str, str | int | float] = Field(default_factory=dict)


class TopologyEdge(DomainModel):
    sourceId: str
    targetId: str
    relation: str


class StationTopology(DomainModel):
    stationId: str
    assets: list[Asset]
    edges: list[TopologyEdge]


class FeederControlInput(DomainModel):
    id: str
    loadKw: float
    reactivePowerKvar: float = 0.0
    phaseImbalancePercent: float = 0.0
    breakerStatus: BreakerStatus = BreakerStatus.CLOSED
    communicationState: DataQuality = DataQuality.GOOD
    faultMode: FaultMode = FaultMode.NORMAL
    solarKw: float = 0.0


class FeederControlPatch(DomainModel):
    loadKw: float | None = None
    reactivePowerKvar: float | None = None
    phaseImbalancePercent: float | None = None
    breakerStatus: BreakerStatus | None = None
    communicationState: DataQuality | None = None
    faultMode: FaultMode | None = None
    solarKw: float | None = None


class SimulatorSettings(DomainModel):
    ambientTempC: float = 18.0


class SimulatorSettingsPatch(DomainModel):
    ambientTempC: float | None = None


class ScenarioSummary(DomainModel):
    id: str
    name: str
    description: str


class NormalProfileSummary(DomainModel):
    id: str
    name: str
    description: str
    cycleMinutes: int


class TimedEventSummary(DomainModel):
    id: str
    name: str
    description: str
    durationSec: int


class ActiveTimedEvent(DomainModel):
    id: str
    name: str
    description: str
    durationSec: int
    startedAt: str
    endsAt: str


class FeederTelemetry(DomainModel):
    id: str
    name: str
    type: FeederType
    timestamp: str
    breakerStatus: BreakerStatus
    voltage: PhaseValues
    current: PhaseValues
    activePowerKw: float
    reactivePowerKvar: float
    customers: int
    criticalCustomers: int
    quality: DataQuality
    protection: ProtectionSettings
    derived: DerivedMetrics


class TransformerTelemetry(DomainModel):
    id: str
    timestamp: str
    loadPercent: float
    activePowerKw: float
    apparentPowerKva: float
    secondaryVoltageV: float
    topOilTempC: float
    communicationOk: bool
    quality: DataQuality


class StationSnapshot(DomainModel):
    stationId: str
    timestamp: str
    mode: str
    transformer: TransformerTelemetry
    feeders: list[FeederTelemetry]


class Alarm(DomainModel):
    id: str
    createdAt: str
    objectId: str
    objectName: str
    severity: AlarmSeverity
    state: AlarmState = AlarmState.ACTIVE
    title: str
    message: str
    measuredValue: float | None = None
    threshold: float | None = None
    unit: str | None = None
    probableCause: str | None = None
    consequence: str | None = None
    recommendedAction: str | None = None


class Event(DomainModel):
    id: str
    timestamp: str
    type: str
    source: str
    description: str


class TrendPoint(DomainModel):
    timestamp: str
    value: float


class TrendSeries(DomainModel):
    id: str
    label: str
    unit: str
    latestValue: float
    thresholdLow: float | None = None
    thresholdHigh: float | None = None
    points: list[TrendPoint]


class DashboardTrends(DomainModel):
    voltageL2: list[TrendSeries]
    currentMax: list[TrendSeries]
    transformerLoad: list[TrendSeries]


class BreakerCommandRequest(DomainModel):
    objectId: str
    operator: str = "operator"
    reason: str | None = None
    confirmImpact: bool = False


class InterlockDecision(DomainModel):
    allowed: bool
    reasons: list[str] = Field(default_factory=list)
    affectedCustomers: int = 0
    criticalCustomers: int = 0


class CommandResult(DomainModel):
    id: str
    timestamp: str
    action: CommandAction
    objectId: str
    objectName: str
    operator: str
    reason: str | None = None
    allowed: bool
    executed: bool
    message: str
    breakerStatusBefore: BreakerStatus
    breakerStatusAfter: BreakerStatus
    interlock: InterlockDecision


class SystemHealth(DomainModel):
    timestamp: str
    apiStatus: str
    simulatorRunning: bool
    updateIntervalSec: float
    lastSnapshotAt: str | None = None
    websocketClients: int = 0
    databaseStatus: str = "not-configured"
    brokerStatus: str = "not-enabled"


class DashboardPayload(DomainModel):
    topology: StationTopology
    snapshot: StationSnapshot
    activeAlarms: list[Alarm]
    recentEvents: list[Event]
    health: SystemHealth
    controls: list[FeederControlInput]
    simulatorSettings: SimulatorSettings
    availableScenarios: list[ScenarioSummary]
    availableProfiles: list[NormalProfileSummary] = Field(default_factory=list)
    availableTimedEvents: list[TimedEventSummary] = Field(default_factory=list)
    activeProfileId: str | None = None
    activeProfileStartedAt: str | None = None
    activeTimedEvents: list[ActiveTimedEvent] = Field(default_factory=list)
    activeScenarioId: str | None = None
    activeScenarioStartedAt: str | None = None
    systemStartedAt: str
    trends: DashboardTrends
    lastCommandResult: CommandResult | None = None
