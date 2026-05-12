import { useEffect, useState } from "react";

import { getTrends } from "../api";
import {
  formatTime,
  formatTrendWindowLabel,
  formatValue,
  getLiveWindowLabel,
  getTrendBounds,
  seriesPalette,
} from "../dashboard-utils";
import type { DashboardTrends, TrendSeries } from "../types";

interface TrendChartsProps {
  trends: DashboardTrends | null;
  dashboardTimestamp?: string | null;
}

type TrendMetricKey = keyof DashboardTrends;

type TrendWindowState = Record<TrendMetricKey, number>;

const DEFAULT_TREND_WINDOW_SEC = 15 * 60;
const TREND_WINDOW_OPTIONS = [5 * 60, 15 * 60, 30 * 60, 60 * 60, 3 * 60 * 60, 6 * 60 * 60];

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
  return height - paddingY - ((value - bounds.min) / Math.max(bounds.max - bounds.min, 0.0001)) * plotHeight;
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

function LineChartCard({
  title,
  unit,
  seriesCollection,
  windowSec,
  onWindowChange,
  isRefreshing,
}: {
  title: string;
  unit: string;
  seriesCollection: TrendSeries[];
  windowSec: number;
  onWindowChange: (nextWindowSec: number) => void;
  isRefreshing: boolean;
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
  const thresholdHigh = seriesCollection.find((series) => series.thresholdHigh != null)?.thresholdHigh ?? null;
  const thresholdLow = seriesCollection.find((series) => series.thresholdLow != null)?.thresholdLow ?? null;
  const startLabel = seriesCollection[0]?.points[0]?.timestamp;
  const endLabel = seriesCollection[0]?.points[seriesCollection[0]?.points.length - 1]?.timestamp;

  return (
    <article className="trend-panel">
      <div className="trend-panel-header">
        <div>
          <strong>{title}</strong>
          <p>{isRefreshing ? "Oppdaterer trendvindu..." : getLiveWindowLabel(seriesCollection)}</p>
        </div>
        <TrendWindowSelect value={windowSec} onChange={onWindowChange} />
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" role="img" aria-label={title}>
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

        {seriesCollection.map((series) => {
          const path = buildPath(series.points, bounds, domain, width, height, paddingX, paddingY);
          const latestPoint = series.points[series.points.length - 1];
          if (!path || !latestPoint) {
            return null;
          }
          const x =
            paddingX +
            ((new Date(latestPoint.timestamp).getTime() - domain.start) / Math.max(domain.end - domain.start, 1)) *
              (width - paddingX * 2);
          const y = valueToY(latestPoint.value, bounds, height, paddingY);
          return (
            <g key={series.id}>
              <path d={path} fill="none" stroke={seriesPalette[series.id] ?? "#ffffff"} strokeWidth="2.2" />
              <circle cx={x} cy={y} r="3.5" fill={seriesPalette[series.id] ?? "#ffffff"} />
            </g>
          );
        })}
      </svg>

      <div className="trend-axis">
        <span>{startLabel ? formatTime(startLabel) : "--:--"}</span>
        <span>{endLabel ? formatTime(endLabel) : "--:--"}</span>
      </div>

      <div className="trend-legend">
        {seriesCollection.map((series) => (
          <div key={series.id} className="legend-item">
            <span className="legend-swatch" style={{ background: seriesPalette[series.id] ?? "#ffffff" }} />
            <span>{series.label}</span>
            <strong>
              {formatValue(series.latestValue, unit === "%" ? 0 : 0)} {unit}
            </strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function TrendCharts({ trends, dashboardTimestamp }: TrendChartsProps) {
  const [trendWindows, setTrendWindows] = useState<TrendWindowState>({
    voltageL2: DEFAULT_TREND_WINDOW_SEC,
    currentMax: DEFAULT_TREND_WINDOW_SEC,
    transformerLoad: DEFAULT_TREND_WINDOW_SEC,
  });
  const [customTrends, setCustomTrends] = useState<DashboardTrends | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasCustomWindowSelection = Object.values(trendWindows).some(
    (windowSec) => windowSec !== DEFAULT_TREND_WINDOW_SEC,
  );

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
      voltageWindowSec: trendWindows.voltageL2,
      currentWindowSec: trendWindows.currentMax,
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
  const hasTrendPoints =
    !!activeTrends &&
    [...activeTrends.voltageL2, ...activeTrends.currentMax, ...activeTrends.transformerLoad].some(
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
          <div>
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
          <div>
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
        <div>
          <p className="panel-kicker">Trender</p>
          <h2>Historikk og live-målinger</h2>
        </div>
      </div>

      <div className="trend-layout">
        <LineChartCard
          title="Spenning L2"
          unit="V"
          seriesCollection={activeTrends.voltageL2}
          windowSec={trendWindows.voltageL2}
          onWindowChange={(nextWindowSec) => updateWindow("voltageL2", nextWindowSec)}
          isRefreshing={isRefreshing && hasCustomWindowSelection}
        />
        <LineChartCard
          title="Strøm maks"
          unit="A"
          seriesCollection={activeTrends.currentMax}
          windowSec={trendWindows.currentMax}
          onWindowChange={(nextWindowSec) => updateWindow("currentMax", nextWindowSec)}
          isRefreshing={isRefreshing && hasCustomWindowSelection}
        />
        <LineChartCard
          title="Trafolast"
          unit="%"
          seriesCollection={activeTrends.transformerLoad}
          windowSec={trendWindows.transformerLoad}
          onWindowChange={(nextWindowSec) => updateWindow("transformerLoad", nextWindowSec)}
          isRefreshing={isRefreshing && hasCustomWindowSelection}
        />
      </div>
    </section>
  );
}
