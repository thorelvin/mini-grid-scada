import {
  formatDate,
  formatTime,
  formatVoltageRangeLabel,
  getHighestPriorityAlarm,
  getSeverityLabel,
  sortAlarms,
} from "./dashboard-utils";
import { getBreakerOutcomeLabel, getStationBreakerRestoreAssessment, getTopologyImpactSummary } from "./topology-utils";
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

export interface IncidentHistoryScope {
  id: string;
  label: string;
  startTimestamp: string | null;
  endTimestamp: string | null;
}

export type DrillStepStatus = "done" | "ready" | "blocked" | "pending";

export interface StationDrillStep {
  id: string;
  title: string;
  detail: string;
  status: DrillStepStatus;
  assetId: string | null;
}

export interface StationDrillCheckpoint {
  id: string;
  label: string;
  value: string;
  tone: "good" | "warn" | "critical" | "neutral";
}

export interface StationDrillPlan {
  headline: string;
  posture: string;
  activeBreakerId: "BRK-IN" | "LV-BRK" | null;
  checkpoints: StationDrillCheckpoint[];
  blockers: string[];
  notes: string[];
  steps: StationDrillStep[];
  branchSummary: {
    ready: number;
    blocked: number;
    held: number;
    live: number;
    totalCustomers: number;
    criticalCustomers: number;
  };
}

export interface IncidentExportPackage {
  packageVersion: string;
  generatedAt: string;
  stationId: string;
  mode: "live" | "replay";
  scope: {
    id: string;
    label: string;
    startTimestamp: string | null;
    endTimestamp: string | null;
    frameCount: number;
    eventCount: number;
  };
  notes: string | null;
  summary: IncidentReportSection[];
  reportMarkdown: string;
  stationDrill: StationDrillPlan;
  activeAlarms: Alarm[];
  focusAssets: Array<{
    id: string;
    name: string;
    affectedCustomers: number;
    utilizationPercent: number;
    breakerStatus: string;
  }>;
  events: EventEntry[];
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

export function sliceHistoryByTimestamp(
  history: DashboardPayload[],
  startTimestamp: string | null,
  endTimestamp: string | null,
): DashboardPayload[] {
  if (!startTimestamp && !endTimestamp) {
    return history;
  }

  const startMs = startTimestamp ? new Date(startTimestamp).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = endTimestamp ? new Date(endTimestamp).getTime() : Number.POSITIVE_INFINITY;

  return history.filter((frame) => {
    const frameMs = new Date(frame.snapshot.timestamp).getTime();
    return frameMs >= startMs && frameMs <= endMs;
  });
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

export function buildStationDrillPlan(dashboard: DashboardPayload): StationDrillPlan {
  const inletAssessment = getStationBreakerRestoreAssessment(
    dashboard.topology,
    dashboard.snapshot,
    dashboard.activeAlarms,
    dashboard.controls,
    "BRK-IN",
  );
  const busAssessment = getStationBreakerRestoreAssessment(
    dashboard.topology,
    dashboard.snapshot,
    dashboard.activeAlarms,
    dashboard.controls,
    "LV-BRK",
  );
  const stationImpact = getTopologyImpactSummary(dashboard.topology, dashboard.snapshot, "LV-BRK");
  const inletClosed = dashboard.snapshot.stationBreakers.find((breaker) => breaker.id === "BRK-IN")?.breakerStatus === "closed";
  const lvClosed = dashboard.snapshot.stationBreakers.find((breaker) => breaker.id === "LV-BRK")?.breakerStatus === "closed";
  const transformerHealthy =
    dashboard.snapshot.transformer.quality === "good" && dashboard.snapshot.transformer.secondaryVoltageV > 40;
  const degradedSignals =
    dashboard.controls.filter((control) => control.communicationState !== "good").length +
    (dashboard.snapshot.transformer.quality !== "good" ? 1 : 0);
  const readyBranches = busAssessment.closeBranchPreview.filter((item) => item.action === "restore").length;
  const blockedBranches = busAssessment.closeBranchPreview.filter((item) => item.action === "blocked").length;
  const heldBranches = busAssessment.closeBranchPreview.filter(
    (item) => item.action === "hold" || item.action === "already_out",
  ).length;
  const liveBranches = busAssessment.closeBranchPreview.filter((item) => item.action === "already_live").length;
  const blockers = [...new Set([...inletAssessment.blockingReasons, ...busAssessment.blockingReasons])];
  const notes = [...new Set([...inletAssessment.advisoryNotes, ...busAssessment.advisoryNotes])].slice(0, 4);

  let headline = "Station path is healthy";
  let posture = "No station-level restore steps are pending right now.";
  let activeBreakerId: "BRK-IN" | "LV-BRK" | null = null;

  if (!inletClosed) {
    headline = "Start restore with BRK-IN";
    posture = lvClosed
      ? "Transformer path is open while the low-voltage breaker is still in. Treat BRK-IN as the first restore step."
      : "Station path is isolated upstream. Energize the transformer first, then restore the bus.";
    activeBreakerId = "BRK-IN";
  } else if (!lvClosed) {
    headline = "Transformer is live, bus is held out";
    posture = "Use LV-BRK when downstream telemetry, trips, and alarms are ready for a controlled bus restore.";
    activeBreakerId = "LV-BRK";
  } else if (blockedBranches > 0) {
    headline = "Bus is live, but some branches remain blocked";
    posture = `${blockedBranches} downstream branches still require cleanup before full restoration is complete.`;
    activeBreakerId = "LV-BRK";
  } else if (heldBranches > 0) {
    headline = "Bus is live with intentional branch isolation";
    posture = `${heldBranches} branches are still held out and can be restored feeder-by-feeder when operations is ready.`;
    activeBreakerId = "LV-BRK";
  }

  const steps: StationDrillStep[] = [
    {
      id: "review-posture",
      title: "Review alarms and telemetry posture",
      detail: blockers.length
        ? `Clear ${blockers.length} blocking conditions before you continue station restore.`
        : degradedSignals > 0 || dashboard.activeAlarms.length > 0
          ? `${dashboard.activeAlarms.length} active alarms and ${degradedSignals} degraded signals should be reviewed before switching.`
          : "Alarm and telemetry posture is already clean for station switching.",
      status: blockers.length ? "blocked" : degradedSignals > 0 || dashboard.activeAlarms.length > 0 ? "ready" : "done",
      assetId: activeBreakerId,
    },
    {
      id: "close-brk-in",
      title: "Restore or verify BRK-IN",
      detail: inletClosed
        ? "BRK-IN is already closed and the transformer path is available."
        : inletAssessment.readyToClose
          ? inletAssessment.nextAction
          : inletAssessment.blockingReasons[0] ?? "BRK-IN still needs upstream review before closure.",
      status: inletClosed ? "done" : inletAssessment.readyToClose ? "ready" : "blocked",
      assetId: "BRK-IN",
    },
    {
      id: "verify-transformer",
      title: "Verify transformer secondary before bus restore",
      detail: !inletClosed
        ? "Close BRK-IN first, then confirm T1 secondary voltage and quality before touching the bus."
        : transformerHealthy
          ? `Transformer is healthy at ${Math.round(dashboard.snapshot.transformer.secondaryVoltageV)} V secondary.`
          : "Transformer quality or secondary voltage is not yet healthy enough for controlled bus restore.",
      status: !inletClosed ? "pending" : transformerHealthy ? "done" : "blocked",
      assetId: "T1",
    },
    {
      id: "close-lv-brk",
      title: "Restore or verify LV-BRK",
      detail: lvClosed
        ? "LV-BRK is already closed and the low-voltage bus is energized."
        : !inletClosed
          ? "BRK-IN must be closed and transformer health verified before LV-BRK can restore the bus."
          : busAssessment.readyToClose
            ? busAssessment.nextAction
            : busAssessment.blockingReasons[0] ?? "LV-BRK still requires downstream cleanup.",
      status: lvClosed ? "done" : !inletClosed ? "pending" : busAssessment.readyToClose ? "ready" : "blocked",
      assetId: "LV-BRK",
    },
    {
      id: "verify-branches",
      title: "Verify downstream branches one by one",
      detail: !lvClosed
        ? `${readyBranches} branches are queued for restore once the bus is back.`
        : blockedBranches > 0
          ? `${blockedBranches} branches remain blocked, ${readyBranches} can still be restored, and ${heldBranches} are intentionally held out.`
          : heldBranches > 0
            ? `${heldBranches} branches are intentionally held out. Restore them feeder-by-feeder when it is operationally safe.`
            : "All downstream branches are energized or already accounted for in the current topology posture.",
      status: !lvClosed ? "pending" : blockedBranches > 0 ? "blocked" : heldBranches > 0 ? "ready" : "done",
      assetId: "LV-BRK",
    },
  ];

  const checkpoints: StationDrillCheckpoint[] = [
    {
      id: "brk-in",
      label: "BRK-IN",
      value: inletClosed ? "Closed" : "Open",
      tone: inletClosed ? "good" : "warn",
    },
    {
      id: "t1-secondary",
      label: "T1 secondary",
      value: `${Math.round(dashboard.snapshot.transformer.secondaryVoltageV)} V`,
      tone: transformerHealthy ? "good" : "warn",
    },
    {
      id: "lv-brk",
      label: "LV-BRK",
      value: lvClosed ? "Closed" : "Open",
      tone: lvClosed ? "good" : "warn",
    },
    {
      id: "ready-branches",
      label: "Ready branches",
      value: String(readyBranches),
      tone: readyBranches > 0 ? "good" : "neutral",
    },
    {
      id: "blocked-branches",
      label: "Blocked branches",
      value: String(blockedBranches),
      tone: blockedBranches > 0 ? "warn" : "good",
    },
    {
      id: "held-branches",
      label: "Held out",
      value: String(heldBranches),
      tone: heldBranches > 0 ? "neutral" : "good",
    },
  ];

  return {
    headline,
    posture,
    activeBreakerId,
    checkpoints,
    blockers,
    notes,
    steps,
    branchSummary: {
      ready: readyBranches,
      blocked: blockedBranches,
      held: heldBranches,
      live: liveBranches,
      totalCustomers: stationImpact?.totalCustomers ?? 0,
      criticalCustomers: stationImpact?.criticalCustomers ?? 0,
    },
  };
}

export function buildIncidentReportPreview(
  dashboard: DashboardPayload,
  history: DashboardPayload[],
  replayMode: boolean,
  scopeLabel = "Hele vinduet",
  incidentNotes = "",
): IncidentReportSection[] {
  const stationDrill = buildStationDrillPlan(dashboard);
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
        `Scope: ${scopeLabel}`,
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
      id: "station-drill",
      title: "Guided station drill",
      tone: stationDrill.blockers.length ? "warn" : stationDrill.activeBreakerId ? "neutral" : "good",
      lines: [
        stationDrill.headline,
        stationDrill.posture,
        `Branches ready/blocked/held: ${stationDrill.branchSummary.ready}/${stationDrill.branchSummary.blocked}/${stationDrill.branchSummary.held}`,
        stationDrill.steps.find((step) => step.status === "ready" || step.status === "blocked")?.detail ??
          "No station-level restore action is pending right now.",
      ],
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
    ...(incidentNotes.trim()
      ? [
          {
            id: "notes",
            title: "Operator notes",
            tone: "neutral" as const,
            lines: incidentNotes
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          },
        ]
      : []),
  ];
}

export function buildIncidentReport(
  dashboard: DashboardPayload,
  history: DashboardPayload[],
  replayMode: boolean,
  scopeLabel = "Hele vinduet",
  incidentNotes = "",
): string {
  const stationDrill = buildStationDrillPlan(dashboard);
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
    `Scope: ${scopeLabel}`,
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
    "## Guided station drill",
    `Headline: ${stationDrill.headline}`,
    `Posture: ${stationDrill.posture}`,
    `Active breaker focus: ${stationDrill.activeBreakerId ?? "none"}`,
    `Branches ready/blocked/held/live: ${stationDrill.branchSummary.ready}/${stationDrill.branchSummary.blocked}/${stationDrill.branchSummary.held}/${stationDrill.branchSummary.live}`,
    ...(stationDrill.blockers.length
      ? ["Blocking conditions:", ...stationDrill.blockers.map((item) => `- ${item}`)]
      : ["Blocking conditions: none"]),
    "Restore checklist:",
    ...stationDrill.steps.map(
      (step, index) => `${index + 1}. [${step.status.toUpperCase()}] ${step.title} - ${step.detail}`,
    ),
    "",
    "## Active alarms",
    alarmLines || "- None",
    "",
    "## Event timeline",
    timelineLines || "- No recent events",
    "",
    "## Feeder state",
    buildFeederReportLines(dashboard),
    ...(incidentNotes.trim()
      ? [
          "",
          "## Operator notes",
          incidentNotes.trim(),
        ]
      : []),
  ].join("\n");
}

export function buildIncidentExportPackage(
  dashboard: DashboardPayload,
  history: DashboardPayload[],
  replayMode: boolean,
  scope: IncidentHistoryScope,
  incidentNotes: string,
): IncidentExportPackage {
  const stationDrill = buildStationDrillPlan(dashboard);
  const summary = buildIncidentReportPreview(dashboard, history, replayMode, scope.label, incidentNotes);
  const reportMarkdown = buildIncidentReport(dashboard, history, replayMode, scope.label, incidentNotes);
  const focusAssets = buildFocusFeeders(dashboard).map(({ feeder, affectedCustomers }) => ({
    id: feeder.id,
    name: feeder.name,
    affectedCustomers,
    utilizationPercent: feeder.derived.utilizationPercent,
    breakerStatus: feeder.breakerStatus,
  }));
  const events = buildRecentTimeline(history, 32).slice().reverse();

  return {
    packageVersion: "0.3.0",
    generatedAt: new Date().toISOString(),
    stationId: dashboard.snapshot.stationId,
    mode: replayMode ? "replay" : "live",
    scope: {
      id: scope.id,
      label: scope.label,
      startTimestamp: scope.startTimestamp,
      endTimestamp: scope.endTimestamp,
      frameCount: history.length,
      eventCount: events.length,
    },
    notes: incidentNotes.trim() || null,
    summary,
    reportMarkdown,
    stationDrill,
    activeAlarms: sortAlarms(dashboard.activeAlarms),
    focusAssets,
    events,
  };
}
