import { useState } from "react";

import { formatVoltageRangeLabel, formatTime, getHighestPriorityAlarm, getQualityLabel, getSeverityLabel } from "../dashboard-utils";
import {
  buildFocusFeeders,
  buildRecentTimeline,
  getRecommendedActions,
  inferProbableCause,
  isSelectableAssetId,
  type IncidentReportSection,
} from "../incident-utils";
import { getBreakerOutcomeLabel } from "../topology-utils";
import type { DashboardPayload } from "../types";

interface IncidentSummaryPanelProps {
  dashboard: DashboardPayload | null;
  history: DashboardPayload[];
  replayMode: boolean;
  selectedAssetId: string | null;
  reportPreviewSections: IncidentReportSection[];
  onSelectAsset: (assetId: string) => void;
  onJumpToTimestamp: (timestamp: string) => void;
  onExportReport: () => void;
}

export function IncidentSummaryPanel({
  dashboard,
  history,
  replayMode,
  selectedAssetId,
  reportPreviewSections,
  onSelectAsset,
  onJumpToTimestamp,
  onExportReport,
}: IncidentSummaryPanelProps) {
  const [showReportPreview, setShowReportPreview] = useState(true);

  if (!dashboard) {
    return null;
  }

  const highestAlarm = getHighestPriorityAlarm(dashboard.activeAlarms);
  const recentTimeline = buildRecentTimeline(history, 8);
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
  const probableCause = inferProbableCause(dashboard, history);

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
            <article className="incident-action-card incident-cause-card">
              <strong>Probable cause</strong>
              <p>{probableCause}</p>
            </article>
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

      <div className="incident-layout">
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

        <div className="incident-section">
          <div className="incident-section-header">
            <h3>Report preview</h3>
            <div className="incident-header-actions">
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setShowReportPreview((current) => !current)}
              >
                {showReportPreview ? "Skjul preview" : "Vis preview"}
              </button>
              <button type="button" className="primary-button compact-button" onClick={onExportReport}>
                Eksporter rapport
              </button>
            </div>
          </div>

          {showReportPreview ? (
            <div className="incident-report-preview">
              {reportPreviewSections.map((section) => (
                <article key={section.id} className={`incident-report-card tone-${section.tone ?? "neutral"}`}>
                  <strong>{section.title}</strong>
                  <div className="incident-report-lines">
                    {section.lines.map((line) => (
                      <p key={`${section.id}-${line}`}>{line}</p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="incident-empty-state">
              <strong>Preview skjult</strong>
              <p>Bruk preview for a se hvordan sammendraget ser ut for eksport.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
