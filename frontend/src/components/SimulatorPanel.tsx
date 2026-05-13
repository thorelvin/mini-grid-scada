import { useEffect, useState } from "react";

import { formatElapsed, getFaultModeLabel, getQualityLabel } from "../dashboard-utils";
import type {
  ActiveTimedEvent,
  FeederControlInput,
  NormalProfileSummary,
  ScenarioSummary,
  SimulatorSettings,
  TimedEventSummary,
} from "../types";

type SimulatorTab = "load" | "faults" | "patterns";

interface SimulatorPanelProps {
  controls: FeederControlInput[];
  simulatorSettings: SimulatorSettings | null;
  scenarios: ScenarioSummary[];
  profiles: NormalProfileSummary[];
  timedEvents: TimedEventSummary[];
  activeProfileId?: string | null;
  activeProfileStartedAt?: string | null;
  activeTimedEvents: ActiveTimedEvent[];
  activeScenarioId?: string | null;
  activeScenarioStartedAt?: string | null;
  busy: boolean;
  onApplyControl: (feederId: string, patch: Partial<FeederControlInput>) => Promise<void>;
  onApplySettings: (patch: Partial<SimulatorSettings>) => Promise<void>;
  onRunScenario: (scenarioId: string) => Promise<void>;
  onRunProfile: (profileId: string) => Promise<void>;
  onRunTimedEvent: (eventId: string) => Promise<void>;
  onReset: () => Promise<void>;
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function SimulatorCard({
  active,
  title,
  description,
  meta,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`scenario-card ${active ? "active" : ""}`} onClick={onClick}>
      <strong>{title}</strong>
      <p>{description}</p>
      {meta ? <span className="scenario-meta">{meta}</span> : null}
    </button>
  );
}

function formatRemaining(endsAt: string): string {
  const remainingMs = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}t ${String(restMinutes).padStart(2, "0")}m`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getProfileDisplayName(activeProfileId: string | null | undefined, profiles: NormalProfileSummary[]): string {
  if (!activeProfileId || activeProfileId === "custom") {
    return "Manuell drift";
  }
  return profiles.find((profile) => profile.id === activeProfileId)?.name ?? activeProfileId;
}

function getFaultScenarioDisplayName(activeScenarioId: string | null | undefined, scenarios: ScenarioSummary[]): string {
  if (!activeScenarioId || activeScenarioId === "custom") {
    return activeScenarioId === "custom" ? "Manuell tilpasning" : "Ingen feilscenario";
  }
  return scenarios.find((scenario) => scenario.id === activeScenarioId)?.name ?? activeScenarioId;
}

export function SimulatorPanel({
  controls,
  simulatorSettings,
  scenarios,
  profiles,
  timedEvents,
  activeProfileId,
  activeProfileStartedAt,
  activeTimedEvents,
  activeScenarioId,
  activeScenarioStartedAt,
  busy,
  onApplyControl,
  onApplySettings,
  onRunScenario,
  onRunProfile,
  onRunTimedEvent,
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

  const profileDisplayName = getProfileDisplayName(activeProfileId, profiles);
  const faultDisplayName = getFaultScenarioDisplayName(activeScenarioId, scenarios);
  const isManualProfile = !activeProfileId || activeProfileId === "custom";

  return (
    <section className="panel scada-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Simulator</p>
          <h2>SIMULATOR & SCENARIER</h2>
        </div>
        <div className="panel-header-meta">
          <span>{busy ? "Oppdaterer" : profileDisplayName}</span>
          <span>{formatElapsed(activeProfileStartedAt)}</span>
        </div>
      </div>

      <div className="simulator-status-row">
        <div className="simulator-status-copy">
          <strong>{isManualProfile ? "Systemet kjører i manuell drift" : `Aktiv normalprofil: ${profileDisplayName}`}</strong>
          <p>
            {isManualProfile
              ? "Manuelle justeringer eller feilscenario holder simulatoren i en statisk base til du bytter tilbake til standardprofil."
              : "Profilen oppdaterer feederlast, reaktiv effekt, ubalanse og solkurve kontinuerlig i bakgrunnen."}
          </p>
        </div>
        <button type="button" className="secondary-button simulator-reset-button" disabled={busy} onClick={() => void onReset()}>
          Til standardprofil
        </button>
      </div>

      <div className="simulator-summary-grid">
        <div className="simulator-summary-card">
          <span>Profil</span>
          <strong>{profileDisplayName}</strong>
          <p>{activeProfileStartedAt ? `Kjører i ${formatElapsed(activeProfileStartedAt)}` : "Ikke startet"}</p>
        </div>
        <div className="simulator-summary-card">
          <span>Aktive hendelser</span>
          <strong>{activeTimedEvents.length}</strong>
          <p>{activeTimedEvents.length ? activeTimedEvents.map((event) => event.name).join(", ") : "Ingen overlay akkurat nå"}</p>
        </div>
        <div className="simulator-summary-card">
          <span>Feilscenario</span>
          <strong>{faultDisplayName}</strong>
          <p>{activeScenarioStartedAt ? `Siden ${formatElapsed(activeScenarioStartedAt)}` : "Ingen fault overlay"}</p>
        </div>
      </div>

      {activeTimedEvents.length ? (
        <div className="active-event-list">
          {activeTimedEvents.map((event) => (
            <div key={event.id} className="active-event-chip">
              <strong>{event.name}</strong>
              <span>Gjenstår {formatRemaining(event.endsAt)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <fieldset className="simulator-fieldset" disabled={busy}>
      <div className="tab-strip">
        <TabButton active={activeTab === "load"} label="Last & produksjon" onClick={() => setActiveTab("load")} />
        <TabButton active={activeTab === "patterns"} label="Normalprofiler" onClick={() => setActiveTab("patterns")} />
        <TabButton active={activeTab === "faults"} label="Feilscenarier" onClick={() => setActiveTab("faults")} />
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
                      max="180"
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

      {activeTab === "patterns" ? (
        <div className="simulator-stack">
          <section className="subpanel">
            <h3>Kontinuerlige normalprofiler</h3>
            <p className="muted">Velg en profil som kontinuerlig simulerer normalt bruksmønster hos feederne.</p>
            <div className="scenario-grid">
              {profiles.map((profile) => (
                <SimulatorCard
                  key={profile.id}
                  active={activeProfileId === profile.id}
                  title={profile.name}
                  description={profile.description}
                  meta={`${profile.cycleMinutes} min syklus`}
                  onClick={() => void onRunProfile(profile.id)}
                />
              ))}
            </div>
          </section>

          <section className="subpanel">
            <h3>Tidsavgrensede hendelser</h3>
            <p className="muted">Kjør korte eller lengre overlay-hendelser oppå den aktive normalprofilen.</p>
            <div className="scenario-grid">
              {timedEvents.map((timedEvent) => (
                <SimulatorCard
                  key={timedEvent.id}
                  active={activeTimedEvents.some((activeEvent) => activeEvent.id === timedEvent.id)}
                  title={timedEvent.name}
                  description={timedEvent.description}
                  meta={timedEvent.durationSec >= 3600 ? "60 min hendelse" : "10 min hendelse"}
                  onClick={() => void onRunTimedEvent(timedEvent.id)}
                />
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "faults" ? (
        <div className="simulator-stack">
          <section className="subpanel">
            <h3>Feilscenarier</h3>
            <p className="muted">Bruk fault overlays for å trigge alarmer, interlocks og operative konsekvenser.</p>
            <div className="scenario-grid">
              {scenarios.map((scenario) => (
                <SimulatorCard
                  key={scenario.id}
                  active={activeScenarioId === scenario.id}
                  title={scenario.name}
                  description={scenario.description}
                  onClick={() => void onRunScenario(scenario.id)}
                />
              ))}
            </div>
          </section>

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
      </fieldset>
    </section>
  );
}
