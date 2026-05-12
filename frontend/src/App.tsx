import { useDeferredValue, useEffect, useState } from "react";

import { formatDate, formatTime, getHighestPriorityAlarm, sortAlarms } from "./dashboard-utils";
import { AlarmList } from "./components/AlarmList";
import { EventLog } from "./components/EventLog";
import { SelectedObjectPanel } from "./components/SelectedObjectPanel";
import { SimulatorPanel } from "./components/SimulatorPanel";
import { SingleLineDiagram } from "./components/SingleLineDiagram";
import { StatusFooter } from "./components/StatusFooter";
import { TopBar } from "./components/TopBar";
import { TrendCharts } from "./components/TrendCharts";
import { useTelemetryStore } from "./state/useTelemetryStore";

function buildReportText(dashboard: NonNullable<ReturnType<typeof useTelemetryStore>["dashboard"]>): string {
  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  const activeProfileName =
    dashboard.availableProfiles.find((profile) => profile.id === dashboard.activeProfileId)?.name ??
    dashboard.activeProfileId ??
    "Custom";
  const activeEventNames = dashboard.activeTimedEvents.map((event) => event.name).join(", ");
  const feeders = dashboard.snapshot.feeders
    .map((feeder) =>
      [
        `- ${feeder.id} ${feeder.name}`,
        `  Status: ${feeder.breakerStatus}`,
        `  Effekt: ${feeder.activePowerKw} kW`,
        `  Utnyttelse: ${feeder.derived.utilizationPercent}%`,
        `  Kvalitet: ${feeder.quality}`,
      ].join("\n"),
    )
    .join("\n");
  const alarmLines = sortAlarms(dashboard.activeAlarms)
    .map((alarm) => `- ${alarm.objectId}: ${alarm.title} (${alarm.severity}, ${alarm.state})`)
    .join("\n");

  return [
    "# Mini Grid SCADA - hendelsesrapport",
    "",
    `Tidspunkt: ${formatDate(dashboard.snapshot.timestamp)} ${formatTime(dashboard.snapshot.timestamp)}`,
    `Stasjon: ${dashboard.snapshot.stationId}`,
    `Profil: ${activeProfileName}`,
    `Aktive hendelser: ${activeEventNames || "Ingen"}`,
    `Feilscenario: ${dashboard.activeScenarioId ?? "ingen"}`,
    `Forbindelse: ${dashboard.health.apiStatus}`,
    "",
    "## Situasjonsbilde",
    highestAlarm
      ? `Høyeste prioritet: ${highestAlarm.objectId} - ${highestAlarm.title}`
      : "Høyeste prioritet: Ingen aktive alarmer",
    `Trafolast: ${dashboard.snapshot.transformer.loadPercent}%`,
    `Datakvalitet (snitt): ${dashboard.snapshot.feeders.map((feeder) => feeder.quality).join(", ")}`,
    "",
    "## Feedere",
    feeders,
    "",
    "## Aktive alarmer",
    alarmLines || "- Ingen aktive alarmer",
  ].join("\n");
}

export default function App() {
  const {
    dashboard,
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
  const deferredDashboard = useDeferredValue(dashboard);

  useEffect(() => {
    if (!deferredDashboard || selectedAssetId) {
      return;
    }
    const highestAlarm = getHighestPriorityAlarm(deferredDashboard.activeAlarms);
    setSelectedAssetId(highestAlarm?.objectId ?? deferredDashboard.snapshot.feeders[0]?.id ?? "T1");
  }, [deferredDashboard, selectedAssetId]);

  useEffect(() => {
    if (!deferredDashboard || !selectedAssetId) {
      return;
    }
    const validIds = new Set(["T1", ...deferredDashboard.snapshot.feeders.map((feeder) => feeder.id)]);
    if (!validIds.has(selectedAssetId)) {
      setSelectedAssetId(deferredDashboard.snapshot.feeders[0]?.id ?? "T1");
    }
  }, [deferredDashboard, selectedAssetId]);

  function exportReport() {
    if (!deferredDashboard) {
      return;
    }
    const reportText = buildReportText(deferredDashboard);
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

  return (
    <div className="app-shell">
      <TopBar dashboard={deferredDashboard} connectionStatus={connectionStatus} />

      {error ? <div className="banner">{error}</div> : null}

      <main className="dashboard-grid">
        <aside className="left-column">
          <AlarmList
            alarms={deferredDashboard?.activeAlarms ?? []}
            selectedAssetId={selectedAssetId}
            onAcknowledge={acknowledge}
            onAcknowledgeAll={() => acknowledgeAll()}
            onSelectAsset={setSelectedAssetId}
          />
          <EventLog
            events={deferredDashboard?.recentEvents ?? []}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
          />
        </aside>

        <section className="center-column">
          <SingleLineDiagram
            snapshot={deferredDashboard?.snapshot ?? null}
            alarms={deferredDashboard?.activeAlarms ?? []}
            controls={deferredDashboard?.controls ?? []}
            selectedAssetId={selectedAssetId}
            onSelect={setSelectedAssetId}
          />
          <TrendCharts
            trends={deferredDashboard?.trends ?? null}
            dashboardTimestamp={deferredDashboard?.snapshot.timestamp ?? null}
          />
        </section>

        <aside className="right-column">
          <SelectedObjectPanel
            snapshot={deferredDashboard?.snapshot ?? null}
            alarms={deferredDashboard?.activeAlarms ?? []}
            controls={deferredDashboard?.controls ?? []}
            selectedAssetId={selectedAssetId}
            lastCommandResult={deferredDashboard?.lastCommandResult ?? null}
            busy={isPending}
            onOpenBreaker={executeOpenBreaker}
            onCloseBreaker={executeCloseBreaker}
            onAcknowledgeAll={acknowledgeAll}
          />
          <SimulatorPanel
            controls={deferredDashboard?.controls ?? []}
            simulatorSettings={deferredDashboard?.simulatorSettings ?? null}
            scenarios={deferredDashboard?.availableScenarios ?? []}
            profiles={deferredDashboard?.availableProfiles ?? []}
            timedEvents={deferredDashboard?.availableTimedEvents ?? []}
            activeProfileId={deferredDashboard?.activeProfileId}
            activeProfileStartedAt={deferredDashboard?.activeProfileStartedAt ?? null}
            activeTimedEvents={deferredDashboard?.activeTimedEvents ?? []}
            activeScenarioId={deferredDashboard?.activeScenarioId}
            activeScenarioStartedAt={deferredDashboard?.activeScenarioStartedAt ?? null}
            busy={isPending}
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
        dashboard={deferredDashboard}
        connectionStatus={connectionStatus}
        onExportReport={exportReport}
      />
    </div>
  );
}
