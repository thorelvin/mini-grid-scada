import {
  formatTime,
  getAlarmStateLabel,
  getSeverityLabel,
  sortAlarms,
} from "../dashboard-utils";
import type { Alarm } from "../types";

interface AlarmListProps {
  alarms: Alarm[];
  selectedAssetId: string | null;
  onAcknowledge: (alarmId: string) => Promise<void>;
  onAcknowledgeAll: () => Promise<void>;
  onSelectAsset: (assetId: string) => void;
  readOnly?: boolean;
}

export function AlarmList({
  alarms,
  selectedAssetId,
  onAcknowledge,
  onAcknowledgeAll,
  onSelectAsset,
  readOnly = false,
}: AlarmListProps) {
  const sortedAlarms = sortAlarms(alarms);

  return (
    <section className="panel scada-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Operatørbilde</p>
          <h2>AKTIVE ALARMER ({sortedAlarms.length})</h2>
        </div>
      </div>

      {sortedAlarms.length === 0 ? (
        <div className="empty-panel">
          <p>Ingen aktive alarmer.</p>
          <span>Systemet er stabilt akkurat nå.</span>
        </div>
      ) : (
        <>
          <div className="table-shell">
            <div className="table-header alarm-table">
              <span>Tid</span>
              <span>Pri</span>
              <span>Alarm</span>
              <span>Obj</span>
              <span>Stat</span>
              <span>Kvitt</span>
            </div>

            <div className="table-body">
              {sortedAlarms.map((alarm) => (
                <button
                  key={alarm.id}
                  type="button"
                  className={`table-row alarm-table ${selectedAssetId === alarm.objectId ? "selected" : ""}`}
                  onClick={() => onSelectAsset(alarm.objectId)}
                >
                  <span>{formatTime(alarm.createdAt)}</span>
                  <span className={`severity-badge severity-${alarm.severity}`}>{getSeverityLabel(alarm.severity)}</span>
                  <span className="row-primary">
                    <strong>{alarm.title}</strong>
                    <small>{alarm.message}</small>
                  </span>
                  <span>{alarm.objectId}</span>
                  <span className={`state-label state-${alarm.state}`}>{getAlarmStateLabel(alarm.state)}</span>
                  <span>
                    {alarm.state !== "acknowledged" && !readOnly ? (
                      <span
                        className="inline-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onAcknowledge(alarm.id);
                        }}
                      >
                        Kvitter
                      </span>
                    ) : (
                      <span className="muted">Klar</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="secondary-button full-width" onClick={() => void onAcknowledgeAll()} disabled={readOnly}>
            Kvitter alle alarmer
          </button>
        </>
      )}
    </section>
  );
}
