import { useEffect, useState } from "react";

import { getTrends } from "../api";
import {
  formatTime,
  formatTrendWindowLabel,
  formatValue,
  getLiveWindowLabel,
  getTrendBounds,
  getTrendSeriesColor,
} from "../dashboard-utils";
import type { DashboardTrends, StationSnapshot, TrendSeries } from "../types";

interface TrendChartsProps {
  trends: DashboardTrends | null;
  dashboardTimestamp?: string | null;
  focusTimestamp?: string | null;
  selectedAssetId?: string | null;
  snapshot?: StationSnapshot | null;
}

type TrendMetricKey =
  | "voltage"
  | "currentMax"
  | "activePower"
  | "waterFlow"
  | "generationSupport"
  | "transformerLoad";
type TrendWindowState = Record<TrendMetricKey, number>;
type TrendScopeMode = "selected" | "overview";
type VoltagePhase = "l1" | "l2" | "l3" | "all";

interface HoveredTrendEntry {
  id: string;
  label: string;
  color: string;
  timestamp: string;
  value: number;
  y: number;
}

interface HoveredTrendState {
  x: number;
  leftPx: number;
  timestamp: string;
  entries: HoveredTrendEntry[];
}

const DEFAULT_TREND_WINDOW_SEC = 15 * 60;
const TREND_WINDOW_OPTIONS = [5 * 60, 15 * 60, 30 * 60, 60 * 60, 3 * 60 * 60, 6 * 60 * 60];

function isGenerationSupportFeeder(snapshotFeeder: StationSnapshot["feeders"][number] | null): boolean {
  return !!snapshotFeeder && snapshotFeeder.customers === 0 && (snapshotFeeder.nominalGenerationEquivalentHomes ?? 0) > 0;
}

function getSupportHomesLabel(snapshotFeeder: StationSnapshot["feeders"][number]): string {
  const currentHomes = snapshotFeeder.generationEquivalentHomes ?? 0;
  const nominalHomes = snapshotFeeder.nominalGenerationEquivalentHomes ?? currentHomes;
  return `${formatValue(currentHomes)} av ca. ${formatValue(nominalHomes)} boliger`;
}

function getPowerModeLabel(activePowerKw: number): string {
  if (activePowerKw < -0.5) {
    return "Eksporterer lokalt";
  }
  if (activePowerKw > 0.5) {
    return "Trekker fra nettet";
  }
  return "Noytral drift";
}

function buildPath(
  points: TrendSeries["points"],
  bounds: { min: number; max: number },
  domain: { start: number; end: number },
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
): string {
  if (points.length === 0) {
    return "";
  }

  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;

  return points
    .map((point, index) => {
      const timestamp = new Date(point.timestamp).getTime();
      const x =
        paddingX +
        ((timestamp - domain.start) / Math.max(domain.end - domain.start, 1)) * plotWidth;
      const y =
        height -
        paddingY -
        ((point.value - bounds.min) / Math.max(bounds.max - bounds.min, 0.0001)) * plotHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function valueToY(
  value: number,
  bounds: { min: number; max: number },
  height: number,
  paddingY: number,
): number {
  const plotHeight = height - paddingY * 2;
  return (
    height -
    paddingY -
    ((value - bounds.min) / Math.max(bounds.max - bounds.min, 0.0001)) * plotHeight
  );
}

function timestampToX(
  timeMs: number,
  domain: { start: number; end: number },
  width: number,
  paddingX: number,
): number {
  return (
    paddingX +
    ((timeMs - domain.start) / Math.max(domain.end - domain.start, 1)) * (width - paddingX * 2)
  );
}

function findNearestTimestamp(sortedTimestamps: number[], targetMs: number): number | null {
  if (sortedTimestamps.length === 0) {
    return null;
  }

  return sortedTimestamps.reduce((closest, current) =>
    Math.abs(current - targetMs) < Math.abs(closest - targetMs) ? current : closest,
  );
}

function findNearestPoint(points: TrendSeries["points"], targetMs: number) {
  if (points.length === 0) {
    return null;
  }

  return points.reduce((closest, current) => {
    const closestDelta = Math.abs(new Date(closest.timestamp).getTime() - targetMs);
    const currentDelta = Math.abs(new Date(current.timestamp).getTime() - targetMs);
    return currentDelta < closestDelta ? current : closest;
  });
}

function TrendWindowSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (nextValue: number) => void;
}) {
  return (
    <label className="trend-window-select">
      <span>Viser</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {TREND_WINDOW_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {formatTrendWindowLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TrendScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`trend-scope-button ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function VoltagePhaseButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`trend-phase-button ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function buildVoltageSeries(
  trends: DashboardTrends,
  scopeMode: TrendScopeMode,
  selectedFeederId: string | null,
  voltagePhase: VoltagePhase,
): TrendSeries[] {
  const voltageL2Series = trends.voltageL2 ?? [];
  const phaseMap = {
    l1: trends.voltageL1 ?? voltageL2Series,
    l2: voltageL2Series,
    l3: trends.voltageL3 ?? voltageL2Series,
  };

  if (scopeMode === "selected" && selectedFeederId) {
    if (voltagePhase === "all") {
      return (["l1", "l2", "l3"] as const)
        .map((phase) => {
          const source = phaseMap[phase].find((series) => series.id === selectedFeederId);
          if (!source) {
            return null;
          }
          return {
            ...source,
            id: `${selectedFeederId}:${phase}`,
            label: phase.toUpperCase(),
          };
        })
        .filter((series): series is TrendSeries => series !== null);
    }

    return phaseMap[voltagePhase].filter((series) => series.id === selectedFeederId);
  }

  const phaseKey = voltagePhase === "all" ? "l2" : voltagePhase;
  return phaseMap[phaseKey];
}

function getVoltageChartTitle(voltagePhase: VoltagePhase): string {
  if (voltagePhase === "all") {
    return "Spenning alle faser";
  }
  return `Spenning ${voltagePhase.toUpperCase()}`;
}

function LineChartCard({
  title,
  unit,
  seriesCollection,
  windowSec,
  onWindowChange,
  isRefreshing,
  focusTimestamp,
}: {
  title: string;
  unit: string;
  seriesCollection: TrendSeries[];
  windowSec: number;
  onWindowChange: (nextWindowSec: number) => void;
  isRefreshing: boolean;
  focusTimestamp?: string | null;
}) {
  const width = 360;
  const height = 180;
  const paddingX = 16;
  const paddingY = 18;
  const bounds = getTrendBounds(seriesCollection);
  const timestamps = seriesCollection.flatMap((series) =>
    series.points.map((point) => new Date(point.timestamp).getTime()),
  );
  const domain = {
    start: timestamps.length ? Math.min(...timestamps) : 0,
    end: timestamps.length ? Math.max(...timestamps) : 1,
  };
  const thresholdHigh =
    seriesCollection.find((series) => series.thresholdHigh != null)?.thresholdHigh ?? null;
  const thresholdLow =
    seriesCollection.find((series) => series.thresholdLow != null)?.thresholdLow ?? null;
  const startLabel = seriesCollection[0]?.points[0]?.timestamp;
  const endLabel =
    seriesCollection[0]?.points[seriesCollection[0]?.points.length - 1]?.timestamp;
  const focusTimeMs = focusTimestamp ? new Date(focusTimestamp).getTime() : null;
  const hasFocusInDomain =
    focusTimeMs != null && domain.start <= focusTimeMs && focusTimeMs <= domain.end;
  const focusX = hasFocusInDomain
    ? timestampToX(focusTimeMs, domain, width, paddingX)
    : null;
  const allTimestamps = Array.from(
    new Set(
      seriesCollection.flatMap((series) =>
        series.points.map((point) => new Date(point.timestamp).getTime()),
      ),
    ),
  ).sort((left, right) => left - right);
  const [hoverState, setHoverState] = useState<HoveredTrendState | null>(null);
  const effectiveFocusX = hoverState?.x ?? focusX;
  const hoverValueById = new Map(
    hoverState?.entries.map((entry) => [entry.id, entry.value]) ?? [],
  );

  useEffect(() => {
    setHoverState(null);
  }, [seriesCollection, windowSec, focusTimestamp, title]);

  function handleMouseMove(event: React.MouseEvent<SVGSVGElement>) {
    if (allTimestamps.length === 0) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const localX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const targetMs =
      domain.start + (localX / rect.width) * Math.max(domain.end - domain.start, 1);
    const nearestTimeMs = findNearestTimestamp(allTimestamps, targetMs);
    if (nearestTimeMs == null) {
      setHoverState(null);
      return;
    }

    const entries = seriesCollection
      .map((series) => {
        const point = findNearestPoint(series.points, nearestTimeMs);
        if (!point) {
          return null;
        }

        return {
          id: series.id,
          label: series.label,
          color: getTrendSeriesColor(series.id),
          timestamp: point.timestamp,
          value: point.value,
          y: valueToY(point.value, bounds, height, paddingY),
        };
      })
      .filter((entry): entry is HoveredTrendEntry => entry !== null);

    if (entries.length === 0) {
      setHoverState(null);
      return;
    }

    const chartX = timestampToX(nearestTimeMs, domain, width, paddingX);
    const viewboxToPx = rect.width / width;
    const rawLeftPx = chartX * viewboxToPx;
    const tooltipHalfWidth = 96;

    setHoverState({
      x: chartX,
      leftPx: Math.max(tooltipHalfWidth, Math.min(rawLeftPx, rect.width - tooltipHalfWidth)),
      timestamp: entries[0].timestamp,
      entries,
    });
  }

  return (
    <article className="trend-panel">
      <div className="trend-panel-header">
        <div>
          <strong>{title}</strong>
          <p>
            {isRefreshing
              ? "Oppdaterer trendvindu..."
              : hoverState
                ? `Hover ${formatTime(hoverState.timestamp)}`
              : hasFocusInDomain && focusTimestamp
                ? `Replaymarkor ${formatTime(focusTimestamp)}`
                : getLiveWindowLabel(seriesCollection)}
          </p>
        </div>
        <TrendWindowSelect value={windowSec} onChange={onWindowChange} />
      </div>

      <div className="trend-plot-shell">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="trend-svg"
          role="img"
          aria-label={title}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverState(null)}
        >
          {[0.25, 0.5, 0.75].map((step) => (
            <line
              key={step}
              x1={paddingX}
              x2={width - paddingX}
              y1={paddingY + (height - paddingY * 2) * step}
              y2={paddingY + (height - paddingY * 2) * step}
              className="trend-grid-line"
            />
          ))}

          {thresholdHigh != null ? (
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={valueToY(thresholdHigh, bounds, height, paddingY)}
              y2={valueToY(thresholdHigh, bounds, height, paddingY)}
              className="trend-threshold trend-threshold-high"
            />
          ) : null}

          {thresholdLow != null ? (
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={valueToY(thresholdLow, bounds, height, paddingY)}
              y2={valueToY(thresholdLow, bounds, height, paddingY)}
              className="trend-threshold trend-threshold-low"
            />
          ) : null}

          {effectiveFocusX != null ? (
            <line
              x1={effectiveFocusX}
              x2={effectiveFocusX}
              y1={paddingY}
              y2={height - paddingY}
              className={hoverState ? "trend-hover-line" : "trend-focus-line"}
            />
          ) : null}

          {seriesCollection.map((series) => {
            const path = buildPath(series.points, bounds, domain, width, height, paddingX, paddingY);
            const latestPoint = series.points[series.points.length - 1];
            if (!path || !latestPoint) {
              return null;
            }
            const x = timestampToX(
              new Date(latestPoint.timestamp).getTime(),
              domain,
              width,
              paddingX,
            );
            const y = valueToY(latestPoint.value, bounds, height, paddingY);
            const stroke = getTrendSeriesColor(series.id);

            return (
              <g key={series.id}>
                <path d={path} fill="none" stroke={stroke} strokeWidth="2.2" />
                <circle cx={x} cy={y} r="3.5" fill={stroke} />
              </g>
            );
          })}

          {hoverState?.entries.map((entry) => (
            <circle
              key={`hover-${entry.id}`}
              cx={hoverState.x}
              cy={entry.y}
              r="4.2"
              fill={entry.color}
              className="trend-hover-point"
            />
          ))}

          <rect
            x={paddingX}
            y={paddingY}
            width={width - paddingX * 2}
            height={height - paddingY * 2}
            className="trend-hover-capture"
          />
        </svg>

        {hoverState ? (
          <div className="trend-tooltip" style={{ left: `${hoverState.leftPx}px` }}>
            <div className="trend-tooltip-head">
              <strong>{formatTime(hoverState.timestamp)}</strong>
              <span>{title}</span>
            </div>
            <div className="trend-tooltip-list">
              {hoverState.entries.map((entry) => (
                <div key={`tooltip-${entry.id}`} className="trend-tooltip-row">
                  <span className="legend-swatch" style={{ background: entry.color }} />
                  <span>{entry.label}</span>
                  <strong>
                    {formatValue(entry.value, unit === "%" ? 0 : 0)} {unit}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="trend-axis">
        <span>{startLabel ? formatTime(startLabel) : "--:--"}</span>
        <span>{endLabel ? formatTime(endLabel) : "--:--"}</span>
      </div>

      <div className="trend-legend">
        {seriesCollection.map((series) => (
          <div key={series.id} className="legend-item">
            <span className="legend-swatch" style={{ background: getTrendSeriesColor(series.id) }} />
            <span>{series.label}</span>
            <strong>
              {formatValue(hoverValueById.get(series.id) ?? series.latestValue, unit === "%" ? 0 : 0)} {unit}
            </strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function TrendCharts({
  trends,
  dashboardTimestamp,
  focusTimestamp,
  selectedAssetId,
  snapshot,
}: TrendChartsProps) {
  const [trendWindows, setTrendWindows] = useState<TrendWindowState>({
    voltage: DEFAULT_TREND_WINDOW_SEC,
    currentMax: DEFAULT_TREND_WINDOW_SEC,
    activePower: DEFAULT_TREND_WINDOW_SEC,
    waterFlow: DEFAULT_TREND_WINDOW_SEC,
    generationSupport: DEFAULT_TREND_WINDOW_SEC,
    transformerLoad: DEFAULT_TREND_WINDOW_SEC,
  });
  const [customTrends, setCustomTrends] = useState<DashboardTrends | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scopeMode, setScopeMode] = useState<TrendScopeMode>("overview");
  const [voltagePhase, setVoltagePhase] = useState<VoltagePhase>("l2");

  const selectedFeeder = snapshot?.feeders.find((feeder) => feeder.id === selectedAssetId) ?? null;
  const selectedGenerationFeeder = isGenerationSupportFeeder(selectedFeeder) ? selectedFeeder : null;
  const supportsSelectedScope = !!selectedFeeder;
  const scopeLabel = selectedFeeder ? `${selectedFeeder.id} - ${selectedFeeder.name}` : "Stasjonsoversikt";

  const hasCustomWindowSelection = Object.values(trendWindows).some(
    (windowSec) => windowSec !== DEFAULT_TREND_WINDOW_SEC,
  );

  useEffect(() => {
    setScopeMode(supportsSelectedScope ? "selected" : "overview");
    setVoltagePhase(supportsSelectedScope ? "all" : "l2");
  }, [supportsSelectedScope, selectedAssetId]);

  useEffect(() => {
    if (!trends) {
      return;
    }
    if (!hasCustomWindowSelection) {
      setCustomTrends(null);
      setIsRefreshing(false);
      return;
    }

    let cancelled = false;
    setIsRefreshing(true);
    void getTrends({
      voltageWindowSec: trendWindows.voltage,
      currentWindowSec: trendWindows.currentMax,
      activePowerWindowSec: trendWindows.activePower,
      waterFlowWindowSec: trendWindows.waterFlow,
      generationSupportWindowSec: trendWindows.generationSupport,
      transformerWindowSec: trendWindows.transformerLoad,
    })
      .then((nextTrends) => {
        if (!cancelled) {
          setCustomTrends(nextTrends);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dashboardTimestamp, hasCustomWindowSelection, trendWindows, trends]);

  const activeTrends = hasCustomWindowSelection ? customTrends ?? trends : trends;
  const resolvedScopeMode = supportsSelectedScope ? scopeMode : "overview";
  const resolvedVoltagePhase = resolvedScopeMode === "overview" && voltagePhase === "all" ? "l2" : voltagePhase;
  const scopedVoltageSeries =
    activeTrends
      ? buildVoltageSeries(
          activeTrends,
          resolvedScopeMode,
          selectedFeeder?.id ?? null,
          resolvedVoltagePhase,
        )
      : [];
  const scopedCurrentSeries =
    resolvedScopeMode === "selected" && selectedFeeder
      ? activeTrends?.currentMax.filter((series) => series.id === selectedFeeder.id) ?? []
      : activeTrends?.currentMax ?? [];
  const scopedActivePowerSeries =
    resolvedScopeMode === "selected" && selectedFeeder
      ? activeTrends?.activePower.filter((series) => series.id === selectedFeeder.id) ?? []
      : [];
  const scopedWaterFlowSeries =
    resolvedScopeMode === "selected" && selectedFeeder
      ? activeTrends?.waterFlowPercent.filter((series) => series.id === selectedFeeder.id) ?? []
      : [];
  const scopedGenerationSupportSeries =
    resolvedScopeMode === "selected" && selectedFeeder
      ? activeTrends?.generationSupportHomes.filter((series) => series.id === selectedFeeder.id) ?? []
      : [];
  const scopedTransformerSeries = activeTrends?.transformerLoad ?? [];
  const hasTrendPoints =
    !!activeTrends &&
    [
      ...scopedVoltageSeries,
      ...scopedCurrentSeries,
      ...scopedActivePowerSeries,
      ...scopedWaterFlowSeries,
      ...scopedGenerationSupportSeries,
      ...scopedTransformerSeries,
    ].some(
      (series) => series.points.length > 0,
    );

  function updateWindow(metric: TrendMetricKey, nextWindowSec: number) {
    setTrendWindows((current) => ({
      ...current,
      [metric]: nextWindowSec,
    }));
  }

  if (!activeTrends) {
    return (
      <section className="panel scada-panel">
        <div className="panel-header">
          <div className="trend-section-copy">
            <p className="panel-kicker">Trender</p>
            <h2>Trenddata ikke tilgjengelig</h2>
          </div>
        </div>
      </section>
    );
  }

  if (!hasTrendPoints) {
    return (
      <section className="panel scada-panel">
        <div className="panel-header">
          <div className="trend-section-copy">
            <p className="panel-kicker">Trender</p>
            <h2>Samler trenddata...</h2>
          </div>
        </div>
        <p className="muted">Historikken fylles automatisk etter noen simulatorticks.</p>
      </section>
    );
  }

  return (
    <section className="panel scada-panel">
      <div className="panel-header">
        <div className="trend-section-copy">
          <p className="panel-kicker">Trender</p>
          <h2>
            {resolvedScopeMode === "selected" && selectedFeeder
              ? `Historikk for ${scopeLabel}`
              : "Historikk og live-malinger"}
          </h2>
          <p>
            {resolvedScopeMode === "selected" && selectedFeeder
              ? "Folg valgt feeder, og bytt fase ved behov."
              : "Oversiktsmodus viser alle feederne side om side for valgt fase."}
          </p>
        </div>
        <div className="trend-panel-controls">
          {supportsSelectedScope ? (
            <div className="trend-scope-switch" role="tablist" aria-label="Trendvisning">
              <TrendScopeButton
                active={resolvedScopeMode === "selected"}
                label="Valgt objekt"
                onClick={() => setScopeMode("selected")}
              />
              <TrendScopeButton
                active={resolvedScopeMode === "overview"}
                label="Oversikt"
                onClick={() => setScopeMode("overview")}
              />
            </div>
          ) : null}
          <div className="trend-phase-switch" role="tablist" aria-label="Spenningsfase">
            <VoltagePhaseButton active={resolvedVoltagePhase === "l1"} label="L1" onClick={() => setVoltagePhase("l1")} />
            <VoltagePhaseButton active={resolvedVoltagePhase === "l2"} label="L2" onClick={() => setVoltagePhase("l2")} />
            <VoltagePhaseButton active={resolvedVoltagePhase === "l3"} label="L3" onClick={() => setVoltagePhase("l3")} />
            {resolvedScopeMode === "selected" && selectedFeeder ? (
              <VoltagePhaseButton
                active={resolvedVoltagePhase === "all"}
                label="Alle"
                onClick={() => setVoltagePhase("all")}
              />
            ) : null}
          </div>
          <span className="trend-context-pill">{scopeLabel}</span>
        </div>
      </div>

      {selectedGenerationFeeder ? (
        <div className="trend-support-strip">
          <article className="trend-support-card">
            <span>Netto effekt</span>
            <strong>
              {selectedGenerationFeeder.activePowerKw < 0
                ? `${formatValue(Math.abs(selectedGenerationFeeder.activePowerKw), 0)} kW eksport`
                : `${formatValue(selectedGenerationFeeder.activePowerKw, 0)} kW import`}
            </strong>
            <p>{getPowerModeLabel(selectedGenerationFeeder.activePowerKw)}</p>
          </article>
          <article className="trend-support-card">
            <span>Vannforing</span>
            <strong>{`${formatValue(selectedGenerationFeeder.waterFlowPercent ?? 0, 0)} %`}</strong>
            <p>Tilgjengelig vann driver hvor mye Romstad Kraftverk faktisk kan levere.</p>
          </article>
          <article className="trend-support-card">
            <span>Kan forsyne ca.</span>
            <strong>{getSupportHomesLabel(selectedGenerationFeeder)}</strong>
            <p>
              {`${formatValue(selectedGenerationFeeder.availableGenerationKw ?? 0, 0)} kW tilgjengelig / ${formatValue(selectedGenerationFeeder.generationSetpointKw ?? 0, 0)} kW settpunkt akkurat na.`}
            </p>
          </article>
        </div>
      ) : null}

      <div className="trend-layout">
        <LineChartCard
          title={getVoltageChartTitle(resolvedVoltagePhase)}
          unit="V"
          seriesCollection={scopedVoltageSeries}
          windowSec={trendWindows.voltage}
          onWindowChange={(nextWindowSec) => updateWindow("voltage", nextWindowSec)}
          isRefreshing={isRefreshing && hasCustomWindowSelection}
          focusTimestamp={focusTimestamp}
        />
        <LineChartCard
          title="Strom maks"
          unit="A"
          seriesCollection={scopedCurrentSeries}
          windowSec={trendWindows.currentMax}
          onWindowChange={(nextWindowSec) => updateWindow("currentMax", nextWindowSec)}
          isRefreshing={isRefreshing && hasCustomWindowSelection}
          focusTimestamp={focusTimestamp}
        />
        {resolvedScopeMode === "selected" && selectedFeeder ? (
          <LineChartCard
            title={selectedGenerationFeeder ? "Netto produksjon" : "Aktiv effekt"}
            unit="kW"
            seriesCollection={scopedActivePowerSeries}
            windowSec={trendWindows.activePower}
            onWindowChange={(nextWindowSec) => updateWindow("activePower", nextWindowSec)}
            isRefreshing={isRefreshing && hasCustomWindowSelection}
            focusTimestamp={focusTimestamp}
          />
        ) : null}
        {selectedGenerationFeeder ? (
          <LineChartCard
            title="Vannforing"
            unit="%"
            seriesCollection={scopedWaterFlowSeries}
            windowSec={trendWindows.waterFlow}
            onWindowChange={(nextWindowSec) => updateWindow("waterFlow", nextWindowSec)}
            isRefreshing={isRefreshing && hasCustomWindowSelection}
            focusTimestamp={focusTimestamp}
          />
        ) : null}
        {selectedGenerationFeeder ? (
          <LineChartCard
            title="Forsyningsstotte"
            unit="boliger"
            seriesCollection={scopedGenerationSupportSeries}
            windowSec={trendWindows.generationSupport}
            onWindowChange={(nextWindowSec) => updateWindow("generationSupport", nextWindowSec)}
            isRefreshing={isRefreshing && hasCustomWindowSelection}
            focusTimestamp={focusTimestamp}
          />
        ) : null}
        <LineChartCard
          title="Trafolast"
          unit="%"
          seriesCollection={scopedTransformerSeries}
          windowSec={trendWindows.transformerLoad}
          onWindowChange={(nextWindowSec) => updateWindow("transformerLoad", nextWindowSec)}
          isRefreshing={isRefreshing && hasCustomWindowSelection}
          focusTimestamp={focusTimestamp}
        />
      </div>
    </section>
  );
}
