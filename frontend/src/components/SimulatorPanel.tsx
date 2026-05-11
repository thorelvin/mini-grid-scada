import { useEffect, useState } from "react";

import { formatElapsed, getFaultModeLabel, getQualityLabel } from "../dashboard-utils";
import type { FeederControlInput, ScenarioSummary, SimulatorSettings } from "../types";

type SimulatorTab = "load" | "faults" | "scenarios";

interface SimulatorPanelProps {
  controls: FeederControlInput[];
  simulatorSettings: SimulatorSettings | null;
  scenarios: ScenarioSummary[];
  activeScenarioId?: string | null;
  activeScenarioStartedAt?: string | null;
  busy: boolean;
  onApplyControl: (feederId: string, patch: Partial<FeederControlInput>) => Promise<void>;
  onApplySettings: (patch: Partial<SimulatorSettings>) => Promise<void>;
  onRunScenario: (scenarioId: string) => Promise<void>;
  onReset: () => Promise<void>;
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function ScenarioButton({
  active,
  scenario,
  onRun,
}: {
  active: boolean;
  scenario: ScenarioSummary;
  onRun: () => void;
}) {
  return (
    <button type="button" className={`scenario-card ${active ? "active" : ""}`} onClick={onRun}>
      <strong>{scenario.name}</strong>
      <p>{scenario.description}</p>
    </button>
  );
}

function getScenarioDisplayName(activeScenarioId: string | null | undefined, scenarios: ScenarioSummary[]): string {
  if (!activeScenarioId || activeScenarioId === "normal") {
    return "Normaltilstand";
  }
  if (activeScenarioId === "custom") {
    return "Manuell drift";
  }
  return scenarios.find((scenario) => scenario.id === activeScenarioId)?.name ?? activeScenarioId;
}

export function SimulatorPanel({
  controls,
  simulatorSettings,
  scenarios,
  activeScenarioId,
  activeScenarioStartedAt,
  busy,
  onApplyControl,
  onApplySettings,
  onRunScenario,
  onReset,
}: SimulatorPanelProps) {
  const [activeTab, setActiveTab] = useState<SimulatorTab>("load");
  const [drafts, setDrafts] = useState<Record<string, FeederControlInput>>({});
  const [ambientTempC, setAmbientTempC] = useState<number>(simulatorSettings?.ambientTempC ?? 18);

  useEffect(() => {
    const nextDrafts = Object.fromEntries(controls.map((control) => [control.id, control]));
    setDrafts(nextDrafts);
  }, [controls]);

  useEffect(() => {
    if (simulatorSettings) {
      setAmbientTempC(simulatorSettings.ambientTempC);
    }
  }, [simulatorSettings]);

  const manualScenarios = scenarios.filter((scenario) => scenario.id !== "normal");
  const isNormalState = !activeScenarioId || activeScenarioId === "normal";
  const scenarioDisplayName = getScenarioDisplayName(activeScenarioId, scenarios);

  return (
    <section className="panel scada-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Simulator</p>
          <h2>SIMULATOR & SCENARIER</h2>
        </div>
        <div className="panel-header-meta">
          <span>{busy ? "Oppdaterer" : scenarioDisplayName}</span>
          <span>{formatElapsed(activeScenarioStartedAt)}</span>
        </div>
      </div>

      <div className="simulator-status-row">
        <div className="simulator-status-copy">
          <strong>{isNormalState ? "Systemet står i normaltilstand" : `Aktiv tilstand: ${scenarioDisplayName}`}</strong>
          <p>
            {isNormalState
              ? "Manuelle endringer og feilscenarioer er ryddet bort."
              : "Bruk knappen under for å gå tilbake til nominelle feederverdier, normal bryterstatus og standard temperatur."}
          </p>
        </div>
        <button type="button" className="secondary-button simulator-reset-button" disabled={busy || isNormalState} onClick={() => void onReset()}>
          Til normaltilstand
        </button>
      </div>

      <div className="tab-strip">
        <TabButton active={activeTab === "load"} label="Last & produksjon" onClick={() => setActiveTab("load")} />
        <TabButton active={activeTab === "faults"} label="Feilscenarier" onClick={() => setActiveTab("faults")} />
        <TabButton active={activeTab === "scenarios"} label="Scenarier" onClick={() => setActiveTab("scenarios")} />
      </div>

      {activeTab === "load" ? (
        <div className="simulator-stack">
          {controls.map((control) => {
            const draft = drafts[control.id] ?? control;
            return (
              <div key={control.id} className="slider-card">
                <div className="slider-header">
                  <strong>Belastning {control.id} (kW)</strong>
                  <input
                    type="number"
                    value={draft.loadKw}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [control.id]: { ...draft, loadKw: Number(event.target.value) },
                      }))
                    }
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max={control.id === "F4" ? "180" : "320"}
                  step="1"
                  value={draft.loadKw}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [control.id]: { ...draft, loadKw: Number(event.target.value) },
                    }))
                  }
                />

                {control.id === "F4" ? (
                  <>
                    <div className="slider-header">
                      <strong>Solproduksjon F4 (kW)</strong>
                      <input
                        type="number"
                        value={draft.solarKw}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [control.id]: { ...draft, solarKw: Number(event.target.value) },
                          }))
                        }
                      />
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="140"
                      step="1"
                      value={draft.solarKw}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [control.id]: { ...draft, solarKw: Number(event.target.value) },
                        }))
                      }
                    />
                  </>
                ) : null}

                <button type="button" className="secondary-button full-width" onClick={() => void onApplyControl(control.id, draft)}>
                  Oppdater {control.id}
                </button>
              </div>
            );
          })}

          <div className="slider-card">
            <div className="slider-header">
              <strong>Omgivelsestemp (°C)</strong>
              <input type="number" value={ambientTempC} onChange={(event) => setAmbientTempC(Number(event.target.value))} />
            </div>
            <input type="range" min="-10" max="40" step="1" value={ambientTempC} onChange={(event) => setAmbientTempC(Number(event.target.value))} />
            <button type="button" className="secondary-button full-width" onClick={() => void onApplySettings({ ambientTempC })}>
              Oppdater temperatur
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "faults" ? (
        <div className="simulator-stack">
          {controls.map((control) => {
            const draft = drafts[control.id] ?? control;
            return (
              <article key={control.id} className="control-card">
                <div className="control-card-header">
                  <strong>{control.id}</strong>
                  <span>{getFaultModeLabel(draft.faultMode)}</span>
                </div>
                <div className="control-grid">
                  <label>
                    Reaktiv effekt (kVAr)
                    <input
                      type="number"
                      value={draft.reactivePowerKvar}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [control.id]: { ...draft, reactivePowerKvar: Number(event.target.value) },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Faseubalanse (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={draft.phaseImbalancePercent}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [control.id]: { ...draft, phaseImbalancePercent: Number(event.target.value) },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Bryterstatus
                    <select
                      value={draft.breakerStatus}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [control.id]: {
                            ...draft,
                            breakerStatus: event.target.value as FeederControlInput["breakerStatus"],
                          },
                        }))
                      }
                    >
                      <option value="closed">Lukket</option>
                      <option value="open">Åpen</option>
                      <option value="tripped">Utløst</option>
                    </select>
                  </label>
                  <label>
                    Datakvalitet
                    <select
                      value={draft.communicationState}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [control.id]: {
                            ...draft,
                            communicationState: event.target.value as FeederControlInput["communicationState"],
                          },
                        }))
                      }
                    >
                      <option value="good">{getQualityLabel("good")}</option>
                      <option value="estimated">{getQualityLabel("estimated")}</option>
                      <option value="stale">{getQualityLabel("stale")}</option>
                      <option value="invalid">{getQualityLabel("invalid")}</option>
                      <option value="lost">{getQualityLabel("lost")}</option>
                    </select>
                  </label>
                  <label className="control-grid-span">
                    Feilmodus
                    <select
                      value={draft.faultMode}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [control.id]: { ...draft, faultMode: event.target.value as FeederControlInput["faultMode"] },
                        }))
                      }
                    >
                      <option value="normal">Normal</option>
                      <option value="overload">Overlast</option>
                      <option value="planned_outage">Planlagt utkobling</option>
                      <option value="sensor_fault">Sensorfeil</option>
                      <option value="forced_trip">Tvungen trip</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="secondary-button full-width" onClick={() => void onApplyControl(control.id, draft)}>
                  Oppdater feiltilstand {control.id}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}

      {activeTab === "scenarios" ? (
        <div className="scenario-grid">
          {manualScenarios.map((scenario) => (
            <ScenarioButton
              key={scenario.id}
              active={activeScenarioId === scenario.id}
              scenario={scenario}
              onRun={() => void onRunScenario(scenario.id)}
            />
          ))}
          <button type="button" className="secondary-button full-width" onClick={() => void onReset()}>
            Til normaltilstand
          </button>
        </div>
      ) : null}
    </section>
  );
}
