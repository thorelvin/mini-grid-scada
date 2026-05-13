import { useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  formatDate,
  formatTime,
  formatVoltageRangeLabel,
  getHighestPriorityAlarm,
  sortAlarms,
} from "./dashboard-utils";
import { AlarmList } from "./components/AlarmList";
import { EventLog } from "./components/EventLog";
import { IncidentSummaryPanel } from "./components/IncidentSummaryPanel";
import { ReplayTimeline } from "./components/ReplayTimeline";
import { SelectedObjectPanel } from "./components/SelectedObjectPanel";
import { SimulatorPanel } from "./components/SimulatorPanel";
import { SingleLineDiagram } from "./components/SingleLineDiagram";
import { StatusFooter } from "./components/StatusFooter";
import { TopBar } from "./components/TopBar";
import { TrendCharts } from "./components/TrendCharts";
import { useTelemetryStore } from "./state/useTelemetryStore";
import { getBreakerOutcomeLabel, getTopologyImpactSummary } from "./topology-utils";
import type { Alarm, DashboardPayload, EventEntry } from "./types";

function buildRecentTimeline(history: DashboardPayload[]): EventEntry[] {
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
    .slice(0, 12);
}

function getRecommendedActions(dashboard: DashboardPayload): string[] {
  const recommendations = new Set<string>();

  for (const alarm of sortAlarms(dashboard.activeAlarms)) {
    if (alarm.title === "Breaker tripped") {
      recommendations.add(`Hold ${alarm.objectId} ute til tripårsak er ryddet og alarmen er kvittert.`);
    } else if (alarm.title === "Protection trip threshold exceeded" || alarm.title === "Overload warning") {
      recommendations.add(`Reduser belastningen på ${alarm.objectId} før ny gjeninnkobling eller videre lastøkning.`);
    } else if (alarm.title === "Communication degraded") {
      recommendations.add(`Behandle kommandoer mot ${alarm.objectId} konservativt til datakvaliteten er tilbake til OK.`);
    } else if (alarm.title === "Phase imbalance") {
      recommendations.add(`Se over fasefordeling på ${alarm.objectId} for å redusere ubalanse.`);
    } else if (alarm.title === "Undervoltage" || alarm.title === "Overvoltage") {
      recommendations.add(`Kontroller spenningsnivåene på ${alarm.objectId} og vurder last, produksjon eller koblingsstatus.`);
    }
  }

  if (recommendations.size === 0) {
    recommendations.add("Ingen aktive tiltak er påkrevd akkurat nå.");
  }

  return [...recommendations];
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
        `  Berørte kunder: ${impact?.disconnectedCustomers ?? feeder.derived.affectedCustomers}`,
        `  Siste tripårsak: ${feeder.protection.lastTripReason ?? "ingen"}`,
      ].join("\n");
    })
    .join("\n");
}

function describeSystemPosture(dashboard: DashboardPayload): string {
  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  if (highestAlarm) {
    return `Aktiv hendelse: ${highestAlarm.objectId} ${highestAlarm.title}`;
  }

  const trippedFeeders = dashboard.snapshot.feeders.filter((feeder) => feeder.breakerStatus === "tripped");
  if (trippedFeeders.length > 0) {
    return `Restfeil i nettet: ${trippedFeeders.map((feeder) => feeder.id).join(", ")}`;
  }

  const openFeeders = dashboard.snapshot.feeders.filter((feeder) => feeder.breakerStatus === "open");
  if (openFeeders.length > 0) {
    return `Planlagt eller manuell utkobling: ${openFeeders.map((feeder) => feeder.id).join(", ")}`;
  }

  return "Normal drift uten aktive alarmer.";
}

function buildImpactLines(dashboard: DashboardPayload): string {
  return dashboard.snapshot.feeders
    .map((feeder) => {
      const impact = getTopologyImpactSummary(dashboard.topology, dashboard.snapshot, feeder.id);
      return [
        `- ${feeder.id}: ${getBreakerOutcomeLabel(feeder.breakerStatus)}`,
        `  Kunder på gren: ${impact?.totalCustomers ?? feeder.customers}`,
        `  Kritiske kunder: ${impact?.criticalCustomers ?? 0}`,
        `  Kunder ute nå: ${impact?.disconnectedCustomers ?? 0}`,
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

  return [
    `- T1: ${dashboard.snapshot.transformer.quality}`,
    ...feederLines,
  ].join("\n");
}

function buildIncidentReport(
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
  const peakFeeder =
    dashboard.snapshot.feeders.reduce((highest, feeder) =>
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

function clampReplayIndex(index: number, size: number): number {
  return Math.max(0, Math.min(index, Math.max(size - 1, 0)));
}

function findNearestHistoryIndex(history: DashboardPayload[], timestamp: string): number {
  const targetTime = new Date(timestamp).getTime();
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let index = 0; index < history.length; index += 1) {
    const currentTime = new Date(history[index].snapshot.timestamp).getTime();
    const delta = Math.abs(currentTime - targetTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export default function App() {
  const {
    dashboard,
    dashboardHistory,
    connectionStatus,
    error,
    isPending,
    patchFeederControl,
    patchSimulatorSettings,
    runScenario,
    runProfile,
    runTimedEvent,
    resetToNormal,
    executeOpenBreaker,
    executeCloseBreaker,
    acknowledge,
    acknowledgeAll,
  } = useTelemetryStore();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);

  const liveDashboard = useDeferredValue(dashboard);
  const replayFrame =
    replayIndex != null && dashboardHistory.length
      ? dashboardHistory[clampReplayIndex(replayIndex, dashboardHistory.length)]
      : null;
  const renderedDashboard = replayFrame ?? liveDashboard;
  const replayMode = replayIndex !== null;
  const replayBusy = isPending || replayMode;

  useEffect(() => {
    if (dashboardHistory.length === 0) {
      return;
    }
    if (replayIndex == null) {
      return;
    }
    if (replayIndex >= dashboardHistory.length) {
      setReplayIndex(dashboardHistory.length - 1);
    }
  }, [dashboardHistory.length, replayIndex]);

  useEffect(() => {
    if (!isReplayPlaying || dashboardHistory.length < 2) {
      return;
    }

    const handle = window.setInterval(() => {
      setReplayIndex((current) => {
        const baseIndex = current ?? Math.max(0, dashboardHistory.length - Math.min(dashboardHistory.length, 30));
        if (baseIndex >= dashboardHistory.length - 1) {
          window.clearInterval(handle);
          setIsReplayPlaying(false);
          return dashboardHistory.length - 1;
        }
        return baseIndex + 1;
      });
    }, 700);

    return () => window.clearInterval(handle);
  }, [dashboardHistory.length, isReplayPlaying]);

  useEffect(() => {
    if (!renderedDashboard || selectedAssetId) {
      return;
    }
    const highestAlarm = getHighestPriorityAlarm(renderedDashboard.activeAlarms);
    setSelectedAssetId(highestAlarm?.objectId ?? renderedDashboard.snapshot.feeders[0]?.id ?? "T1");
  }, [renderedDashboard, selectedAssetId]);

  useEffect(() => {
    if (!renderedDashboard || !selectedAssetId) {
      return;
    }
    const validIds = new Set([
      ...renderedDashboard.topology.assets.map((asset) => asset.id),
      ...renderedDashboard.snapshot.feeders.map((feeder) => feeder.id),
    ]);
    if (!validIds.has(selectedAssetId)) {
      setSelectedAssetId(renderedDashboard.snapshot.feeders[0]?.id ?? "T1");
    }
  }, [renderedDashboard, selectedAssetId]);

  const recentReplayEvents = useMemo(
    () => buildRecentTimeline(dashboardHistory),
    [dashboardHistory],
  );

  function exportReport() {
    if (!renderedDashboard) {
      return;
    }
    const reportText = buildIncidentReport(renderedDashboard, dashboardHistory, replayMode);
    const blob = new Blob([reportText], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `scada-report-${new Date().toISOString().replace(/:/g, "-")}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  }

  function handleSelectReplayIndex(index: number) {
    setReplayIndex(clampReplayIndex(index, dashboardHistory.length));
    setIsReplayPlaying(false);
  }

  function handleStepReplay(delta: number) {
    setReplayIndex((current) => {
      const baseIndex = current ?? Math.max(dashboardHistory.length - 1, 0);
      return clampReplayIndex(baseIndex + delta, dashboardHistory.length);
    });
    setIsReplayPlaying(false);
  }

  function handleToggleReplay() {
    if (dashboardHistory.length < 2) {
      return;
    }
    setReplayIndex((current) =>
      current ?? Math.max(0, dashboardHistory.length - Math.min(dashboardHistory.length, 30)),
    );
    setIsReplayPlaying((current) => !current);
  }

  function handleJumpLive() {
    setReplayIndex(null);
    setIsReplayPlaying(false);
  }

  function handleJumpToTimestamp(timestamp: string) {
    if (dashboardHistory.length === 0) {
      return;
    }

    setReplayIndex(findNearestHistoryIndex(dashboardHistory, timestamp));
    setIsReplayPlaying(false);
  }

  return (
    <div className="app-shell">
      <TopBar dashboard={renderedDashboard} connectionStatus={connectionStatus} />

      {error ? <div className="banner">{error}</div> : null}
      {replayMode && renderedDashboard ? (
        <div className="banner">
          Replay aktiv: viser frame fra {formatTime(renderedDashboard.snapshot.timestamp)}. Operatørkommandoer er låst til du går tilbake til live.
        </div>
      ) : null}

      <main className="dashboard-grid">
        <aside className="left-column">
          <AlarmList
            alarms={renderedDashboard?.activeAlarms ?? []}
            selectedAssetId={selectedAssetId}
            onAcknowledge={replayMode ? async () => undefined : acknowledge}
            onAcknowledgeAll={replayMode ? async () => undefined : () => acknowledgeAll()}
            onSelectAsset={setSelectedAssetId}
            readOnly={replayMode}
          />
          <TrendCharts
            trends={renderedDashboard?.trends ?? null}
            dashboardTimestamp={renderedDashboard?.snapshot.timestamp ?? null}
            focusTimestamp={replayMode ? renderedDashboard?.snapshot.timestamp ?? null : null}
            selectedAssetId={selectedAssetId}
            snapshot={renderedDashboard?.snapshot ?? null}
          />
          <EventLog
            events={(replayMode ? recentReplayEvents : renderedDashboard?.recentEvents) ?? []}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
          />
        </aside>

        <section className="center-column">
          <SingleLineDiagram
            snapshot={renderedDashboard?.snapshot ?? null}
            alarms={renderedDashboard?.activeAlarms ?? []}
            controls={renderedDashboard?.controls ?? []}
            selectedAssetId={selectedAssetId}
            onSelect={setSelectedAssetId}
          />
          <ReplayTimeline
            history={dashboardHistory}
            replayIndex={replayIndex}
            isPlaying={isReplayPlaying}
            onSelectIndex={handleSelectReplayIndex}
            onStep={handleStepReplay}
            onTogglePlay={handleToggleReplay}
            onJumpLive={handleJumpLive}
          />
          <IncidentSummaryPanel
            dashboard={renderedDashboard}
            history={dashboardHistory}
            replayMode={replayMode}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
            onJumpToTimestamp={handleJumpToTimestamp}
          />
        </section>

        <aside className="right-column">
          <SelectedObjectPanel
            topology={renderedDashboard?.topology ?? null}
            snapshot={renderedDashboard?.snapshot ?? null}
            alarms={renderedDashboard?.activeAlarms ?? []}
            controls={renderedDashboard?.controls ?? []}
            selectedAssetId={selectedAssetId}
            lastCommandResult={renderedDashboard?.lastCommandResult ?? null}
            busy={replayBusy}
            onOpenBreaker={executeOpenBreaker}
            onCloseBreaker={executeCloseBreaker}
            onAcknowledgeAll={acknowledgeAll}
          />
          <SimulatorPanel
            controls={renderedDashboard?.controls ?? []}
            simulatorSettings={renderedDashboard?.simulatorSettings ?? null}
            scenarios={renderedDashboard?.availableScenarios ?? []}
            profiles={renderedDashboard?.availableProfiles ?? []}
            timedEvents={renderedDashboard?.availableTimedEvents ?? []}
            activeProfileId={renderedDashboard?.activeProfileId}
            activeProfileStartedAt={renderedDashboard?.activeProfileStartedAt ?? null}
            activeTimedEvents={renderedDashboard?.activeTimedEvents ?? []}
            activeScenarioId={renderedDashboard?.activeScenarioId}
            activeScenarioStartedAt={renderedDashboard?.activeScenarioStartedAt ?? null}
            busy={replayBusy}
            onApplyControl={patchFeederControl}
            onApplySettings={patchSimulatorSettings}
            onRunScenario={runScenario}
            onRunProfile={runProfile}
            onRunTimedEvent={runTimedEvent}
            onReset={resetToNormal}
          />
        </aside>
      </main>

      <StatusFooter
        dashboard={renderedDashboard}
        connectionStatus={connectionStatus}
        onExportReport={exportReport}
      />
    </div>
  );
}
