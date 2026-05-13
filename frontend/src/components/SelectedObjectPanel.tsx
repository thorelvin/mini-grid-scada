import { useEffect, useState } from "react";

import {
  formatTime,
  formatValue,
  formatVoltageRangeLabel,
  getBreakerStatusLabel,
  getFaultModeLabel,
  getObjectAlarms,
  getPowerFactor,
  getQualityLabel,
  getSeverityLabel,
  sortAlarms,
} from "../dashboard-utils";
import {
  getBreakerOutcomeLabel,
  getFeederCommandPreviews,
  getTopologyImpactSummary,
} from "../topology-utils";
import type {
  Alarm,
  BreakerStatus,
  BreakerCommandRequest,
  CommandResult,
  FeederControlInput,
  FeederTelemetry,
  StationBreakerTelemetry,
  StationSnapshot,
  StationTopology,
} from "../types";

type PanelTab = "status" | "measurements" | "command" | "info";
type StationBreakerId = "BRK-IN" | "LV-BRK";

interface StationBreakerViewModel {
  id: StationBreakerId;
  title: string;
  status: BreakerStatus;
  qualityLabel: string;
  note: string;
  measuredVoltageV: number;
}

interface SelectedObjectPanelProps {
  topology: StationTopology | null;
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

function isStationBreaker(assetId: string): assetId is StationBreakerId {
  return assetId === "BRK-IN" || assetId === "LV-BRK";
}

function buildStationBreakerViewModel(
  snapshot: StationSnapshot,
  selectedAssetId: StationBreakerId,
): StationBreakerViewModel {
  const stationBreaker = (snapshot.stationBreakers ?? []).find((item) => item.id === selectedAssetId);
  const busEnergized =
    snapshot.transformer.quality === "good" && snapshot.transformer.secondaryVoltageV > 40;

  if (selectedAssetId === "BRK-IN") {
    return {
      id: "BRK-IN",
      title: "BRK-IN - Inntaksbryter",
      status: stationBreaker?.breakerStatus ?? (busEnergized ? "closed" : "open"),
      qualityLabel: getQualityLabel(stationBreaker?.quality ?? snapshot.transformer.quality),
      note:
        "BRK-IN styrer om transformatoren er energisert fra innmatingen. Kommandoer pa dette objektet er konservative og krever eksplisitt konsekvensvurdering.",
      measuredVoltageV: snapshot.transformer.secondaryVoltageV,
    };
  }

  return {
    id: "LV-BRK",
    title: "LV-BRK - Lavspentbryter",
    status: stationBreaker?.breakerStatus ?? (busEnergized ? "closed" : "open"),
    qualityLabel: getQualityLabel(stationBreaker?.quality ?? snapshot.transformer.quality),
    note:
      "LV-BRK styrer om hele 0.4 kV-samleskinnen er spenningssatt. Lukking sperres nar oppstroms mating mangler eller nedstroms feil fortsatt er aktiv.",
    measuredVoltageV: snapshot.transformer.secondaryVoltageV,
  };
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

function RouteSummary({ pathIds }: { pathIds: string[] }) {
  return (
    <div className="topology-route" aria-label="Forsyningsvei">
      {pathIds.map((pathId, index) => (
        <div key={`${pathId}-${index}`} className="topology-route-fragment">
          {index > 0 ? <span className="route-arrow">→</span> : null}
          <span className="topology-node">{pathId}</span>
        </div>
      ))}
    </div>
  );
}

function ImpactStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="impact-stat">
      <span>{label}</span>
      <strong className={accent ? "accent-value" : ""}>{value}</strong>
    </div>
  );
}

function StationBreakerPanel({
  snapshot,
  topology,
  alarms,
  selectedAssetId,
  lastCommandResult,
  busy,
  onOpenBreaker,
  onCloseBreaker,
  onAcknowledgeAll,
  activeTab,
  setActiveTab,
}: {
  snapshot: StationSnapshot;
  topology: StationTopology | null;
  alarms: Alarm[];
  selectedAssetId: StationBreakerId;
  lastCommandResult?: CommandResult | null;
  busy: boolean;
  onOpenBreaker: (command: BreakerCommandRequest) => Promise<void>;
  onCloseBreaker: (command: BreakerCommandRequest) => Promise<void>;
  onAcknowledgeAll: (objectId?: string) => Promise<void>;
  activeTab: PanelTab;
  setActiveTab: (tab: PanelTab) => void;
}) {
  const breaker = buildStationBreakerViewModel(snapshot, selectedAssetId);
  const impactSummary = getTopologyImpactSummary(topology, snapshot, selectedAssetId);
  const affectedFeeders = impactSummary?.downstreamFeederIds.join(", ") || "Ingen nedstrøms grener";
  const [operator, setOperator] = useState("Operatør");
  const [reason, setReason] = useState("Stasjonskobling");
  const relatedCommand = lastCommandResult?.objectId === selectedAssetId ? lastCommandResult : null;
  const relatedAlarms = sortAlarms(alarms.filter((alarm) => impactSummary?.downstreamFeederIds.includes(alarm.objectId)));

  async function handleOpenBreaker() {
    const confirmed = window.confirm(
      `Åpne ${selectedAssetId}? Dette kan berøre ${impactSummary?.totalCustomers ?? 0} kunder, inkludert ${impactSummary?.criticalCustomers ?? 0} kritiske kunder.`,
    );
    if (!confirmed) {
      return;
    }

    await onOpenBreaker({
      objectId: selectedAssetId,
      operator,
      reason,
      confirmImpact: true,
    });
  }

  async function handleCloseBreaker() {
    await onCloseBreaker({
      objectId: selectedAssetId,
      operator,
      reason: reason || "Gjeninnkobling etter stasjonsvurdering",
      confirmImpact: true,
    });
  }

  return (
    <section className="panel scada-panel object-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Valgt objekt</p>
          <h2>{breaker.title}</h2>
        </div>
        <span
          className={`state-pill tone-${
            breaker.status === "closed" ? "good" : breaker.status === "open" ? "warn" : "critical"
          }`}
        >
          {getBreakerStatusLabel(breaker.status)}
        </span>
      </div>

      <div className="tab-strip">
        <TabButton active={activeTab === "status"} label="Status" onClick={() => setActiveTab("status")} />
        <TabButton active={activeTab === "command"} label="Kommando" onClick={() => setActiveTab("command")} />
        <TabButton active={activeTab === "info"} label="Info" onClick={() => setActiveTab("info")} />
      </div>

      <div className="panel-block">
        {activeTab === "status" ? (
          <>
            <MetricRow label="Status" value={getBreakerStatusLabel(breaker.status)} accent />
            <MetricRow label="Kvalitet" value={breaker.qualityLabel} />
            <MetricRow
              label="Nedstrøms kunder"
              value={formatValue(impactSummary?.totalCustomers ?? 0)}
            />
            <MetricRow
              label="Kritiske kunder"
              value={formatValue(impactSummary?.criticalCustomers ?? 0)}
            />
            <MetricRow
              label="Feedere berørt"
              value={formatValue(impactSummary?.downstreamFeederIds.length ?? 0)}
            />
            <MetricRow label="Målt sekundærspenning" value={`${formatValue(breaker.measuredVoltageV, 0)} V`} />
            <MetricRow label="Siste oppdatering" value={formatTime(snapshot.timestamp)} />
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
              <strong>Stasjonsnivå-kobling</strong>
              <p>
                {breaker.note}
              </p>
            </div>
            {relatedCommand ? (
              <div className={`command-result ${relatedCommand.allowed ? "allowed" : "blocked"}`}>
                <strong>{relatedCommand.allowed ? "Kommando utført" : "Kommando blokkert"}</strong>
                <p>{relatedCommand.message}</p>
              </div>
            ) : null}
            <div className="command-preview-grid">
              <div className="command-preview-card tone-warn">
                <span>Ved utkobling</span>
                <strong>{formatValue(impactSummary?.totalCustomers ?? 0)} kunder kan bli berørt</strong>
                <p>
                  Hele den nedstrøms forsyningsveien må vurderes før stasjonskobling gjøres tilgjengelig.
                </p>
              </div>
              <div className="command-preview-card tone-neutral">
                <span>Ved innkobling</span>
                <strong>Konservativ gjeninnkobling</strong>
                <p>
                  Lukking vurderes mot oppstrøms mating, downstream alarmer, datakvalitet og fault-latcher før kommandoen slipper gjennom.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "info" ? (
          <>
            <MetricRow label="Objekttype" value="Stasjonsbryter" />
            <MetricRow label="Forsyningsvei" value={affectedFeeders} />
            <MetricRow label="Trafo koblet" value={snapshot.transformer.id} />
            <MetricRow label="Topologirolle" value={selectedAssetId === "BRK-IN" ? "Oppstrøms inntak" : "Lavspent utgående"} />
            <MetricRow label="Aktive alarmer nedstrøms" value={formatValue(relatedAlarms.length)} />
          </>
        ) : null}
      </div>

      {impactSummary ? (
        <>
          <div className="subpanel">
            <h3>Forsyningsvei</h3>
            <RouteSummary pathIds={impactSummary.pathIds} />
          </div>

          <div className="subpanel">
            <h3>Nettkonsekvens</h3>
            <div className="impact-grid">
              <ImpactStat label="Kunder nedstrøms" value={formatValue(impactSummary.totalCustomers)} accent />
              <ImpactStat label="Kritiske kunder" value={formatValue(impactSummary.criticalCustomers)} />
              <ImpactStat label="Feedere inne" value={formatValue(impactSummary.energizedFeederCount)} />
              <ImpactStat label="Feedere ute" value={formatValue(impactSummary.deenergizedFeederCount)} />
            </div>
            <p className="impact-note">
              Nedstrøms grener: {affectedFeeders}. Stasjonsbryteren er nå fullt modellert i topologien og bruker samme audit-logg som feederkommandoer.
            </p>
          </div>
        </>
      ) : null}

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
            disabled={busy || relatedAlarms.length === 0}
            onClick={() => void onAcknowledgeAll()}
          >
            Kvitter nedstroms alarmer
          </button>
        </div>
      </div>
    </section>
  );
}

function TransformerPanel({
  snapshot,
  topology,
  alarms,
  activeTab,
  setActiveTab,
}: {
  snapshot: StationSnapshot;
  topology: StationTopology | null;
  alarms: Alarm[];
  activeTab: PanelTab;
  setActiveTab: (tab: PanelTab) => void;
}) {
  const transformer = snapshot.transformer;
  const relatedAlarms = sortAlarms(getObjectAlarms(alarms, "T1"));
  const activeTransformerAlarm = relatedAlarms[0] ?? null;
  const impactSummary = getTopologyImpactSummary(topology, snapshot, "T1");

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

      {impactSummary ? (
        <>
          <div className="subpanel">
            <h3>Forsyningsvei</h3>
            <RouteSummary pathIds={impactSummary.pathIds} />
          </div>

          <div className="subpanel">
            <h3>Nettkonsekvens</h3>
            <div className="impact-grid">
              <ImpactStat label="Nedstrøms kunder" value={formatValue(impactSummary.totalCustomers)} accent />
              <ImpactStat label="Kritiske kunder" value={formatValue(impactSummary.criticalCustomers)} />
              <ImpactStat label="Feedere inne" value={formatValue(impactSummary.energizedFeederCount)} />
              <ImpactStat label="Feedere ute" value={formatValue(impactSummary.deenergizedFeederCount)} />
            </div>
            <p className="impact-note">
              Område: {impactSummary.downstreamFeederIds.join(", ") || "Ingen nedstrøms grener"}.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function SelectedObjectPanel({
  topology,
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

  useEffect(() => {
    if (!selectedAssetId) {
      return;
    }

    if (selectedAssetId === "T1" && activeTab === "command") {
      setActiveTab("status");
      return;
    }

    if (isStationBreaker(selectedAssetId) && activeTab === "measurements") {
      setActiveTab("status");
    }
  }, [activeTab, selectedAssetId]);

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
    return (
      <TransformerPanel
        snapshot={snapshot}
        topology={topology}
        alarms={alarms}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    );
  }

  if (isStationBreaker(resolvedAssetId)) {
    return (
      <StationBreakerPanel
        snapshot={snapshot}
        topology={topology}
        alarms={alarms}
        selectedAssetId={resolvedAssetId}
        lastCommandResult={lastCommandResult}
        busy={busy}
        onOpenBreaker={onOpenBreaker}
        onCloseBreaker={onCloseBreaker}
        onAcknowledgeAll={onAcknowledgeAll}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
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
  const impactSummary = getTopologyImpactSummary(topology, snapshot, selectedFeeder.id);
  const commandPreviews = getFeederCommandPreviews(selectedFeeder, snapshot);
  const liveInterlocks: string[] = [];
  const overloadStillActive = selectedFeeder.derived.utilizationPercent >= selectedFeeder.protection.warningPercent;
  const needsTripAcknowledgement = relatedAlarms.some(
    (alarm) => alarm.title === "Breaker tripped" && alarm.state !== "acknowledged",
  );

  if (selectedFeeder.quality !== "good") {
    liveInterlocks.push(`Datakvalitet er ${getQualityLabel(selectedFeeder.quality).toLowerCase()}.`);
  }
  if (selectedFeeder.breakerStatus === "tripped" && needsTripAcknowledgement) {
    liveInterlocks.push("Bryteren er utløst. Trip-alarmen må kvitteres før gjeninnkobling vurderes.");
  }
  if (control?.faultMode === "overload" && overloadStillActive) {
    liveInterlocks.push("Overlast er fortsatt aktiv. Lasten må ned under varselgrensen før bryteren kan lukkes.");
  }
  if (control && control.faultMode !== "normal" && control.faultMode !== "planned_outage" && control.faultMode !== "overload") {
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
        <span
          className={`state-pill tone-${
            feeder.breakerStatus === "closed" ? "good" : feeder.breakerStatus === "open" ? "warn" : "critical"
          }`}
        >
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
            <MetricRow label="Spenning min/max" value={formatVoltageRangeLabel(feeder.voltage, 0)} />
            <MetricRow label="Faseubalanse" value={`${formatValue(feeder.derived.phaseImbalancePercent, 1)} %`} />
            <MetricRow label="Kunder tilknyttet" value={formatValue(feeder.customers)} />
            <MetricRow label="Kritiske kunder" value={formatValue(feeder.criticalCustomers)} />
            <MetricRow label="Siste endring" value={formatTime(feeder.timestamp)} />
            <MetricRow label="Siste hendelse" value={relatedAlarms[0] ? relatedAlarms[0].title : "Ingen aktive alarmer"} />
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
            {feeder.breakerStatus === "tripped" ? (
              <div className={`command-result ${overloadStillActive || needsTripAcknowledgement ? "blocked" : "allowed"}`}>
                <strong>
                  {overloadStillActive || needsTripAcknowledgement
                    ? "Gjeninnkobling sperret"
                    : "Gjeninnkobling klar for vurdering"}
                </strong>
                <p>
                  {overloadStillActive
                    ? "Lasten er fortsatt for høy. Senk belastningen til overlastalarmen forsvinner før du lukker bryteren."
                    : needsTripAcknowledgement
                      ? "Trip-alarmen må kvitteres før gjeninnkobling vurderes."
                      : "Trip-tilstanden er ryddet. Bryteren kan lukkes etter vanlig operatørvurdering."}
                </p>
              </div>
            ) : null}
            {relatedCommand ? (
              <div className={`command-result ${relatedCommand.allowed ? "allowed" : "blocked"}`}>
                <strong>{relatedCommand.allowed ? "Kommando utført" : "Kommando blokkert"}</strong>
                <p>{relatedCommand.message}</p>
              </div>
            ) : null}
            <div className="command-preview-grid">
              <div className={`command-preview-card tone-${commandPreviews.open.tone}`}>
                <span>{commandPreviews.open.title}</span>
                <strong>{commandPreviews.open.headline}</strong>
                <p>{commandPreviews.open.detail}</p>
              </div>
              <div className={`command-preview-card tone-${commandPreviews.close.tone}`}>
                <span>{commandPreviews.close.title}</span>
                <strong>{commandPreviews.close.headline}</strong>
                <p>{commandPreviews.close.detail}</p>
              </div>
            </div>
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

      {impactSummary ? (
        <>
          <div className="subpanel">
            <h3>Forsyningsvei</h3>
            <RouteSummary pathIds={impactSummary.pathIds} />
          </div>

          <div className="subpanel">
            <h3>Nettkonsekvens</h3>
            <div className="impact-grid">
              <ImpactStat label="Kunder på gren" value={formatValue(impactSummary.totalCustomers)} accent />
              <ImpactStat label="Kritiske kunder" value={formatValue(impactSummary.criticalCustomers)} />
              <ImpactStat label="Forsyningsstatus" value={getBreakerOutcomeLabel(feeder.breakerStatus)} />
              <ImpactStat label="Kunder ute nå" value={formatValue(impactSummary.disconnectedCustomers)} />
            </div>
            <p className="impact-note">
              Ved utkobling på denne grenen påvirkes {feeder.id}. Oppstrøms forsyning er{" "}
              {impactSummary.upstreamSupplyAvailable ? "tilgjengelig" : "ikke tilgjengelig"}.
            </p>
          </div>
        </>
      ) : null}

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
