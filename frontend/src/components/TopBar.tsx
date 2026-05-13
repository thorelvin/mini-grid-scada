import {
  formatDate,
  formatTime,
  getHighestPriorityAlarm,
  getSeverityLabel,
  getSystemCommunicationState,
} from "../dashboard-utils";
import type { ConnectionStatus, DashboardPayload } from "../types";

interface TopBarProps {
  dashboard: DashboardPayload | null;
  connectionStatus: ConnectionStatus;
}

function getTopAlarmIcon(title?: string | null): string {
  if (!title) {
    return "/assets/alarm-orbit.svg";
  }

  if (title.toLowerCase().includes("overload")) {
    return "/assets/overload-warning.svg";
  }

  return "/assets/alarm-orbit.svg";
}

function ConnectionBadge({ connectionStatus }: { connectionStatus: ConnectionStatus }) {
  return (
    <span className={`status-indicator status-${connectionStatus}`}>
      <span className="status-dot" />
      {connectionStatus.toUpperCase()}
    </span>
  );
}

export function TopBar({ dashboard, connectionStatus }: TopBarProps) {
  const highestAlarm = getHighestPriorityAlarm(dashboard?.activeAlarms ?? []);
  const communicationState = getSystemCommunicationState(dashboard);

  return (
    <header className="topbar">
      <div className="brand-block">
        <div>
          <h1>Tensio Demo SCADA</h1>
          <p className="brand-subtitle">Lavspent nettstasjon - simulert</p>
        </div>
        <ConnectionBadge connectionStatus={connectionStatus} />
      </div>

      <div className="topbar-grid">
        <section className="top-status-card">
          <p className="stat-label">Modus</p>
          <strong className="mode-pill">{dashboard?.snapshot.mode === "simulation" ? "SIMULERING" : "OFFLINE"}</strong>
        </section>

        <section className="top-status-card time-card">
          <strong>{formatTime(dashboard?.snapshot.timestamp)}</strong>
          <p>{formatDate(dashboard?.snapshot.timestamp)}</p>
        </section>

        <section className="top-status-card">
          <p className="stat-label">Systemkommunikasjon</p>
          <span className={`status-indicator tone-${communicationState.tone}`}>
            <span className="status-dot" />
            {communicationState.label}
          </span>
        </section>

        <section className="top-status-card">
          <p className="stat-label">MQTT broker</p>
          <span className={`status-indicator tone-${dashboard?.health.brokerStatus === "not-enabled" ? "warn" : "good"}`}>
            <span className="status-dot" />
            {dashboard?.health.brokerStatus === "not-enabled" ? "IKKE AKTIV" : "OK"}
          </span>
        </section>

        <section className="top-status-card">
          <p className="stat-label">Simulator</p>
          <span className={`status-indicator tone-${dashboard?.health.simulatorRunning ? "good" : "warn"}`}>
            <span className="status-dot" />
            {dashboard?.health.simulatorRunning ? "OK" : "STARTER"}
          </span>
        </section>

        <section className={`top-alarm-card ${highestAlarm ? `alarm-tone-${highestAlarm.severity}` : ""}`}>
          <div className="top-alarm-inner">
            <img className="top-alarm-icon" src={getTopAlarmIcon(highestAlarm?.title)} alt="" aria-hidden="true" />
            <div>
              <p className="stat-label">{highestAlarm ? getSeverityLabel(highestAlarm.severity) : "STATUS"}</p>
              <strong>{highestAlarm ? highestAlarm.title : "Ingen kritiske alarmer"}</strong>
              <p>{highestAlarm ? highestAlarm.objectName : "Systemet kjører innenfor normale grenser."}</p>
            </div>
          </div>
        </section>
      </div>
    </header>
  );
}
