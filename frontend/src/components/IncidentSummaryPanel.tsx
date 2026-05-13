import {
  formatVoltageRangeLabel,
  formatTime,
  getHighestPriorityAlarm,
  getQualityLabel,
  getSeverityLabel,
  sortAlarms,
} from "../dashboard-utils";
import { getBreakerOutcomeLabel, getTopologyImpactSummary } from "../topology-utils";
import type { Alarm, DashboardPayload, EventEntry, FeederTelemetry } from "../types";

interface IncidentSummaryPanelProps {
  dashboard: DashboardPayload | null;
  history: DashboardPayload[];
  replayMode: boolean;
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  onJumpToTimestamp: (timestamp: string) => void;
}

interface FeederFocusCard {
  feeder: FeederTelemetry;
  alarm: Alarm | null;
  affectedCustomers: number;
}

function isSelectableAssetId(assetId: string): boolean {
  return assetId === "T1" || assetId === "BRK-IN" || assetId === "LV-BRK" || /^F\d+$/.test(assetId);
}

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
    .slice(0, 8);
}

function getRecommendedActions(dashboard: DashboardPayload): string[] {
  const recommendations = new Set<string>();

  for (const alarm of sortAlarms(dashboard.activeAlarms)) {
    if (alarm.title === "Breaker tripped") {
      recommendations.add(`Hold ${alarm.objectId} ute til triparsak er kontrollert og alarm er kvittert.`);
    } else if (alarm.title === "Protection trip threshold exceeded" || alarm.title === "Overload warning") {
      recommendations.add(`Reduser last pa ${alarm.objectId} for gjeninnkobling eller videre lastokning.`);
    } else if (alarm.title === "Communication degraded") {
      recommendations.add(`Vurder kommandoer mot ${alarm.objectId} forsiktig til datakvaliteten er tilbake til OK.`);
    } else if (alarm.title === "Phase imbalance") {
      recommendations.add(`Se over fasefordelingen pa ${alarm.objectId} for a dempe ubalanse.`);
    } else if (alarm.title === "Undervoltage" || alarm.title === "Overvoltage") {
      recommendations.add(`Kontroller spenning og lokal last pa ${alarm.objectId} for a stabilisere nettet.`);
    }
  }

  if (recommendations.size === 0) {
    recommendations.add("Ingen aktive tiltak er pakrevd akkurat na.");
  }

  return [...recommendations].slice(0, 4);
}

function buildFocusFeeders(dashboard: DashboardPayload): FeederFocusCard[] {
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
      const rightSeverity = right.alarm ? sortAlarms([right.alarm])[0] : null;
      const leftSeverity = left.alarm ? sortAlarms([left.alarm])[0] : null;
      const leftRank =
        (leftSeverity?.severity === "critical"
          ? 4
          : leftSeverity?.severity === "high"
            ? 3
            : leftSeverity?.severity === "medium"
              ? 2
              : leftSeverity?.severity === "low"
                ? 1
                : 0) * 1000;
      const rightRank =
        (rightSeverity?.severity === "critical"
          ? 4
          : rightSeverity?.severity === "high"
            ? 3
            : rightSeverity?.severity === "medium"
              ? 2
              : rightSeverity?.severity === "low"
                ? 1
                : 0) * 1000;
      const rightScore = rightRank + right.affectedCustomers + right.feeder.derived.utilizationPercent;
      const leftScore = leftRank + left.affectedCustomers + left.feeder.derived.utilizationPercent;
      return rightScore - leftScore;
    })
    .slice(0, 4);
}

export function IncidentSummaryPanel({
  dashboard,
  history,
  replayMode,
  selectedAssetId,
  onSelectAsset,
  onJumpToTimestamp,
}: IncidentSummaryPanelProps) {
  if (!dashboard) {
    return null;
  }

  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  const recentTimeline = buildRecentTimeline(history);
  const recommendedActions = getRecommendedActions(dashboard);
  const degradedCount =
    dashboard.controls.filter((control) => control.communicationState !== "good").length +
    (dashboard.snapshot.transformer.quality !== "good" ? 1 : 0);
  const affectedCustomers = dashboard.snapshot.feeders.reduce(
    (sum, feeder) => sum + feeder.derived.affectedCustomers,
    0,
  );
  const activeProfileName =
    dashboard.availableProfiles.find((profile) => profile.id === dashboard.activeProfileId)?.name ??
    dashboard.activeProfileId ??
    "Manuell drift";
  const activeTimedEvents = dashboard.activeTimedEvents.map((event) => event.name);
  const focusFeeders = buildFocusFeeders(dashboard);

  return (
    <section className="panel scada-panel incident-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Incident center</p>
          <h2>Situasjonsforstaaelse og tiltak</h2>
        </div>
        <div className="panel-header-meta">
          <span>{replayMode ? "Replay context" : "Live context"}</span>
          <span>{activeProfileName}</span>
        </div>
      </div>

      <div className="incident-summary-grid">
        <article className="incident-summary-card">
          <span>System posture</span>
          <strong>
            {highestAlarm ? `${getSeverityLabel(highestAlarm.severity)} ${highestAlarm.title}` : "Normal drift"}
          </strong>
          <p>{highestAlarm ? `${highestAlarm.objectId}: ${highestAlarm.message}` : "Ingen aktive alarmer akkurat na."}</p>
        </article>

        <article className="incident-summary-card">
          <span>Kundepavirkning</span>
          <strong>{affectedCustomers} kunder ute na</strong>
          <p>
            {dashboard.snapshot.feeders.reduce((sum, feeder) => sum + feeder.criticalCustomers, 0)} kritiske kunder
            totalt i nettet.
          </p>
        </article>

        <article className="incident-summary-card">
          <span>Telemetri</span>
          <strong>{degradedCount === 0 ? "OK" : `${degradedCount} signaler degradert`}</strong>
          <p>
            API {dashboard.health.apiStatus} / broker {dashboard.health.brokerStatus} / websocket{" "}
            {dashboard.health.websocketClients}
          </p>
        </article>

        <article className="incident-summary-card">
          <span>Driftstilstand</span>
          <strong>{activeProfileName}</strong>
          <p>{activeTimedEvents.length ? activeTimedEvents.join(", ") : "Ingen aktive overlays eller events."}</p>
        </article>
      </div>

      <div className="incident-layout">
        <div className="incident-section">
          <div className="incident-section-header">
            <h3>Anbefalte tiltak</h3>
            <span>{recommendedActions.length} forslag</span>
          </div>

          <div className="incident-action-list">
            {recommendedActions.map((action, index) => (
              <article key={`${action}-${index}`} className="incident-action-card">
                <strong>Tiltak {index + 1}</strong>
                <p>{action}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="incident-section">
          <div className="incident-section-header">
            <h3>Fokusobjekter</h3>
            <span>{focusFeeders.length || 0} kandidater</span>
          </div>

          {focusFeeders.length > 0 ? (
            <div className="incident-focus-list">
              {focusFeeders.map(({ feeder, alarm, affectedCustomers: feederAffectedCustomers }) => (
                <button
                  key={feeder.id}
                  type="button"
                  className={`incident-focus-card ${selectedAssetId === feeder.id ? "selected" : ""}`}
                  onClick={() => onSelectAsset(feeder.id)}
                >
                  <div className="incident-focus-head">
                    <div>
                      <strong>
                        {feeder.id} - {feeder.name}
                      </strong>
                      <p>{alarm ? alarm.title : getBreakerOutcomeLabel(feeder.breakerStatus)}</p>
                    </div>
                    <span className={`state-pill tone-${alarm?.severity ?? "good"}`}>
                      {alarm ? getSeverityLabel(alarm.severity) : getQualityLabel(feeder.quality)}
                    </span>
                  </div>
                  <div className="incident-focus-metrics">
                    <span>Utnyttelse {feeder.derived.utilizationPercent}%</span>
                    <span>Spenning {formatVoltageRangeLabel(feeder.voltage, 0)}</span>
                    <span>Berorte kunder {feederAffectedCustomers}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="incident-empty-state">
              <strong>Ingen fokusobjekter akkurat na</strong>
              <p>Feederne ligger innenfor normale grenser og bryterstatus.</p>
            </div>
          )}
        </div>
      </div>

      <div className="incident-section">
        <div className="incident-section-header">
          <h3>Recent timeline</h3>
          <span>{recentTimeline.length} hendelser</span>
        </div>

        {recentTimeline.length > 0 ? (
          <div className="incident-timeline-list">
            {recentTimeline.map((event) => {
              const selectableAssetId = isSelectableAssetId(event.source) ? event.source : null;

              return (
                <button
                  key={event.id}
                  type="button"
                  className={`incident-timeline-card ${
                    selectableAssetId && selectedAssetId === selectableAssetId ? "selected" : ""
                  }`}
                  onClick={() => {
                    onJumpToTimestamp(event.timestamp);
                    if (selectableAssetId) {
                      onSelectAsset(selectableAssetId);
                    }
                  }}
                >
                  <div className="incident-timeline-meta">
                    <span>{formatTime(event.timestamp)}</span>
                    <strong>{event.source}</strong>
                  </div>
                  <p>{event.description}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="incident-empty-state">
            <strong>Historikken fylles opp</strong>
            <p>Replay og hendelseskort blir rikere etter noen simulatorticks.</p>
          </div>
        )}
      </div>
    </section>
  );
}
