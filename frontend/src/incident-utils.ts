import {
  formatDate,
  formatTime,
  formatVoltageRangeLabel,
  getHighestPriorityAlarm,
  getSeverityLabel,
  sortAlarms,
} from "./dashboard-utils";
import { getBreakerOutcomeLabel, getTopologyImpactSummary } from "./topology-utils";
import type { Alarm, DashboardPayload, EventEntry, FeederTelemetry } from "./types";

export interface IncidentReportSection {
  id: string;
  title: string;
  lines: string[];
  tone?: "good" | "warn" | "critical" | "neutral";
}

export interface FeederFocusCard {
  feeder: FeederTelemetry;
  alarm: Alarm | null;
  affectedCustomers: number;
}

function severityRank(alarm: Alarm | null): number {
  if (!alarm) {
    return 0;
  }
  if (alarm.severity === "critical") {
    return 4;
  }
  if (alarm.severity === "high") {
    return 3;
  }
  if (alarm.severity === "medium") {
    return 2;
  }
  if (alarm.severity === "low") {
    return 1;
  }
  return 0;
}

export function isSelectableAssetId(assetId: string): boolean {
  return assetId === "T1" || assetId === "BRK-IN" || assetId === "LV-BRK" || /^F\d+$/.test(assetId);
}

export function buildRecentTimeline(history: DashboardPayload[], limit = 12): EventEntry[] {
  const byId = new Map<string, EventEntry>();

  for (const frame of history) {
    for (const event of frame.recentEvents) {
      if (!byId.has(event.id)) {
        byId.set(event.id, event);
      }
    }
  }

  return [...byId.values()]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, limit);
}

export function getRecommendedActions(dashboard: DashboardPayload): string[] {
  const recommendations = new Set<string>();

  for (const alarm of sortAlarms(dashboard.activeAlarms)) {
    if (alarm.title === "Breaker tripped") {
      recommendations.add(`Hold ${alarm.objectId} ute til triparsak er ryddet og alarmen er kvittert.`);
    } else if (alarm.title === "Protection trip threshold exceeded" || alarm.title === "Overload warning") {
      recommendations.add(`Reduser belastningen pa ${alarm.objectId} for gjeninnkobling eller videre lastokning.`);
    } else if (alarm.title === "Communication degraded") {
      recommendations.add(`Behandle kommandoer mot ${alarm.objectId} konservativt til datakvaliteten er tilbake til OK.`);
    } else if (alarm.title === "Phase imbalance") {
      recommendations.add(`Se over fasefordeling pa ${alarm.objectId} for a redusere ubalanse.`);
    } else if (alarm.title === "Undervoltage" || alarm.title === "Overvoltage") {
      recommendations.add(`Kontroller spenning og lokal last pa ${alarm.objectId} for a stabilisere nettet.`);
    }
  }

  if (recommendations.size === 0) {
    recommendations.add("Ingen aktive tiltak er pakrevd akkurat na.");
  }

  return [...recommendations].slice(0, 5);
}

export function buildFocusFeeders(dashboard: DashboardPayload): FeederFocusCard[] {
  const strongestAlarmByObject = new Map<string, Alarm>();

  for (const alarm of sortAlarms(dashboard.activeAlarms)) {
    if (!strongestAlarmByObject.has(alarm.objectId)) {
      strongestAlarmByObject.set(alarm.objectId, alarm);
    }
  }

  return dashboard.snapshot.feeders
    .map((feeder) => {
      const impact = getTopologyImpactSummary(dashboard.topology, dashboard.snapshot, feeder.id);
      const alarm = strongestAlarmByObject.get(feeder.id) ?? null;
      return {
        feeder,
        alarm,
        affectedCustomers: impact?.disconnectedCustomers ?? feeder.derived.affectedCustomers,
      };
    })
    .filter(({ feeder, alarm }) => {
      return (
        feeder.breakerStatus !== "closed" ||
        feeder.quality !== "good" ||
        feeder.derived.utilizationPercent >= feeder.protection.warningPercent ||
        alarm != null
      );
    })
    .sort((left, right) => {
      const leftScore =
        severityRank(left.alarm) * 1000 + left.affectedCustomers + left.feeder.derived.utilizationPercent;
      const rightScore =
        severityRank(right.alarm) * 1000 + right.affectedCustomers + right.feeder.derived.utilizationPercent;
      return rightScore - leftScore;
    })
    .slice(0, 4);
}

export function inferProbableCause(dashboard: DashboardPayload, history: DashboardPayload[]): string {
  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  if (highestAlarm?.probableCause) {
    return highestAlarm.probableCause;
  }

  if (highestAlarm?.title === "Breaker tripped") {
    return `Trip on ${highestAlarm.objectId} is the strongest current indicator. Check overload, fault mode, and operator sequence around the trip.`;
  }

  if (highestAlarm?.title === "Protection trip threshold exceeded" || highestAlarm?.title === "Overload warning") {
    return `Current loading on ${highestAlarm.objectId} is the most likely driver of the present incident posture.`;
  }

  const latestCommand = buildRecentTimeline(history, 24).find(
    (event) => event.type === "command_blocked" || event.type === "command_executed",
  );
  if (latestCommand) {
    return `Recent operator activity on ${latestCommand.source} may explain the current state transition.`;
  }

  return "No dominant root cause stands out right now. Use replay and focus objects to inspect the sequence.";
}

function describeSystemPosture(dashboard: DashboardPayload): string {
  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  if (highestAlarm) {
    return `Active incident: ${highestAlarm.objectId} ${highestAlarm.title}`;
  }

  const trippedFeeders = dashboard.snapshot.feeders.filter((feeder) => feeder.breakerStatus === "tripped");
  if (trippedFeeders.length > 0) {
    return `Residual trip state: ${trippedFeeders.map((feeder) => feeder.id).join(", ")}`;
  }

  const openFeeders = dashboard.snapshot.feeders.filter((feeder) => feeder.breakerStatus === "open");
  if (openFeeders.length > 0) {
    return `Manual or planned outage: ${openFeeders.map((feeder) => feeder.id).join(", ")}`;
  }

  return "Normal drift uten aktive alarmer.";
}

function buildFeederReportLines(dashboard: DashboardPayload): string {
  return dashboard.snapshot.feeders
    .map((feeder) => {
      const impact = getTopologyImpactSummary(dashboard.topology, dashboard.snapshot, feeder.id);
      return [
        `- ${feeder.id} ${feeder.name}`,
        `  Status: ${feeder.breakerStatus}`,
        `  Effekt: ${feeder.activePowerKw} kW / ${feeder.reactivePowerKvar} kVAr`,
        `  Utnyttelse: ${feeder.derived.utilizationPercent}%`,
        `  Spenning min/max: ${formatVoltageRangeLabel(feeder.voltage, 0)}`,
        `  Kvalitet: ${feeder.quality}`,
        `  Berorte kunder: ${impact?.disconnectedCustomers ?? feeder.derived.affectedCustomers}`,
        `  Siste triparsak: ${feeder.protection.lastTripReason ?? "ingen"}`,
      ].join("\n");
    })
    .join("\n");
}

function buildImpactLines(dashboard: DashboardPayload): string {
  return dashboard.snapshot.feeders
    .map((feeder) => {
      const impact = getTopologyImpactSummary(dashboard.topology, dashboard.snapshot, feeder.id);
      return [
        `- ${feeder.id}: ${getBreakerOutcomeLabel(feeder.breakerStatus)}`,
        `  Kunder pa gren: ${impact?.totalCustomers ?? feeder.customers}`,
        `  Kritiske kunder: ${impact?.criticalCustomers ?? 0}`,
        `  Kunder ute na: ${impact?.disconnectedCustomers ?? 0}`,
      ].join("\n");
    })
    .join("\n");
}

function buildTelemetryLines(dashboard: DashboardPayload): string {
  const feederLines = dashboard.snapshot.feeders.map((feeder) => {
    const control = dashboard.controls.find((item) => item.id === feeder.id);
    const quality = control?.communicationState ?? feeder.quality;
    return `- ${feeder.id}: ${quality}`;
  });

  return [`- T1: ${dashboard.snapshot.transformer.quality}`, ...feederLines].join("\n");
}

export function buildIncidentReportPreview(
  dashboard: DashboardPayload,
  history: DashboardPayload[],
  replayMode: boolean,
): IncidentReportSection[] {
  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  const activeProfileName =
    dashboard.availableProfiles.find((profile) => profile.id === dashboard.activeProfileId)?.name ??
    dashboard.activeProfileId ??
    "Manuell drift";
  const timeline = buildRecentTimeline(history, 6).slice().reverse();
  const recommendedActions = getRecommendedActions(dashboard);
  const totalDisconnectedCustomers = dashboard.snapshot.feeders.reduce(
    (sum, feeder) => sum + feeder.derived.affectedCustomers,
    0,
  );
  const degradedTelemetry = dashboard.controls
    .filter((control) => control.communicationState !== "good")
    .map((control) => `${control.id} (${control.communicationState})`);

  return [
    {
      id: "summary",
      title: "Executive summary",
      tone: highestAlarm ? (highestAlarm.severity === "critical" ? "critical" : "warn") : "good",
      lines: [
        `${formatDate(dashboard.snapshot.timestamp)} ${formatTime(dashboard.snapshot.timestamp)} / ${replayMode ? "Replay" : "Live"}`,
        describeSystemPosture(dashboard),
        inferProbableCause(dashboard, history),
      ],
    },
    {
      id: "impact",
      title: "Impact",
      tone: totalDisconnectedCustomers > 0 ? "warn" : "neutral",
      lines: [
        `${totalDisconnectedCustomers} customers currently affected`,
        `${dashboard.snapshot.feeders.reduce((sum, feeder) => sum + feeder.criticalCustomers, 0)} critical customers connected in network`,
        `Profile: ${activeProfileName}`,
      ],
    },
    {
      id: "actions",
      title: "Recommended actions",
      tone: recommendedActions[0]?.includes("Ingen aktive") ? "good" : "neutral",
      lines: recommendedActions,
    },
    {
      id: "telemetry",
      title: "Telemetry and timeline",
      tone: degradedTelemetry.length ? "warn" : "neutral",
      lines: [
        degradedTelemetry.length ? `Degraded telemetry: ${degradedTelemetry.join(", ")}` : "Telemetry quality is stable.",
        ...timeline.map((event) => `${formatTime(event.timestamp)} ${event.source}: ${event.description}`),
      ],
    },
  ];
}

export function buildIncidentReport(
  dashboard: DashboardPayload,
  history: DashboardPayload[],
  replayMode: boolean,
): string {
  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  const activeProfileName =
    dashboard.availableProfiles.find((profile) => profile.id === dashboard.activeProfileId)?.name ??
    dashboard.activeProfileId ??
    "Manuell drift";
  const activeEventNames = dashboard.activeTimedEvents.map((event) => event.name).join(", ");
  const recentTimeline = buildRecentTimeline(history);
  const feedersOut = dashboard.snapshot.feeders.filter((feeder) => feeder.breakerStatus !== "closed");
  const totalDisconnectedCustomers = dashboard.snapshot.feeders.reduce(
    (sum, feeder) => sum + feeder.derived.affectedCustomers,
    0,
  );
  const totalCriticalCustomers = dashboard.snapshot.feeders.reduce((sum, feeder) => sum + feeder.criticalCustomers, 0);
  const acknowledgedCount = dashboard.activeAlarms.filter((alarm) => alarm.state === "acknowledged").length;
  const degradedTelemetry = dashboard.controls
    .filter((control) => control.communicationState !== "good")
    .map((control) => `${control.id} (${control.communicationState})`);
  const peakFeeder = dashboard.snapshot.feeders.reduce((highest, feeder) =>
    feeder.derived.utilizationPercent > highest.derived.utilizationPercent ? feeder : highest,
  );
  const recommendedActions = getRecommendedActions(dashboard);
  const alarmLines = sortAlarms(dashboard.activeAlarms)
    .map(
      (alarm) =>
        `- ${alarm.objectId}: ${alarm.title} (${alarm.severity}, ${alarm.state})` +
        (alarm.message ? `\n  ${alarm.message}` : ""),
    )
    .join("\n");
  const timelineLines = recentTimeline
    .slice()
    .reverse()
    .map((event) => `- ${formatTime(event.timestamp)} ${event.source}: ${event.description}`)
    .join("\n");
  const historyStart = history[0]?.snapshot.timestamp ?? null;
  const historyEnd = history[history.length - 1]?.snapshot.timestamp ?? null;

  return [
    "# Mini Grid SCADA - incident report",
    "",
    "## Executive summary",
    `Timestamp: ${formatDate(dashboard.snapshot.timestamp)} ${formatTime(dashboard.snapshot.timestamp)}`,
    `Mode: ${replayMode ? "Replay frame" : "Live dashboard"}`,
    `Station: ${dashboard.snapshot.stationId}`,
    `System posture: ${describeSystemPosture(dashboard)}`,
    `Probable cause: ${inferProbableCause(dashboard, history)}`,
    highestAlarm
      ? `Highest priority alarm: ${highestAlarm.objectId} - ${highestAlarm.title}`
      : "Highest priority alarm: None active",
    `Transformer load: ${dashboard.snapshot.transformer.loadPercent}%`,
    `Disconnected customers: ${totalDisconnectedCustomers}`,
    `Open/tripped feeders: ${feedersOut.map((feeder) => feeder.id).join(", ") || "None"}`,
    `Peak feeder utilization: ${peakFeeder.id} ${peakFeeder.derived.utilizationPercent}%`,
    "",
    "## Operating context",
    `Profile: ${activeProfileName}`,
    `Timed events: ${activeEventNames || "None"}`,
    `Scenario: ${dashboard.activeScenarioId ?? "none"}`,
    `API health: ${dashboard.health.apiStatus}`,
    `Broker status: ${dashboard.health.brokerStatus}`,
    `WebSocket clients: ${dashboard.health.websocketClients}`,
    historyStart && historyEnd
      ? `Replay window: ${formatTime(historyStart)} - ${formatTime(historyEnd)} (${history.length} frames)`
      : "Replay window: Not available",
    `Acknowledged active alarms: ${acknowledgedCount}`,
    `Telemetry warnings: ${degradedTelemetry.join(", ") || "None"}`,
    "",
    "## Customer and service impact",
    `Total customers connected: ${dashboard.snapshot.feeders.reduce((sum, feeder) => sum + feeder.customers, 0)}`,
    `Total critical customers: ${totalCriticalCustomers}`,
    `Customers currently affected: ${totalDisconnectedCustomers}`,
    buildImpactLines(dashboard),
    "",
    "## Telemetry quality",
    buildTelemetryLines(dashboard),
    "",
    "## Recommended actions",
    ...recommendedActions.map((item) => `- ${item}`),
    "",
    "## Active alarms",
    alarmLines || "- None",
    "",
    "## Event timeline",
    timelineLines || "- No recent events",
    "",
    "## Feeder state",
    buildFeederReportLines(dashboard),
  ].join("\n");
}
