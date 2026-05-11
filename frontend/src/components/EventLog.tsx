import { formatTime, getEventTypeLabel } from "../dashboard-utils";
import type { EventEntry } from "../types";

interface EventLogProps {
  events: EventEntry[];
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
}

function isSelectableSource(source: string): boolean {
  return source === "T1" || /^F\d+$/.test(source);
}

export function EventLog({ events, selectedAssetId, onSelectAsset }: EventLogProps) {
  return (
    <section className="panel scada-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Historikk</p>
          <h2>HENDELSESLOGG</h2>
        </div>
      </div>

      <div className="table-shell">
        <div className="table-header event-table">
          <span>Tid</span>
          <span>Hendelse</span>
          <span>Objekt</span>
          <span>Detaljer</span>
        </div>

        <div className="table-body">
          {events.slice(0, 12).map((event) => {
            const selectable = isSelectableSource(event.source);
            return (
              <button
                key={event.id}
                type="button"
                className={`table-row event-table ${selectedAssetId === event.source ? "selected" : ""} ${
                  selectable ? "selectable" : "passive"
                }`}
                onClick={() => {
                  if (selectable) {
                    onSelectAsset(event.source);
                  }
                }}
              >
                <span>{formatTime(event.timestamp)}</span>
                <span className={`event-type event-${event.type}`}>{getEventTypeLabel(event.type)}</span>
                <span>{event.source}</span>
                <span className="row-primary">
                  <strong>{event.description}</strong>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
