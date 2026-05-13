export type DataQuality = "good" | "estimated" | "stale" | "invalid" | "lost";
export type BreakerStatus = "closed" | "open" | "tripped";
export type AlarmSeverity = "low" | "medium" | "high" | "critical";
export type AlarmState = "new" | "active" | "acknowledged" | "returned" | "closed";
export type FaultMode = "normal" | "overload" | "planned_outage" | "sensor_fault" | "forced_trip";
export type PowerDirection = "import" | "export" | "neutral";
export type CommandAction = "open_breaker" | "close_breaker";

export interface PhaseValues {
  l1: number;
  l2: number;
  l3: number;
}

export interface ProtectionSettings {
  ratingA: number;
  warningPercent: number;
  tripPercent: number;
  tripDelaySec: number;
  lastTripReason?: string | null;
  lastTripAt?: string | null;
}

export interface DerivedMetrics {
  utilizationPercent: number;
  phaseImbalancePercent: number;
  voltageDeviationPercent: number;
  powerDirection: PowerDirection;
  affectedCustomers: number;
}

export interface Asset {
  id: string;
  name: string;
  kind: string;
  parentId?: string | null;
  metadata: Record<string, string | number>;
}

export interface TopologyEdge {
  sourceId: string;
  targetId: string;
  relation: string;
}

export interface StationTopology {
  stationId: string;
  assets: Asset[];
  edges: TopologyEdge[];
}

export interface FeederControlInput {
  id: string;
  loadKw: number;
  reactivePowerKvar: number;
  phaseImbalancePercent: number;
  breakerStatus: BreakerStatus;
  communicationState: DataQuality;
  faultMode: FaultMode;
  solarKw: number;
}

export interface SimulatorSettings {
  ambientTempC: number;
  scenarioSpeedMultiplier: number;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
}

export interface NormalProfileSummary {
  id: string;
  name: string;
  description: string;
  cycleMinutes: number;
}

export interface TimedEventSummary {
  id: string;
  name: string;
  description: string;
  durationSec: number;
}

export interface ActiveTimedEvent {
  id: string;
  name: string;
  description: string;
  durationSec: number;
  startedAt: string;
  endsAt: string;
}

export interface FeederTelemetry {
  id: string;
  name: string;
  type: string;
  timestamp: string;
  breakerStatus: BreakerStatus;
  voltage: PhaseValues;
  current: PhaseValues;
  activePowerKw: number;
  reactivePowerKvar: number;
  customers: number;
  criticalCustomers: number;
  generationEquivalentHomes?: number | null;
  nominalGenerationEquivalentHomes?: number | null;
  quality: DataQuality;
  protection: ProtectionSettings;
  derived: DerivedMetrics;
}

export interface TransformerTelemetry {
  id: string;
  timestamp: string;
  loadPercent: number;
  activePowerKw: number;
  apparentPowerKva: number;
  secondaryVoltageV: number;
  topOilTempC: number;
  communicationOk: boolean;
  quality: DataQuality;
}

export interface StationBreakerTelemetry {
  id: string;
  name: string;
  timestamp: string;
  breakerStatus: BreakerStatus;
  quality: DataQuality;
}

export interface StationSnapshot {
  stationId: string;
  timestamp: string;
  mode: string;
  transformer: TransformerTelemetry;
  stationBreakers: StationBreakerTelemetry[];
  feeders: FeederTelemetry[];
}

export interface Alarm {
  id: string;
  createdAt: string;
  objectId: string;
  objectName: string;
  severity: AlarmSeverity;
  state: AlarmState;
  title: string;
  message: string;
  measuredValue?: number | null;
  threshold?: number | null;
  unit?: string | null;
  probableCause?: string | null;
  consequence?: string | null;
  recommendedAction?: string | null;
}

export interface BreakerCommandRequest {
  objectId: string;
  operator?: string;
  reason?: string | null;
  confirmImpact?: boolean;
}

export interface InterlockDecision {
  allowed: boolean;
  reasons: string[];
  affectedCustomers: number;
  criticalCustomers: number;
}

export interface CommandResult {
  id: string;
  timestamp: string;
  action: CommandAction;
  objectId: string;
  objectName: string;
  operator: string;
  reason?: string | null;
  allowed: boolean;
  executed: boolean;
  message: string;
  breakerStatusBefore: BreakerStatus;
  breakerStatusAfter: BreakerStatus;
  interlock: InterlockDecision;
}

export interface EventEntry {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  description: string;
}

export interface TrendPoint {
  timestamp: string;
  value: number;
}

export interface TrendSeries {
  id: string;
  label: string;
  unit: string;
  latestValue: number;
  thresholdLow?: number | null;
  thresholdHigh?: number | null;
  points: TrendPoint[];
}

export interface DashboardTrends {
  voltageL1: TrendSeries[];
  voltageL2: TrendSeries[];
  voltageL3: TrendSeries[];
  currentMax: TrendSeries[];
  activePower: TrendSeries[];
  transformerLoad: TrendSeries[];
}

export interface SystemHealth {
  timestamp: string;
  apiStatus: string;
  simulatorRunning: boolean;
  updateIntervalSec: number;
  lastSnapshotAt?: string | null;
  websocketClients: number;
  databaseStatus: string;
  brokerStatus: string;
}

export interface DashboardPayload {
  topology: StationTopology;
  snapshot: StationSnapshot;
  activeAlarms: Alarm[];
  recentEvents: EventEntry[];
  health: SystemHealth;
  controls: FeederControlInput[];
  simulatorSettings: SimulatorSettings;
  availableScenarios: ScenarioSummary[];
  availableProfiles: NormalProfileSummary[];
  availableTimedEvents: TimedEventSummary[];
  activeProfileId?: string | null;
  activeProfileStartedAt?: string | null;
  activeTimedEvents: ActiveTimedEvent[];
  activeScenarioId?: string | null;
  activeScenarioStartedAt?: string | null;
  systemStartedAt: string;
  trends: DashboardTrends;
  lastCommandResult?: CommandResult | null;
}

export type ConnectionStatus = "connecting" | "live" | "polling" | "offline";
