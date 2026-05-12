import { useState } from "react";

import {
  formatSignedValue,
  formatValue,
  getFeederStateLabel,
  getFeederStateTone,
  getPowerFactor,
  getQualityLabel,
  getStrongestAlarm,
} from "../dashboard-utils";
import type { Alarm, BreakerStatus, FeederControlInput, FeederTelemetry, StationSnapshot } from "../types";

interface SingleLineDiagramProps {
  snapshot: StationSnapshot | null;
  alarms: Alarm[];
  controls: FeederControlInput[];
  selectedAssetId: string | null;
  onSelect: (assetId: string) => void;
}

type SymbolTone = "good" | "neutral" | "critical" | "high" | "medium" | "warn" | "low";

function DiagramMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="diagram-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DiagramLegendItem({
  label,
  tone,
  status,
}: {
  label: string;
  tone: SymbolTone;
  status: BreakerStatus;
}) {
  return (
    <div className="diagram-legend-item">
      <BreakerSymbol status={status} tone={tone} orientation="horizontal" />
      <span>{label}</span>
    </div>
  );
}

function DiagramLinkAssembly({
  label,
  tone,
  status,
}: {
  label: string;
  tone: SymbolTone;
  status: BreakerStatus;
}) {
  return (
    <div className={`diagram-link-track tone-${tone}`}>
      <span className="diagram-link-label">{label}</span>
      <div className="diagram-link-rail">
        <span className="diagram-link-run" />
        <BreakerSymbol status={status} tone={tone} orientation="horizontal" />
        <span className="diagram-link-run" />
      </div>
    </div>
  );
}

function BreakerSymbol({
  status,
  tone,
  orientation,
  label,
}: {
  status: BreakerStatus;
  tone: SymbolTone;
  orientation: "horizontal" | "vertical";
  label?: string;
}) {
  if (orientation === "horizontal") {
    return (
      <div className={`breaker-symbol-wrap breaker-wrap-horizontal tone-${tone} status-${status}`}>
        {label ? <span className="breaker-label">{label}</span> : null}
        <svg viewBox="0 0 140 62" className={`breaker-symbol breaker-horizontal tone-${tone} status-${status}`} aria-hidden="true">
          <line x1="4" y1="31" x2="34" y2="31" className="breaker-conductor breaker-upstream" />
          <circle cx="42" cy="31" r="4" className="breaker-node" />
          <circle cx="96" cy="31" r="4" className="breaker-node" />
          {status === "closed" ? (
            <line x1="46" y1="31" x2="92" y2="31" className="breaker-contact breaker-blade" />
          ) : (
            <>
              <line x1="46" y1="31" x2="79" y2="13" className="breaker-contact breaker-blade" />
              <line x1="87" y1="31" x2="92" y2="31" className="breaker-contact breaker-seat" />
            </>
          )}
          <line x1="104" y1="31" x2="136" y2="31" className="breaker-conductor breaker-downstream" />
          {status === "tripped" ? (
            <path d="M69 9L61 23H70L64 38L82 19H73L80 9Z" className="breaker-trip" />
          ) : null}
        </svg>
      </div>
    );
  }

  return (
    <div className={`breaker-symbol-wrap breaker-wrap-vertical tone-${tone} status-${status}`}>
      <svg viewBox="0 0 48 102" className={`breaker-symbol breaker-vertical tone-${tone} status-${status}`} aria-hidden="true">
        <line x1="24" y1="4" x2="24" y2="26" className="breaker-conductor breaker-upstream" />
        <circle cx="24" cy="34" r="4" className="breaker-node" />
        <circle cx="24" cy="68" r="4" className="breaker-node" />
        {status === "closed" ? (
          <line x1="24" y1="38" x2="24" y2="64" className="breaker-contact breaker-blade" />
        ) : (
          <>
            <line x1="24" y1="38" x2="35" y2="58" className="breaker-contact breaker-blade" />
            <line x1="24" y1="62" x2="24" y2="64" className="breaker-contact breaker-seat" />
          </>
        )}
        <line x1="24" y1="76" x2="24" y2="98" className="breaker-conductor breaker-downstream" />
        {status === "tripped" ? (
          <path d="M24 10L18 25H26L21 39L34 21H26L31 10Z" className="breaker-trip" />
        ) : null}
      </svg>
      {label ? <span className="breaker-label">{label}</span> : null}
    </div>
  );
}

function FeederCard({
  feeder,
  alarm,
  selected,
  showNames,
  showValues,
  onSelect,
}: {
  feeder: FeederTelemetry;
  alarm: Alarm | null;
  selected: boolean;
  showNames: boolean;
  showValues: boolean;
  onSelect: () => void;
}) {
  const tone = getFeederStateTone(feeder, alarm) as SymbolTone;
  const stateLabel = getFeederStateLabel(feeder, alarm);

  return (
    <div className={`feeder-column status-${feeder.breakerStatus} tone-${tone}`}>
      <div className="feeder-branch-graphic">
        <div className="feeder-tap-cap" />
        <div className="feeder-branch-line feeder-branch-upper" />
        <BreakerSymbol status={feeder.breakerStatus} tone={tone} orientation="vertical" />
        <div className="feeder-branch-line feeder-branch-lower" />
      </div>

      <button type="button" className={`diagram-card feeder-card tone-${tone} ${selected ? "selected" : ""}`} onClick={onSelect}>
        <div className="diagram-card-header">
          <div>
            <strong>
              {feeder.id}
              {showNames ? ` - ${feeder.name}` : ""}
            </strong>
          </div>
          <span className={`state-pill tone-${tone}`}>{stateLabel}</span>
        </div>

        {showValues ? (
          <div className="diagram-metric-grid">
            <DiagramMetric label="P" value={`${formatSignedValue(feeder.activePowerKw)} kW`} />
            <DiagramMetric label="Q" value={`${formatSignedValue(feeder.reactivePowerKvar)} kVAr`} />
            <DiagramMetric label="IL1" value={`${formatValue(feeder.current.l1, 0)} A`} />
            <DiagramMetric label="IL2" value={`${formatValue(feeder.current.l2, 0)} A`} />
            <DiagramMetric label="IL3" value={`${formatValue(feeder.current.l3, 0)} A`} />
            <DiagramMetric label="UL1" value={`${formatValue(feeder.voltage.l1, 0)} V`} />
            <DiagramMetric label="UL2" value={`${formatValue(feeder.voltage.l2, 0)} V`} />
            <DiagramMetric label="UL3" value={`${formatValue(feeder.voltage.l3, 0)} V`} />
            <DiagramMetric label="Kunder" value={formatValue(feeder.customers)} />
          </div>
        ) : (
          <div className="diagram-card-summary">
            <span>{formatSignedValue(feeder.activePowerKw)} kW</span>
            <span>{formatValue(feeder.derived.utilizationPercent, 0)} % last</span>
          </div>
        )}

        <div className="diagram-card-footer">
          <span className={`footer-state tone-${tone}`}>{alarm ? alarm.title : "Normal drift"}</span>
        </div>
      </button>
    </div>
  );
}

export function SingleLineDiagram({
  snapshot,
  alarms,
  controls,
  selectedAssetId,
  onSelect,
}: SingleLineDiagramProps) {
  const [showNames, setShowNames] = useState(true);
  const [showValues, setShowValues] = useState(true);
  const [autoLayout, setAutoLayout] = useState(true);

  if (!snapshot) {
    return (
      <section className="panel scada-panel panel-diagram">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Enlinjeskjema</p>
            <h2>Stasjonsoversikt</h2>
          </div>
        </div>
        <div className="empty-panel">
          <p>Venter på telemetri...</p>
          <span>Diagrammet fylles når backend strømmer snapshots.</span>
        </div>
      </section>
    );
  }

  const transformerAlarm = getStrongestAlarm(alarms, snapshot.transformer.id);
  const transformerTone = (transformerAlarm?.severity ?? "good") as SymbolTone;
  const estimatedInletKv = (snapshot.transformer.secondaryVoltageV / 400) * 22;
  const apparentPowerMva = snapshot.transformer.apparentPowerKva / 1000;
  const reactiveMvar =
    Math.sqrt(Math.max(snapshot.transformer.apparentPowerKva ** 2 - snapshot.transformer.activePowerKw ** 2, 0)) / 1000;
  const inletBreakerStatus: BreakerStatus = "closed";

  return (
    <section className="panel scada-panel panel-diagram">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Enlinjeskjema</p>
          <h2>{snapshot.stationId}</h2>
        </div>
        <div className="diagram-toolbar">
          <label className="toggle-pill">
            <input type="checkbox" checked={autoLayout} onChange={() => setAutoLayout((current) => !current)} />
            <span>Auto layout</span>
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={showNames} onChange={() => setShowNames((current) => !current)} />
            <span>Vis navn</span>
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={showValues} onChange={() => setShowValues((current) => !current)} />
            <span>Vis verdier</span>
          </label>
        </div>
      </div>

      <div className="diagram-legend" aria-label="Symbolforklaring">
        <DiagramLegendItem label="Lukket bryter" tone="good" status="closed" />
        <DiagramLegendItem label="Åpen bryter" tone="neutral" status="open" />
        <DiagramLegendItem label="Utløst bryter" tone="critical" status="tripped" />
      </div>

      <div className={`diagram-stage ${autoLayout ? "auto-layout" : "manual-layout"}`}>
        <div className="diagram-top-row">
          <section className="diagram-card inlet-card">
            <div className="diagram-card-header">
              <strong>NETTINNTAK</strong>
            </div>
            <div className="diagram-metric-grid">
              <DiagramMetric label="U L1-L2" value={`${formatValue(estimatedInletKv, 1)} kV`} />
              <DiagramMetric label="P" value={`${formatValue(snapshot.transformer.activePowerKw / 1000, 2)} MW`} />
              <DiagramMetric label="Q" value={`${formatValue(reactiveMvar, 2)} MVAr`} />
              <DiagramMetric label="F" value="50.00 Hz" />
              <DiagramMetric
                label="PF"
                value={formatValue(
                  getPowerFactor(snapshot.transformer.activePowerKw, snapshot.transformer.apparentPowerKva),
                  2,
                )}
              />
            </div>
            <div className="diagram-card-footer">
              <span className="footer-state tone-good">Innmating stabil</span>
            </div>
          </section>

          <div className="diagram-link">
            <DiagramLinkAssembly label="BRK-IN" tone="good" status={inletBreakerStatus} />
          </div>

          <button
            type="button"
            className={`diagram-card transformer-card ${selectedAssetId === "T1" ? "selected" : ""} ${
              transformerAlarm ? `tone-${transformerAlarm.severity}` : ""
            }`}
            onClick={() => onSelect("T1")}
          >
            <div className="diagram-card-header">
              <div className="transformer-heading">
                <img className="transformer-mark" src="/assets/transformer-mark.svg" alt="" aria-hidden="true" />
                <strong>T1 22/0.4 kV</strong>
              </div>
              {transformerAlarm ? <span className="alarm-chip">{transformerAlarm.title}</span> : null}
            </div>
            <div className="diagram-metric-grid">
              <DiagramMetric label="Last" value={`${formatValue(snapshot.transformer.loadPercent, 0)} %`} />
              <DiagramMetric label="P" value={`${formatValue(snapshot.transformer.activePowerKw, 0)} kW`} />
              <DiagramMetric label="S" value={`${formatValue(apparentPowerMva, 2)} MVA`} />
              <DiagramMetric label="U L1-L2" value={`${formatValue(snapshot.transformer.secondaryVoltageV, 0)} V`} />
              <DiagramMetric label="Temp. olje" value={`${formatValue(snapshot.transformer.topOilTempC, 0)} C`} />
              <DiagramMetric label="Kvalitet" value={getQualityLabel(snapshot.transformer.quality)} />
            </div>
          </button>
        </div>

        <div className="transformer-feed-assembly">
          <div className={`transformer-feed-cap tone-${transformerTone}`} />
          <div className={`transformer-feed-line tone-${transformerTone}`} />
          <BreakerSymbol status="closed" tone={transformerTone} orientation="vertical" label="LV-BRK" />
          <div className={`transformer-feed-line tone-${transformerTone}`} />
          <div className={`transformer-feed-cap tone-${transformerTone}`} />
        </div>

        <div className="bus-wrapper">
          <span className="bus-label">0.4 kV samleskinne</span>
          <div className="bus-line" />
          <div className="bus-tap-grid" aria-hidden="true">
            {snapshot.feeders.map((feeder) => {
              const feederAlarm = getStrongestAlarm(alarms, feeder.id);
              const tone = getFeederStateTone(feeder, feederAlarm);
              return <span key={feeder.id} className={`bus-tap tone-${tone} status-${feeder.breakerStatus}`} />;
            })}
          </div>
        </div>

        <div className="feeder-grid">
          {snapshot.feeders.map((feeder) => {
            const feederAlarm = getStrongestAlarm(alarms, feeder.id);
            const selected = selectedAssetId === feeder.id;
            const control = controls.find((item) => item.id === feeder.id);
            return (
              <FeederCard
                key={feeder.id}
                feeder={{
                  ...feeder,
                  quality: control?.communicationState ?? feeder.quality,
                }}
                alarm={feederAlarm}
                selected={selected}
                showNames={showNames}
                showValues={showValues}
                onSelect={() => onSelect(feeder.id)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
