import { useState } from "react";

import {
  formatTime,
  formatValue,
  getBreakerStatusLabel,
  getFaultModeLabel,
  getObjectAlarms,
  getPowerFactor,
  getQualityLabel,
  getSeverityLabel,
  sortAlarms,
} from "../dashboard-utils";
import type {
  Alarm,
  BreakerCommandRequest,
  CommandResult,
  FeederControlInput,
  FeederTelemetry,
  StationSnapshot,
} from "../types";

type PanelTab = "status" | "measurements" | "command" | "info";

interface SelectedObjectPanelProps {
  snapshot: StationSnapshot | null;
  alarms: Alarm[];
  controls: FeederControlInput[];
  selectedAssetId: string | null;
  lastCommandResult?: CommandResult | null;
  busy: boolean;
  onOpenBreaker: (command: BreakerCommandRequest) => Promise<void>;
  onCloseBreaker: (command: BreakerCommandRequest) => Promise<void>;
  onAcknowledgeAll: (objectId?: string) => Promise<void>;
}

function findFeeder(snapshot: StationSnapshot, selectedAssetId: string): FeederTelemetry | undefined {
  return snapshot.feeders.find((feeder) => feeder.id === selectedAssetId);
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function MetricRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong className={accent ? "accent-value" : ""}>{value}</strong>
    </div>
  );
}

export function SelectedObjectPanel({
  snapshot,
  alarms,
  controls,
  selectedAssetId,
  lastCommandResult,
  busy,
  onOpenBreaker,
  onCloseBreaker,
  onAcknowledgeAll,
}: SelectedObjectPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("status");
  const [operator, setOperator] = useState("Operatør");
  const [reason, setReason] = useState("Planlagt kobling");

  if (!snapshot) {
    return (
      <section className="panel scada-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Valgt objekt</p>
            <h2>Ingen telemetri</h2>
          </div>
        </div>
        <div className="empty-panel">
          <p>Venter på telemetri...</p>
          <span>Objektpanelet fylles når systemet er live.</span>
        </div>
      </section>
    );
  }

  const resolvedAssetId = selectedAssetId ?? "T1";

  if (resolvedAssetId === "T1") {
    const transformer = snapshot.transformer;
    const relatedAlarms = sortAlarms(getObjectAlarms(alarms, "T1"));
    const activeTransformerAlarm = relatedAlarms[0] ?? null;

    return (
      <section className="panel scada-panel object-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Valgt objekt</p>
            <h2>T1 - Trafo 22/0.4 kV</h2>
          </div>
          <span className={`state-pill tone-${activeTransformerAlarm ? activeTransformerAlarm.severity : "good"}`}>
            {activeTransformerAlarm ? activeTransformerAlarm.title : getQualityLabel(transformer.quality)}
          </span>
        </div>

        <div className="tab-strip">
          <TabButton active={activeTab === "status"} label="Status" onClick={() => setActiveTab("status")} />
          <TabButton active={activeTab === "measurements"} label="Målinger" onClick={() => setActiveTab("measurements")} />
          <TabButton active={activeTab === "info"} label="Info" onClick={() => setActiveTab("info")} />
        </div>

        <div className="panel-block">
          {activeTab === "status" ? (
            <>
              <MetricRow label="Status" value={getQualityLabel(transformer.quality)} accent />
              <MetricRow label="Last" value={`${formatValue(transformer.loadPercent, 0)} %`} />
              <MetricRow label="Aktiv effekt" value={`${formatValue(transformer.activePowerKw, 0)} kW`} />
              <MetricRow label="Spenning sekundær" value={`${formatValue(transformer.secondaryVoltageV, 0)} V`} />
              <MetricRow label="Temp. olje" value={`${formatValue(transformer.topOilTempC, 0)} °C`} />
              <MetricRow label="Siste oppdatering" value={formatTime(transformer.timestamp)} />
            </>
          ) : null}

          {activeTab === "measurements" ? (
            <>
              <MetricRow label="Trafospenning" value={`${formatValue(transformer.secondaryVoltageV, 1)} V`} />
              <MetricRow label="Aktiv effekt" value={`${formatValue(transformer.activePowerKw, 1)} kW`} />
              <MetricRow label="Tilsynelatende effekt" value={`${formatValue(transformer.apparentPowerKva, 1)} kVA`} />
              <MetricRow
                label="Effektfaktor"
                value={formatValue(getPowerFactor(transformer.activePowerKw, transformer.apparentPowerKva), 2)}
              />
              <MetricRow label="Kommunikasjon" value={transformer.communicationOk ? "OK" : "Feil"} />
            </>
          ) : null}

          {activeTab === "info" ? (
            <>
              <MetricRow label="Kvalitet" value={getQualityLabel(transformer.quality)} />
              <MetricRow label="Aktive alarmer" value={String(relatedAlarms.length)} />
              <MetricRow label="Anbefaling" value={activeTransformerAlarm ? activeTransformerAlarm.message : "Ingen aktive tiltak"} />
            </>
          ) : null}
        </div>
      </section>
    );
  }

  const feeder = findFeeder(snapshot, resolvedAssetId);
  if (!feeder) {
    return null;
  }
  const selectedFeeder = feeder;

  const relatedAlarms = sortAlarms(getObjectAlarms(alarms, selectedFeeder.id));
  const relatedCommand = lastCommandResult?.objectId === selectedFeeder.id ? lastCommandResult : null;
  const control = controls.find((item) => item.id === selectedFeeder.id);
  const activeUnacknowledgedAlarms = relatedAlarms.filter((alarm) => alarm.state !== "acknowledged");
  const liveInterlocks: string[] = [];

  if (selectedFeeder.quality !== "good") {
    liveInterlocks.push(`Datakvalitet er ${getQualityLabel(selectedFeeder.quality).toLowerCase()}.`);
  }
  if (selectedFeeder.breakerStatus === "tripped") {
    liveInterlocks.push("Bryteren er utløst og krever konservativ gjeninnkobling.");
  }
  if (control && control.faultMode !== "normal" && control.faultMode !== "planned_outage") {
    liveInterlocks.push(`Aktiv feilmodus: ${getFaultModeLabel(control.faultMode).toLowerCase()}.`);
  }
  if (relatedAlarms.some((alarm) => alarm.severity === "critical" && alarm.state !== "acknowledged")) {
    liveInterlocks.push("Kritisk alarm må kvitteres og vurderes før lukking.");
  }

  async function handleOpenBreaker() {
    const confirmed = window.confirm(
      `Åpne ${selectedFeeder.id}? Dette kobler ut ${selectedFeeder.customers} kunder, inkludert ${selectedFeeder.criticalCustomers} kritiske kunder.`,
    );
    if (!confirmed) {
      return;
    }

    await onOpenBreaker({
      objectId: selectedFeeder.id,
      operator,
      reason,
      confirmImpact: true,
    });
  }

  async function handleCloseBreaker() {
    await onCloseBreaker({
      objectId: selectedFeeder.id,
      operator,
      reason: reason || "Gjeninnkobling etter vurdering",
      confirmImpact: true,
    });
  }

  return (
    <section className="panel scada-panel object-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Valgt objekt</p>
          <h2>
            {feeder.id} - {feeder.name}
          </h2>
        </div>
        <span className={`state-pill tone-${feeder.breakerStatus === "closed" ? "good" : feeder.breakerStatus === "open" ? "warn" : "critical"}`}>
          {getBreakerStatusLabel(feeder.breakerStatus)}
        </span>
      </div>

      <div className="tab-strip">
        <TabButton active={activeTab === "status"} label="Status" onClick={() => setActiveTab("status")} />
        <TabButton active={activeTab === "measurements"} label="Målinger" onClick={() => setActiveTab("measurements")} />
        <TabButton active={activeTab === "command"} label="Kommando" onClick={() => setActiveTab("command")} />
        <TabButton active={activeTab === "info"} label="Info" onClick={() => setActiveTab("info")} />
      </div>

      <div className="panel-block">
        {activeTab === "status" ? (
          <>
            <MetricRow label="Status" value={getBreakerStatusLabel(feeder.breakerStatus)} accent />
            <MetricRow label="Utnyttelse" value={`${formatValue(feeder.derived.utilizationPercent, 0)} %`} />
            <div className="utilization-bar">
              <span style={{ width: `${Math.min(feeder.derived.utilizationPercent, 100)}%` }} />
            </div>
            <MetricRow label="Aktiv effekt" value={`${formatValue(feeder.activePowerKw, 0)} kW`} />
            <MetricRow
              label="Strøm maks"
              value={`${formatValue(Math.max(feeder.current.l1, feeder.current.l2, feeder.current.l3), 0)} A`}
            />
            <MetricRow label="Spenning L2" value={`${formatValue(feeder.voltage.l2, 0)} V`} />
            <MetricRow label="Kunder tilknyttet" value={formatValue(feeder.customers)} />
            <MetricRow label="Kritiske kunder" value={formatValue(feeder.criticalCustomers)} />
            <MetricRow label="Siste endring" value={formatTime(feeder.timestamp)} />
            <MetricRow
              label="Siste hendelse"
              value={relatedAlarms[0] ? relatedAlarms[0].title : "Ingen aktive alarmer"}
            />
          </>
        ) : null}

        {activeTab === "measurements" ? (
          <>
            <MetricRow label="Aktiv effekt" value={`${formatValue(feeder.activePowerKw, 1)} kW`} />
            <MetricRow label="Reaktiv effekt" value={`${formatValue(feeder.reactivePowerKvar, 1)} kVAr`} />
            <MetricRow label="Spenning L1" value={`${formatValue(feeder.voltage.l1, 1)} V`} />
            <MetricRow label="Spenning L2" value={`${formatValue(feeder.voltage.l2, 1)} V`} />
            <MetricRow label="Spenning L3" value={`${formatValue(feeder.voltage.l3, 1)} V`} />
            <MetricRow label="Strøm L1" value={`${formatValue(feeder.current.l1, 1)} A`} />
            <MetricRow label="Strøm L2" value={`${formatValue(feeder.current.l2, 1)} A`} />
            <MetricRow label="Strøm L3" value={`${formatValue(feeder.current.l3, 1)} A`} />
            <MetricRow label="Faseubalanse" value={`${formatValue(feeder.derived.phaseImbalancePercent, 1)} %`} />
            <MetricRow label="Spenningsavvik" value={`${formatValue(feeder.derived.voltageDeviationPercent, 1)} %`} />
          </>
        ) : null}

        {activeTab === "command" ? (
          <>
            <label className="field-stack">
              <span>Operatør</span>
              <input value={operator} onChange={(event) => setOperator(event.target.value)} />
            </label>
            <label className="field-stack">
              <span>Begrunnelse</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="impact-card">
              <strong>Konsekvens</strong>
              <p>
                {feeder.customers} kunder på feeder, {feeder.criticalCustomers} kritiske kunder.
              </p>
            </div>
            {relatedCommand ? (
              <div className={`command-result ${relatedCommand.allowed ? "allowed" : "blocked"}`}>
                <strong>{relatedCommand.allowed ? "Kommando utført" : "Kommando blokkert"}</strong>
                <p>{relatedCommand.message}</p>
              </div>
            ) : null}
          </>
        ) : null}

        {activeTab === "info" ? (
          <>
            <MetricRow label="Datakvalitet" value={getQualityLabel(feeder.quality)} />
            <MetricRow label="Feeder-type" value={feeder.type} />
            <MetricRow label="Effektretning" value={feeder.derived.powerDirection} />
            <MetricRow label="Feilmodus" value={control ? getFaultModeLabel(control.faultMode) : "Normal"} />
            <MetricRow label="Tripgrense" value={`${formatValue(feeder.protection.tripPercent, 0)} %`} />
            <MetricRow label="Varselgrense" value={`${formatValue(feeder.protection.warningPercent, 0)} %`} />
            <MetricRow label="Siste tripårsak" value={feeder.protection.lastTripReason ?? "Ingen"} />
          </>
        ) : null}
      </div>

      <div className="subpanel">
        <h3>Operatørhandlinger</h3>
        <div className="command-row">
          <button type="button" className="primary-button" disabled={busy} onClick={() => void handleOpenBreaker()}>
            Åpne bryter
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleCloseBreaker()}>
            Lukk bryter
          </button>
        </div>
        <div className="command-row single">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || activeUnacknowledgedAlarms.length === 0}
            onClick={() => void onAcknowledgeAll(feeder.id)}
          >
            Kvitter alarmer
          </button>
        </div>
      </div>

      <div className="subpanel">
        <h3>Sperrer / interlocks</h3>
        {relatedCommand?.interlock.reasons.length ? (
          <div className="reason-list">
            {relatedCommand.interlock.reasons.map((reasonItem) => (
              <p key={reasonItem}>{reasonItem}</p>
            ))}
          </div>
        ) : liveInterlocks.length ? (
          <div className="reason-list">
            {liveInterlocks.map((reasonItem) => (
              <p key={reasonItem}>{reasonItem}</p>
            ))}
          </div>
        ) : (
          <p className="good-text">Ingen aktive sperrer</p>
        )}
      </div>

      {relatedAlarms.length ? (
        <div className="subpanel">
          <h3>Objektalarmer</h3>
          <div className="alarm-summary-list">
            {relatedAlarms.map((alarm) => (
              <div key={alarm.id} className="alarm-summary-item">
                <span className={`severity-badge severity-${alarm.severity}`}>{getSeverityLabel(alarm.severity)}</span>
                <div>
                  <strong>{alarm.title}</strong>
                  <p>{alarm.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
