import { useState } from "react";

import {
  formatDate,
  formatElapsed,
  formatTime,
  getEventTypeLabel,
  getHighestPriorityAlarm,
  getSeverityLabel,
} from "../dashboard-utils";
import type { DashboardPayload, EventEntry } from "../types";

interface ReplayTimelineProps {
  history: DashboardPayload[];
  replayIndex: number | null;
  isPlaying: boolean;
  onSelectIndex: (index: number) => void;
  onStep: (delta: number) => void;
  onTogglePlay: () => void;
  onJumpLive: () => void;
}

interface TimelineMarker {
  event: EventEntry;
  index: number;
}

type ReplayFilter = "all" | "alarms" | "commands" | "switching" | "scenarios";

function clampIndex(index: number, size: number): number {
  return Math.max(0, Math.min(index, Math.max(size - 1, 0)));
}

function buildTimelineMarkers(history: DashboardPayload[]): TimelineMarker[] {
  const markersById = new Map<string, TimelineMarker>();

  for (let index = 0; index < history.length; index += 1) {
    for (const event of history[index].recentEvents) {
      if (!markersById.has(event.id)) {
        markersById.set(event.id, { event, index });
      }
    }
  }

  return [...markersById.values()]
    .sort((left, right) => new Date(left.event.timestamp).getTime() - new Date(right.event.timestamp).getTime())
    .slice(-24);
}

function getMarkerFilterLabel(filter: ReplayFilter): string {
  switch (filter) {
    case "alarms":
      return "Alarmer";
    case "commands":
      return "Kommandoer";
    case "switching":
      return "Brytere";
    case "scenarios":
      return "Scenario";
    default:
      return "Alle";
  }
}

function markerMatchesFilter(marker: TimelineMarker, filter: ReplayFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "alarms") {
    return marker.event.type.startsWith("alarm_");
  }

  if (filter === "commands") {
    return marker.event.type === "command_executed" || marker.event.type === "command_blocked";
  }

  if (filter === "switching") {
    return marker.event.type === "breaker_state" || marker.event.type === "protection_trip";
  }

  return marker.event.type === "scenario_start" || marker.event.type === "timed_event_start" || marker.event.type === "timed_event_end";
}

function findNearestMarkerIndex(markers: TimelineMarker[], replayIndex: number): number | null {
  if (markers.length === 0) {
    return null;
  }

  let bestMarkerIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let index = 0; index < markers.length; index += 1) {
    const delta = Math.abs(markers[index].index - replayIndex);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestMarkerIndex = index;
    }
  }

  return bestMarkerIndex;
}

export function ReplayTimeline({
  history,
  replayIndex,
  isPlaying,
  onSelectIndex,
  onStep,
  onTogglePlay,
  onJumpLive,
}: ReplayTimelineProps) {
  const [activeFilter, setActiveFilter] = useState<ReplayFilter>("all");

  if (history.length === 0) {
    return null;
  }

  const currentIndex = replayIndex ?? history.length - 1;
  const clampedIndex = clampIndex(currentIndex, history.length);
  const currentFrame = history[clampedIndex];
  const highestAlarm = getHighestPriorityAlarm(currentFrame.activeAlarms);
  const historyStart = history[0]?.snapshot.timestamp ?? null;
  const historyEnd = history[history.length - 1]?.snapshot.timestamp ?? null;
  const markers = buildTimelineMarkers(history);
  const filteredMarkers = markers.filter((marker) => markerMatchesFilter(marker, activeFilter));
  const nearestFilteredMarkerIndex = findNearestMarkerIndex(filteredMarkers, clampedIndex);
  const currentMarker =
    nearestFilteredMarkerIndex != null ? filteredMarkers[nearestFilteredMarkerIndex] : null;
  const profileName =
    currentFrame.availableProfiles.find((profile) => profile.id === currentFrame.activeProfileId)?.name ??
    currentFrame.activeProfileId ??
    "Manuell drift";

  function jumpToMarker(direction: -1 | 1) {
    if (filteredMarkers.length === 0) {
      return;
    }

    if (nearestFilteredMarkerIndex == null) {
      onSelectIndex(filteredMarkers[0].index);
      return;
    }

    const nextIndex = Math.max(
      0,
      Math.min(filteredMarkers.length - 1, nearestFilteredMarkerIndex + direction),
    );
    onSelectIndex(filteredMarkers[nextIndex].index);
  }

  return (
    <section className="panel scada-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Replay</p>
          <h2>Tidslinje og hendelsesavspilling</h2>
        </div>
        <div className="panel-header-meta">
          <span>{replayIndex === null ? "LIVE" : isPlaying ? "REPLAY SPILLER" : "REPLAY PAUSET"}</span>
          <span>{history.length} frames / {filteredMarkers.length} markorer</span>
        </div>
      </div>

      <div className="replay-summary-grid">
        <div className="replay-summary-card">
          <span>Valgt tidspunkt</span>
          <strong>{formatTime(currentFrame.snapshot.timestamp)}</strong>
          <p>{formatDate(currentFrame.snapshot.timestamp)}</p>
        </div>
        <div className="replay-summary-card">
          <span>Historikkvindu</span>
          <strong>{historyStart && historyEnd ? `${formatTime(historyStart)} - ${formatTime(historyEnd)}` : "--"}</strong>
          <p>{historyStart ? `Dekker ${formatElapsed(historyStart)}` : "Bygger historikk"}</p>
        </div>
        <div className="replay-summary-card">
          <span>Aktiv tilstand</span>
          <strong>{profileName}</strong>
          <p>{highestAlarm ? `${getSeverityLabel(highestAlarm.severity)}: ${highestAlarm.title}` : "Ingen aktive alarmer"}</p>
        </div>
      </div>

      <div className="replay-filter-row">
        {(["all", "alarms", "commands", "switching", "scenarios"] as ReplayFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            className={`replay-filter-pill ${activeFilter === filter ? "active" : ""}`}
            onClick={() => setActiveFilter(filter)}
          >
            {getMarkerFilterLabel(filter)}
          </button>
        ))}
      </div>

      {currentMarker ? (
        <div className="replay-current-event">
          <div className="replay-current-event-meta">
            <span>{formatTime(currentMarker.event.timestamp)}</span>
            <strong>{getEventTypeLabel(currentMarker.event.type)}</strong>
            <span>{currentMarker.event.source}</span>
          </div>
          <p>{currentMarker.event.description}</p>
        </div>
      ) : (
        <div className="replay-current-event empty">
          <div className="replay-current-event-meta">
            <strong>Ingen markorer i valgt filter</strong>
          </div>
          <p>Bytt filter eller fortsett replay for a fylle tidslinjen.</p>
        </div>
      )}

      <div className="replay-controls">
        <button type="button" className="secondary-button" onClick={() => onSelectIndex(0)} disabled={clampedIndex === 0}>
          Først
        </button>
        <button type="button" className="secondary-button" onClick={() => onStep(-1)} disabled={clampedIndex === 0}>
          Tilbake
        </button>
        <button type="button" className="primary-button" onClick={onTogglePlay} disabled={history.length < 2}>
          {isPlaying ? "Pause replay" : "Spill replay"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onStep(1)}
          disabled={clampedIndex >= history.length - 1}
        >
          Frem
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => jumpToMarker(-1)}
          disabled={filteredMarkers.length === 0 || nearestFilteredMarkerIndex === 0}
        >
          Forrige hendelse
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => jumpToMarker(1)}
          disabled={
            filteredMarkers.length === 0 ||
            nearestFilteredMarkerIndex == null ||
            nearestFilteredMarkerIndex >= filteredMarkers.length - 1
          }
        >
          Neste hendelse
        </button>
        <button type="button" className="secondary-button" onClick={onJumpLive} disabled={replayIndex === null}>
          Til live
        </button>
      </div>

      <div className="replay-slider-shell">
        <input
          className="replay-slider"
          type="range"
          min={0}
          max={Math.max(history.length - 1, 0)}
          value={clampedIndex}
          onChange={(event) => onSelectIndex(Number(event.target.value))}
        />
        <div className="replay-slider-markers" aria-hidden="true">
          {filteredMarkers.map((marker) => {
            const position = history.length > 1 ? (marker.index / (history.length - 1)) * 100 : 0;
            return (
              <button
                key={marker.event.id}
                type="button"
                className={`replay-marker replay-event-${marker.event.type} ${
                  marker.index === currentMarker?.index ? "selected" : ""
                }`}
                style={{ left: `${position}%` }}
                onClick={() => onSelectIndex(marker.index)}
                title={`${formatTime(marker.event.timestamp)} - ${marker.event.description}`}
              />
            );
          })}
        </div>
        <div className="replay-slider-axis">
          <span>{historyStart ? formatTime(historyStart) : "--:--:--"}</span>
          <span>{historyEnd ? formatTime(historyEnd) : "--:--:--"}</span>
        </div>
      </div>

      <div className="replay-event-list">
        {filteredMarkers.map((marker) => (
          <button
            key={marker.event.id}
            type="button"
            className={`replay-event-item ${marker.index === currentMarker?.index ? "selected" : ""}`}
            onClick={() => onSelectIndex(marker.index)}
          >
            <span>{formatTime(marker.event.timestamp)}</span>
            <strong>{marker.event.source}</strong>
            <small>{getEventTypeLabel(marker.event.type)}</small>
            <p>{marker.event.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
