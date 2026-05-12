import type {
  Alarm,
  AlarmSeverity,
  AlarmState,
  BreakerStatus,
  DashboardPayload,
  DataQuality,
  FeederControlInput,
  FeederTelemetry,
  FaultMode,
  SystemHealth,
  TrendSeries,
} from "./types";

const severityRank: Record<AlarmSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const seriesPalette: Record<string, string> = {
  F1: "#73a6ff",
  F2: "#b28dff",
  F3: "#ff8d36",
  F4: "#82d95b",
  T1: "#f3f4f6",
};

export function formatTime(timestamp?: string | null): string {
  if (!timestamp) {
    return "--:--:--";
  }
  return new Date(timestamp).toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDate(timestamp?: string | null): string {
  if (!timestamp) {
    return "--";
  }
  return new Date(timestamp).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatElapsed(timestamp?: string | null): string {
  if (!timestamp) {
    return "--";
  }
  const deltaSec = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  const hours = Math.floor(deltaSec / 3600);
  const minutes = Math.floor((deltaSec % 3600) / 60);
  const seconds = deltaSec % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatValue(value: number, digits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSignedValue(value: number, digits = 0): string {
  const prefix = value > 0 ? "" : value < 0 ? "-" : "";
  return `${prefix}${formatValue(Math.abs(value), digits)}`;
}

export function sortAlarms(alarms: Alarm[]): Alarm[] {
  return [...alarms].sort((left, right) => {
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

export function getHighestPriorityAlarm(alarms: Alarm[]): Alarm | null {
  return sortAlarms(alarms)[0] ?? null;
}

export function getSeverityLabel(severity: AlarmSeverity): string {
  switch (severity) {
    case "critical":
      return "KRITISK";
    case "high":
      return "HØY";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LAV";
    default:
      return String(severity).toUpperCase();
  }
}

export function getAlarmStateLabel(state: AlarmState): string {
  switch (state) {
    case "acknowledged":
      return "KVITTERT";
    case "active":
      return "AKTIV";
    case "new":
      return "NY";
    case "returned":
      return "NORMAL";
    case "closed":
      return "LUKKET";
    default:
      return String(state).toUpperCase();
  }
}

export function getBreakerStatusLabel(status: BreakerStatus): string {
  switch (status) {
    case "closed":
      return "LUKKET";
    case "open":
      return "ÅPEN";
    case "tripped":
      return "UTLØST";
    default:
      return String(status).toUpperCase();
  }
}

export function getQualityLabel(quality: DataQuality): string {
  switch (quality) {
    case "good":
      return "OK";
    case "estimated":
      return "ESTIMERT";
    case "stale":
      return "FORELDET";
    case "invalid":
      return "UGYLDIG";
    case "lost":
      return "TAPT";
    default:
      return String(quality).toUpperCase();
  }
}

export function getFaultModeLabel(mode: FaultMode): string {
  switch (mode) {
    case "normal":
      return "Normal";
    case "overload":
      return "Overlast";
    case "planned_outage":
      return "Planlagt utkobling";
    case "sensor_fault":
      return "Sensorfeil";
    case "forced_trip":
      return "Tvungen trip";
    default:
      return String(mode);
  }
}

export function getFeederControl(controls: FeederControlInput[], feederId: string): FeederControlInput | undefined {
  return controls.find((control) => control.id === feederId);
}

export function getObjectAlarms(alarms: Alarm[], objectId: string): Alarm[] {
  return alarms.filter((alarm) => alarm.objectId === objectId);
}

export function getStrongestAlarm(alarms: Alarm[], objectId: string): Alarm | null {
  return getHighestPriorityAlarm(getObjectAlarms(alarms, objectId));
}

export function getFeederStateLabel(feeder: FeederTelemetry, alarm: Alarm | null): string {
  if (feeder.breakerStatus === "tripped") {
    return "UTLØST";
  }
  if (feeder.breakerStatus === "open") {
    return "ÅPEN";
  }
  const title = alarm?.title.toLowerCase() ?? "";
  if (title.includes("overload") || title.includes("trip threshold")) {
    return "OVERLAST";
  }
  if (title.includes("phase")) {
    return "FASEUBALANSE";
  }
  if (title.includes("communication")) {
    return "KOMM. TAPT";
  }
  if (title.includes("undervoltage")) {
    return "SPENNING LAV";
  }
  if (title.includes("overvoltage")) {
    return "SPENNING HØY";
  }
  return "NORMAL";
}

export function getFeederStateTone(feeder: FeederTelemetry, alarm: Alarm | null): string {
  if (feeder.breakerStatus === "tripped") {
    return "critical";
  }
  if (feeder.breakerStatus === "open") {
    return "neutral";
  }
  if (!alarm) {
    return "good";
  }
  return alarm.severity;
}

export function getSystemCommunicationState(payload: DashboardPayload | null): {
  label: string;
  tone: "good" | "warn" | "bad";
} {
  if (!payload) {
    return { label: "INIT", tone: "warn" };
  }
  const qualities = payload.snapshot.feeders.map((feeder) => feeder.quality);
  if (qualities.every((quality) => quality === "good")) {
    return { label: "OK", tone: "good" };
  }
  if (qualities.some((quality) => quality === "lost" || quality === "invalid")) {
    return { label: "DEGRADERT", tone: "bad" };
  }
  return { label: "USTABIL", tone: "warn" };
}

export function getAcknowledgedCount(alarms: Alarm[]): number {
  return alarms.filter((alarm) => alarm.state === "acknowledged").length;
}

export function getAverageQualityPercent(payload: DashboardPayload | null): number {
  if (!payload) {
    return 0;
  }
  const scoreMap: Record<string, number> = {
    good: 1,
    estimated: 0.7,
    stale: 0.35,
    invalid: 0,
    lost: 0,
  };
  const qualities = payload.snapshot.feeders.map((feeder) => scoreMap[feeder.quality] ?? 0);
  const average = qualities.reduce((sum, value) => sum + value, 0) / Math.max(qualities.length, 1);
  return Math.round(average * 100);
}

export function getAverageDataAgeSeconds(health: SystemHealth | null): number {
  if (!health?.lastSnapshotAt) {
    return 0;
  }
  const ageMs = Math.max(0, Date.now() - new Date(health.lastSnapshotAt).getTime());
  return Number((ageMs / 1000).toFixed(1));
}

export function getPowerFactor(activePowerKw: number, apparentPowerKva: number): number {
  if (apparentPowerKva === 0) {
    return 1;
  }
  return Number((activePowerKw / apparentPowerKva).toFixed(2));
}

export function getEventTypeLabel(type: string): string {
  switch (type) {
    case "alarm_raised":
      return "Alarm opprettet";
    case "alarm_cleared":
      return "Alarm normal";
    case "alarm_acknowledged":
      return "Alarm kvittert";
    case "alarm_acknowledged_bulk":
      return "Flere kvittert";
    case "scenario_start":
      return "Scenario startet";
    case "command_executed":
      return "Kommando kjørt";
    case "command_blocked":
      return "Kommando blokkert";
    case "breaker_state":
      return "Bryter endret";
    case "data_quality":
      return "Datakvalitet";
    case "control_update":
      return "Kontroll endret";
    case "simulator_update":
      return "Simulator endret";
    default:
      return type.replace(/_/g, " ");
  }
}

export function getLiveWindowLabel(seriesCollection: TrendSeries[]): string {
  const timestamps = seriesCollection.flatMap((series) =>
    series.points.map((point) => new Date(point.timestamp).getTime()),
  );
  if (timestamps.length < 2) {
    return "LIVE";
  }
  const totalMinutes = Math.max(1, Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} min live`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} t ${minutes} min live` : `${hours} t live`;
}

export function formatTrendWindowLabel(windowSec: number): string {
  if (windowSec < 3600) {
    return `${Math.round(windowSec / 60)} min`;
  }
  const hours = windowSec / 3600;
  return Number.isInteger(hours) ? `${hours} t` : `${hours.toFixed(1).replace(".", ",")} t`;
}

export function getTrendBounds(seriesCollection: TrendSeries[]): { min: number; max: number } {
  const values = seriesCollection.flatMap((series) => series.points.map((point) => point.value));
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  if (rawMin === rawMax) {
    return { min: rawMin - 1, max: rawMax + 1 };
  }
  const padding = (rawMax - rawMin) * 0.1;
  return { min: rawMin - padding, max: rawMax + padding };
}
