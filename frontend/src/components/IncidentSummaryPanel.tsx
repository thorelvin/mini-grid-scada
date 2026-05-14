import { useState } from "react";

import { formatVoltageRangeLabel, formatTime, getHighestPriorityAlarm, getQualityLabel, getSeverityLabel } from "../dashboard-utils";
import {
  buildStationDrillPlan,
  buildFocusFeeders,
  buildRecentTimeline,
  getRecommendedActions,
  inferProbableCause,
  isSelectableAssetId,
  type DrillStepStatus,
  type IncidentReportSection,
  type IncidentHistoryScope,
} from "../incident-utils";
import { getBreakerOutcomeLabel } from "../topology-utils";
import type { DashboardPayload } from "../types";

interface IncidentSummaryPanelProps {
  dashboard: DashboardPayload | null;
  history: DashboardPayload[];
  replayMode: boolean;
  selectedAssetId: string | null;
  reportPreviewSections: IncidentReportSection[];
  incidentScope: IncidentHistoryScope;
  incidentNotes: string;
  onSelectAsset: (assetId: string) => void;
  onJumpToTimestamp: (timestamp: string) => void;
  onExportReport: () => void;
  onExportPackage: () => void;
  onChangeIncidentNotes: (value: string) => void;
}

function getDrillStepTone(status: DrillStepStatus): "good" | "warn" | "critical" | "neutral" {
  switch (status) {
    case "done":
      return "good";
    case "ready":
      return "neutral";
    case "blocked":
      return "warn";
    default:
      return "neutral";
  }
}

function getDrillStepLabel(status: DrillStepStatus): string {
  switch (status) {
    case "done":
      return "Done";
    case "ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    default:
      return "Pending";
  }
}

export function IncidentSummaryPanel({
  dashboard,
  history,
  replayMode,
  selectedAssetId,
  reportPreviewSections,
  incidentScope,
  incidentNotes,
  onSelectAsset,
  onJumpToTimestamp,
  onExportReport,
  onExportPackage,
  onChangeIncidentNotes,
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
  const scopedEventCount = recentTimeline.length;
  const stationDrill = buildStationDrillPlan(dashboard);
  const readyDrillSteps = stationDrill.steps.filter((step) => step.status === "ready").length;
  const blockedDrillSteps = stationDrill.steps.filter((step) => step.status === "blocked").length;
  const nextDrillStep = stationDrill.steps.find((step) => step.status === "ready" || step.status === "blocked");

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

        <article className="incident-summary-card">
          <span>Rapportscope</span>
          <strong>{incidentScope.label}</strong>
          <p>{history.length} frames / {scopedEventCount} hendelser i valgt utsnitt.</p>
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

      <div className="incident-section incident-drill-section">
        <div className="incident-section-header">
          <h3>Guided station drill</h3>
          <span>{stationDrill.activeBreakerId ?? "Standby"}</span>
        </div>

        <div className="incident-drill-summary-grid">
          <article className={`incident-drill-summary-card tone-${stationDrill.blockers.length ? "warn" : stationDrill.activeBreakerId ? "neutral" : "good"}`}>
            <span>Restore-status</span>
            <strong>{stationDrill.headline}</strong>
            <p>{stationDrill.posture}</p>
          </article>
          <article className="incident-drill-summary-card tone-neutral">
            <span>Grenstatus</span>
            <strong>
              {stationDrill.branchSummary.ready} klare / {stationDrill.branchSummary.blocked} sperret
            </strong>
            <p>
              {stationDrill.branchSummary.held} holdes ute / {stationDrill.branchSummary.live} allerede inne
            </p>
          </article>
          <article className="incident-drill-summary-card tone-neutral">
            <span>Neste operatortrekk</span>
            <strong>{nextDrillStep?.title ?? "Ingen ventende restore-handling"}</strong>
            <p>{nextDrillStep?.detail ?? "Stasjonsveien er allerede stabil pa stasjonsbryternivaa."}</p>
          </article>
        </div>

        <div className="incident-drill-checkpoint-grid">
          {stationDrill.checkpoints.map((checkpoint) => (
            <article key={checkpoint.id} className={`incident-drill-checkpoint tone-${checkpoint.tone}`}>
              <span>{checkpoint.label}</span>
              <strong>{checkpoint.value}</strong>
            </article>
          ))}
        </div>

        <div className="incident-drill-step-list">
          {stationDrill.steps.map((step, index) => {
            const tone = getDrillStepTone(step.status);
            const selected = step.assetId != null && selectedAssetId === step.assetId;

            return (
              <button
                key={step.id}
                type="button"
                className={`incident-drill-step tone-${tone} ${selected ? "selected" : ""}`}
                onClick={() => {
                  if (step.assetId) {
                    onSelectAsset(step.assetId);
                  }
                }}
                disabled={!step.assetId}
              >
                <div className="incident-drill-step-head">
                  <span className="incident-drill-step-index">{index + 1}</span>
                  <strong>{step.title}</strong>
                  <span className={`state-pill tone-${tone}`}>{getDrillStepLabel(step.status)}</span>
                </div>
                <p>{step.detail}</p>
                {step.assetId ? <small>Apne {step.assetId} i objektpanelet</small> : null}
              </button>
            );
          })}
        </div>

        {stationDrill.blockers.length ? (
          <div className="incident-drill-callout warn">
            <strong>{blockedDrillSteps} restore-steg er sperret</strong>
            <div className="incident-drill-list">
              {stationDrill.blockers.map((blocker) => (
                <p key={blocker}>{blocker}</p>
              ))}
            </div>
          </div>
        ) : (
          <div className="incident-drill-callout good">
            <strong>{readyDrillSteps > 0 ? `${readyDrillSteps} restore-steg er klare` : "Stasjonsrestore er klar"}</strong>
            <p>{nextDrillStep?.detail ?? "Ingen stasjonsnivaa-sperrer er aktive akkurat na."}</p>
          </div>
        )}

        {stationDrill.notes.length ? (
          <div className="incident-drill-note-list">
            {stationDrill.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
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
              <button type="button" className="secondary-button compact-button" onClick={onExportPackage}>
                Eksporter pakke
              </button>
            </div>
          </div>

          <div className="incident-note-editor">
            <label htmlFor="incident-notes">Operatornotater</label>
            <textarea
              id="incident-notes"
              value={incidentNotes}
              onChange={(event) => onChangeIncidentNotes(event.target.value)}
              placeholder="Legg inn korte notater som skal bli med i rapport og incident package."
              rows={4}
            />
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
