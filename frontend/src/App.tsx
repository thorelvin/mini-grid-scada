import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { formatTime, getHighestPriorityAlarm } from "./dashboard-utils";
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
import { buildIncidentReport, buildRecentTimeline, buildIncidentReportPreview } from "./incident-utils";
import { useTelemetryStore } from "./state/useTelemetryStore";
import type { DashboardPayload } from "./types";

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
    if (dashboardHistory.length === 0 || replayIndex == null) {
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

  const reportPreviewSections = useMemo(
    () =>
      renderedDashboard
        ? buildIncidentReportPreview(renderedDashboard, dashboardHistory, replayMode)
        : [],
    [dashboardHistory, renderedDashboard, replayMode],
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
          Replay aktiv: viser frame fra {formatTime(renderedDashboard.snapshot.timestamp)}. Operatorkommandoer er last til du gar tilbake til live.
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
            reportPreviewSections={reportPreviewSections}
            onSelectAsset={setSelectedAssetId}
            onJumpToTimestamp={handleJumpToTimestamp}
            onExportReport={exportReport}
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
