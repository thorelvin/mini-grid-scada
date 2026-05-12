import {
  formatElapsed,
  formatValue,
  getAcknowledgedCount,
  getAverageDataAgeSeconds,
  getAverageQualityPercent,
} from "../dashboard-utils";
import type { ConnectionStatus, DashboardPayload } from "../types";

interface StatusFooterProps {
  dashboard: DashboardPayload | null;
  connectionStatus: ConnectionStatus;
  onExportReport: () => void;
}

function FooterStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="footer-stat">
      <span>{label}</span>
      <strong className={accent ? "accent-value" : ""}>{value}</strong>
    </div>
  );
}

export function StatusFooter({ dashboard, connectionStatus, onExportReport }: StatusFooterProps) {
  const operatingUptimeBase =
    dashboard?.activeTimedEvents[0]?.startedAt ??
    dashboard?.activeScenarioStartedAt ??
    dashboard?.activeProfileStartedAt ??
    dashboard?.systemStartedAt ??
    null;
  const profileName =
    dashboard?.availableProfiles.find((profile) => profile.id === dashboard.activeProfileId)?.name ??
    dashboard?.activeProfileId ??
    "manuell";
  const operatingState = dashboard?.activeTimedEvents.length
    ? `${profileName} + ${dashboard.activeTimedEvents.length} hend.`
    : dashboard?.activeScenarioId
      ? `${profileName} + feil`
      : profileName;

  return (
    <footer className="status-footer">
      <div className="footer-stats-grid">
        <FooterStat label="Forbindelse" value={connectionStatus.toUpperCase()} />
        <FooterStat
          label="Dataalder"
          value={`${formatValue(getAverageDataAgeSeconds(dashboard?.health ?? null), 1)} s`}
        />
        <FooterStat
          label="Kvalitet"
          value={`${formatValue(getAverageQualityPercent(dashboard), 0)} %`}
          accent={getAverageQualityPercent(dashboard) >= 90}
        />
        <FooterStat label="Alarmer aktive" value={String(dashboard?.activeAlarms.length ?? 0)} />
        <FooterStat
          label="Kvitterte alarmer"
          value={String(getAcknowledgedCount(dashboard?.activeAlarms ?? []))}
        />
        <FooterStat label="Driftsmodus" value={operatingState} />
        <FooterStat label="Gående tid" value={formatElapsed(operatingUptimeBase)} />
      </div>

      <button type="button" className="secondary-button footer-action" onClick={onExportReport} disabled={!dashboard}>
        Eksporter rapport
      </button>
    </footer>
  );
}
