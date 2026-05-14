import { useState } from "react";
import type { ReactNode } from "react";

import {
  formatSignedValue,
  formatValue,
  getFeederStateLabel,
  getFeederStateTone,
  getPowerFactor,
  getQualityLabel,
  getStrongestAlarm,
} from "../dashboard-utils";
import type { Alarm, BreakerStatus, FeederControlInput, StationSnapshot } from "../types";

interface SingleLineDiagramProps {
  snapshot: StationSnapshot | null;
  alarms: Alarm[];
  controls: FeederControlInput[];
  selectedAssetId: string | null;
  onSelect: (assetId: string) => void;
}

type SymbolTone = "good" | "neutral" | "critical" | "high" | "medium" | "warn" | "low";
type RouteState = "energized" | "open" | "tripped";
type DiagramBox = { x: number; y: number; width: number; height: number };

const VIEWBOX_WIDTH = 1340;
const VIEWBOX_HEIGHT = 1110;
const CARD_RADIUS = 24;
const INLET_BOX: DiagramBox = { x: 22, y: 128, width: 376, height: 288 };
const TRANSFORMER_BOX: DiagramBox = { x: 942, y: 128, width: 376, height: 288 };
const BUSBAR_Y = 560;
const FEEDER_BREAKER_Y = 644;
const FEEDER_BOX_Y = 724;
const FEEDER_BOX_HEIGHT = 332;
const FEEDER_GAP = 16;
const DIAGRAM_SIDE_PADDING = 28;

function getRouteState(status: BreakerStatus): RouteState {
  return status === "closed" ? "energized" : status;
}

function getTransformerRouteState(snapshot: StationSnapshot): RouteState {
  if (snapshot.transformer.quality === "lost" || snapshot.transformer.quality === "invalid") {
    return "open";
  }
  return snapshot.transformer.secondaryVoltageV > 40 ? "energized" : "open";
}

function getRouteStateLabel(state: RouteState): string {
  switch (state) {
    case "energized":
      return "SPENNINGSATT";
    case "tripped":
      return "UTLØST";
    case "open":
    default:
      return "SPENNINGSLØS";
  }
}

function wrapText(value: string, maxChars: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [value];
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function getWrappedLineCount(value: string, width: number): number {
  const maxChars = Math.max(10, Math.floor(width / 8.4));
  return wrapText(value, maxChars).length;
}

function getToneColor(tone: SymbolTone): string {
  switch (tone) {
    case "critical":
      return "#ff6a68";
    case "high":
    case "medium":
    case "warn":
      return "#ffab4d";
    case "neutral":
      return "#8fb2cc";
    case "low":
    case "good":
    default:
      return "#8ddf57";
  }
}

function getPowerStateTone(state: RouteState, tone: SymbolTone): SymbolTone {
  if (state === "open") {
    return "neutral";
  }

  if (state === "tripped") {
    return "critical";
  }

  return tone;
}

function getRouteStyle(tone: SymbolTone, state: RouteState, selected: boolean) {
  const visualTone = getPowerStateTone(state, tone);

  if (state === "tripped") {
    return {
      color: "#ff6a68",
      opacity: 1,
      strokeWidth: selected ? 5.4 : 4.2,
    };
  }

  if (state === "open") {
    return {
      color: getToneColor(visualTone),
      opacity: selected ? 0.34 : 0.18,
      strokeWidth: selected ? 4.8 : 3.4,
    };
  }

  return {
    color: getToneColor(visualTone),
    opacity: 1,
    strokeWidth: selected ? 5.6 : 4.4,
  };
}

function getRouteDashArray(state: RouteState): string | undefined {
  if (state === "open") {
    return "14 10";
  }

  if (state === "tripped") {
    return "8 7";
  }

  return undefined;
}

function renderRouteSegment({
  x1,
  y1,
  x2,
  y2,
  tone,
  state,
  selected,
  accentWidth = 0,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone: SymbolTone;
  state: RouteState;
  selected: boolean;
  accentWidth?: number;
}) {
  const style = getRouteStyle(tone, state, selected);
  const dashArray = getRouteDashArray(state);
  const glowOpacity = state === "open" ? 0 : state === "tripped" ? 0.18 : selected ? 0.34 : 0.28;

  return (
    <g className={`diagram-route-segment state-${state} ${selected ? "selected" : ""}`}>
      <line
        className="diagram-route-base"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="rgba(145, 169, 184, 0.28)"
        strokeWidth={style.strokeWidth + 3 + accentWidth}
        strokeOpacity={selected ? 0.4 : 0.28}
        strokeLinecap="round"
      />
      {glowOpacity > 0 ? (
        <line
          className={`diagram-route-glow state-${state}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={style.color}
          strokeWidth={style.strokeWidth + 8 + accentWidth}
          strokeOpacity={glowOpacity}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          filter="url(#diagram-route-glow)"
        />
      ) : null}
      <line
        className={`diagram-route-main state-${state}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={style.color}
        strokeWidth={style.strokeWidth + accentWidth}
        strokeOpacity={style.opacity}
        strokeLinecap="round"
        strokeDasharray={dashArray}
      />
    </g>
  );
}

function renderRouteNode(
  x: number,
  y: number,
  tone: SymbolTone,
  state: RouteState,
  selected: boolean,
) {
  const style = getRouteStyle(tone, state, selected);
  const haloOpacity = state === "open" ? 0.08 : state === "tripped" ? 0.22 : 0.2;

  return (
    <g className={`diagram-route-node state-${state} ${selected ? "selected" : ""}`}>
      <circle
        className="diagram-route-node-base"
        cx={x}
        cy={y}
        r={selected ? 12.6 : 10.6}
        fill="rgba(145, 169, 184, 0.2)"
      />
      <circle
        className="diagram-route-node-halo"
        cx={x}
        cy={y}
        r={selected ? 11 : 9}
        fill={style.color}
        fillOpacity={haloOpacity}
      />
      <circle
        className="diagram-route-node-core"
        cx={x}
        cy={y}
        r={selected ? 4.8 : 4.2}
        fill={style.color}
        fillOpacity={style.opacity}
      />
    </g>
  );
}

function renderMetricPair(label: string, value: string, x: number, y: number) {
  return (
    <g key={`${label}-${x}-${y}`}>
      <text className="diagram-svg-label" x={x} y={y}>
        {label}
      </text>
      <text className="diagram-svg-value" x={x} y={y + 24}>
        {value}
      </text>
    </g>
  );
}

function renderInlineMetric(label: string, value: string, x: number, y: number) {
  return (
    <g key={`${label}-${x}-${y}`}>
      <text className="diagram-svg-inline-label" x={x} y={y}>
        {label}
      </text>
      <text className="diagram-svg-inline-value" x={x + 42} y={y}>
        {value}
      </text>
    </g>
  );
}

function renderTitleBlock(title: string, subtitle: string | null, x: number, y: number, width: number) {
  const maxChars = Math.max(10, Math.floor(width / 8.4));
  const lines = wrapText(title, maxChars);
  const dividerY = y + lines.length * 24 + 30;

  return (
    <g>
      {lines.map((line, index) => (
        <text key={`${line}-${index}`} className="diagram-svg-title" x={x} y={y + index * 24}>
          {line}
        </text>
      ))}
      {subtitle ? (
        <text className="diagram-svg-subtitle" x={x} y={y + lines.length * 24 + 18}>
          {truncateText(subtitle, 30)}
        </text>
      ) : null}
      <line className="diagram-svg-divider" x1={x} y1={dividerY} x2={x + width} y2={dividerY} />
    </g>
  );
}

function renderPill(label: string, tone: SymbolTone, x: number, y: number, width: number) {
  const displayLabel = truncateText(label, Math.max(8, Math.floor(width / 7)));
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect className={`diagram-svg-pill tone-${tone}`} width={width} height={28} rx={14} />
      <text className={`diagram-svg-pill-text tone-${tone}`} x={width / 2} y={19} textAnchor="middle">
        {displayLabel}
      </text>
    </g>
  );
}

function renderHorizontalBreaker(
  x: number,
  y: number,
  status: BreakerStatus,
  tone: SymbolTone,
  selected: boolean,
  stateOverride?: RouteState,
) {
  const routeState = stateOverride ?? getRouteState(status);
  const style = getRouteStyle(tone, routeState, selected);
  const displayStatus: BreakerStatus =
    routeState === "open" ? "open" : routeState === "tripped" ? "tripped" : status;

  return (
    <g>
      <line
        x1={x - 70}
        y1={y}
        x2={x - 12}
        y2={y}
        stroke={style.color}
        strokeWidth={style.strokeWidth}
        strokeOpacity={style.opacity}
        strokeLinecap="round"
      />
      <line
        x1={x + 12}
        y1={y}
        x2={x + 70}
        y2={y}
        stroke={style.color}
        strokeWidth={style.strokeWidth}
        strokeOpacity={style.opacity}
        strokeLinecap="round"
      />
      <circle cx={x - 12} cy={y} r={5.5} fill={style.color} fillOpacity={style.opacity} />
      <circle cx={x + 12} cy={y} r={5.5} fill={style.color} fillOpacity={style.opacity} />
      {displayStatus === "closed" ? (
        <line
          x1={x - 12}
          y1={y}
          x2={x + 12}
          y2={y}
          stroke={style.color}
          strokeWidth={style.strokeWidth}
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={x - 12}
          y1={y}
          x2={x + 8}
          y2={y - 12}
          stroke={style.color}
          strokeWidth={style.strokeWidth}
          strokeLinecap="round"
        />
      )}
      {displayStatus === "tripped" ? (
        <path d={`M ${x + 24} ${y - 22} l -10 16 h 9 l -7 15 l 20 -21 h -9 l 8 -10 z`} className="diagram-svg-trip" />
      ) : null}
    </g>
  );
}

function renderVerticalBreaker(
  x: number,
  y: number,
  status: BreakerStatus,
  tone: SymbolTone,
  selected: boolean,
  stateOverride?: RouteState,
) {
  const routeState = stateOverride ?? getRouteState(status);
  const style = getRouteStyle(tone, routeState, selected);
  const displayStatus: BreakerStatus =
    routeState === "open" ? "open" : routeState === "tripped" ? "tripped" : status;
  const capLength = 20;
  const capStroke =
    routeState === "tripped"
      ? "rgba(255, 182, 182, 0.92)"
      : routeState === "open"
        ? "rgba(171, 184, 194, 0.72)"
        : "rgba(216, 229, 238, 0.82)";

  return (
    <g>
      <line
        x1={x}
        y1={y - 58}
        x2={x}
        y2={y - 12}
        stroke={style.color}
        strokeWidth={style.strokeWidth}
        strokeOpacity={style.opacity}
        strokeLinecap="round"
      />
      <line
        x1={x}
        y1={y + 12}
        x2={x}
        y2={y + 58}
        stroke={style.color}
        strokeWidth={style.strokeWidth}
        strokeOpacity={style.opacity}
        strokeLinecap="round"
      />
      <circle cx={x} cy={y - 12} r={5.5} fill={style.color} fillOpacity={style.opacity} />
      <circle cx={x} cy={y + 12} r={5.5} fill={style.color} fillOpacity={style.opacity} />
      {displayStatus === "closed" ? (
        <line
          x1={x}
          y1={y - 12}
          x2={x}
          y2={y + 12}
          stroke={style.color}
          strokeWidth={style.strokeWidth}
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={x}
          y1={y - 12}
          x2={x + 12}
          y2={y + 4}
          stroke={style.color}
          strokeWidth={style.strokeWidth}
          strokeLinecap="round"
        />
      )}
      <line
        x1={x - capLength / 2}
        y1={y - 58}
        x2={x + capLength / 2}
        y2={y - 58}
        stroke={capStroke}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={x - capLength / 2}
        y1={y + 58}
        x2={x + capLength / 2}
        y2={y + 58}
        stroke={capStroke}
        strokeWidth={4}
        strokeLinecap="round"
      />
      {displayStatus === "tripped" ? (
        <path d={`M ${x + 20} ${y - 42} l -10 16 h 9 l -7 15 l 20 -21 h -9 l 8 -10 z`} className="diagram-svg-trip" />
      ) : null}
    </g>
  );
}

function renderTransformerGlyph(x: number, y: number) {
  return (
    <g transform={`translate(${x}, ${y})`} className="diagram-svg-transformer-icon">
      <circle cx={0} cy={0} r={16} />
      <circle cx={24} cy={0} r={16} />
      <circle cx={12} cy={18} r={16} />
    </g>
  );
}

function renderInlineSelector(
  {
    x,
    y,
    width,
    height,
    selected,
    onClick,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    selected: boolean;
    onClick: () => void;
  },
  content: ReactNode,
) {
  return (
    <g
      className={`diagram-inline-selector ${selected ? "selected" : ""}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {content}
      <rect className="diagram-node-hit" x={x} y={y} width={width} height={height} rx={14} ry={14} />
    </g>
  );
}

function renderNodeBox(
  {
    box,
    title,
    subtitle,
    tone,
    selected,
    onClick,
    powerState,
    titleInsetX = 18,
    titleInsetY = 56,
    titleWidth = box.width - titleInsetX - 18,
  }: {
    box: DiagramBox;
    title: string;
    subtitle: string | null;
    tone: SymbolTone;
    selected: boolean;
    onClick: () => void;
    powerState: RouteState;
    titleInsetX?: number;
    titleInsetY?: number;
    titleWidth?: number;
  },
  content: ReactNode,
  footer: ReactNode,
) {
  const visualTone = getPowerStateTone(powerState, tone);

  return (
    <g
      className={`diagram-node-group ${selected ? "selected" : ""} power-${powerState}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      >
        <rect
        className={`diagram-svg-box ${selected ? "selected" : ""} tone-${visualTone} power-${powerState}`}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={CARD_RADIUS}
        ry={CARD_RADIUS}
      />
      <rect
        className={`diagram-svg-state-surface power-${powerState}`}
        x={box.x + 12}
        y={box.y + 12}
        width={box.width - 24}
        height={Math.min(92, box.height - 24)}
        rx={CARD_RADIUS - 8}
        ry={CARD_RADIUS - 8}
      />
      <rect
        className={`diagram-svg-state-rail power-${powerState}`}
        x={box.x + 10}
        y={box.y + 14}
        width={6}
        height={box.height - 28}
        rx={3}
        ry={3}
      />
      <rect
        className={`diagram-svg-box-veil power-${powerState}`}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={CARD_RADIUS}
        ry={CARD_RADIUS}
      />
      {renderTitleBlock(title, subtitle, box.x + titleInsetX, box.y + titleInsetY, titleWidth)}
      <g className={`diagram-svg-body power-${powerState}`}>{content}</g>
      {footer}
      <rect
        className="diagram-node-hit"
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={CARD_RADIUS}
        ry={CARD_RADIUS}
      />
    </g>
  );
}

function renderLegendGlyph(status: BreakerStatus, tone: SymbolTone) {
  return (
    <svg viewBox="0 0 120 32" className="diagram-legend-glyph" aria-hidden="true">
      <line x1="4" y1="16" x2="48" y2="16" stroke={getToneColor(tone)} strokeWidth={3.5} strokeLinecap="round" />
      <line x1="72" y1="16" x2="116" y2="16" stroke={getToneColor(tone)} strokeWidth={3.5} strokeOpacity={status === "open" ? 0.26 : 1} strokeLinecap="round" />
      <circle cx="52" cy="16" r="3.5" fill={getToneColor(tone)} />
      <circle cx="68" cy="16" r="3.5" fill={getToneColor(tone)} />
      {status === "closed" ? (
        <line x1="52" y1="16" x2="68" y2="16" stroke={getToneColor(tone)} strokeWidth={3.5} strokeLinecap="round" />
      ) : (
        <line x1="52" y1="16" x2="66" y2="8" stroke={getToneColor(tone)} strokeWidth={3.5} strokeLinecap="round" />
      )}
      {status === "tripped" ? (
        <path d="M84 6L76 18H84L78 28L96 13H87L94 6Z" fill="#ff6a68" />
      ) : null}
    </svg>
  );
}

function DiagramLegendItem({
  label,
  tone,
  status,
}: {
  label: string;
  tone: SymbolTone;
  status: BreakerStatus;
}) {
  return (
    <div className="diagram-legend-item">
      {renderLegendGlyph(status, tone)}
      <span>{label}</span>
    </div>
  );
}

export function SingleLineDiagram({
  snapshot,
  alarms,
  controls,
  selectedAssetId,
  onSelect,
}: SingleLineDiagramProps) {
  const [showNames, setShowNames] = useState(true);
  const [showValues, setShowValues] = useState(true);
  const [autoLayout, setAutoLayout] = useState(true);

  if (!snapshot) {
    return (
      <section className="panel scada-panel panel-diagram">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Enlinjeskjema</p>
            <h2>Stasjonsoversikt</h2>
          </div>
        </div>
        <div className="empty-panel">
          <p>Venter på telemetri...</p>
          <span>Diagrammet fylles når backend strømmer snapshots.</span>
        </div>
      </section>
    );
  }

  const displayFeeders = snapshot.feeders.map((feeder) => {
    const control = controls.find((item) => item.id === feeder.id);
    return {
      ...feeder,
      quality: control?.communicationState ?? feeder.quality,
    };
  });

  const transformerAlarm = getStrongestAlarm(alarms, snapshot.transformer.id);
  const estimatedInletKv = (snapshot.transformer.secondaryVoltageV / 400) * 22;
  const apparentPowerMva = snapshot.transformer.apparentPowerKva / 1000;
  const reactiveMvar =
    Math.sqrt(Math.max(snapshot.transformer.apparentPowerKva ** 2 - snapshot.transformer.activePowerKw ** 2, 0)) / 1000;
  const stationBreakerStatus = new Map(
    (snapshot.stationBreakers ?? []).map((breaker) => [breaker.id, breaker.breakerStatus]),
  );
  const inletBreakerStatus = stationBreakerStatus.get("BRK-IN") ?? "closed";
  const lvBreakerStatus = stationBreakerStatus.get("LV-BRK") ?? "closed";
  const supplyTone: SymbolTone = snapshot.transformer.quality === "good" ? "good" : "neutral";
  const supplyRouteState = getRouteState(inletBreakerStatus);
  const transformerRouteState =
    supplyRouteState === "energized" ? getTransformerRouteState(snapshot) : supplyRouteState;
  const busRouteState =
    transformerRouteState === "energized" ? getRouteState(lvBreakerStatus) : transformerRouteState;
  const busStateTone: SymbolTone =
    busRouteState === "energized" ? supplyTone : busRouteState === "tripped" ? "critical" : "neutral";
  const hasSelectedFeeder = displayFeeders.some((feeder) => feeder.id === selectedAssetId);
  const inletSelected = selectedAssetId === "BRK-IN";
  const transformerSelected = selectedAssetId === "T1";
  const lvBreakerSelected = selectedAssetId === "LV-BRK";
  const selectedFeederId = hasSelectedFeeder ? selectedAssetId : null;
  const selectsSupplyPath = inletSelected || transformerSelected || lvBreakerSelected || hasSelectedFeeder;
  const selectsTransformerPath = transformerSelected || lvBreakerSelected || hasSelectedFeeder;
  const selectsBusPath = lvBreakerSelected || hasSelectedFeeder;
  const busEnergized = busRouteState === "energized";
  const feederCount = Math.max(displayFeeders.length, 1);
  const feederBoxWidth = Math.min(
    250,
    Math.max(
      198,
      Math.floor(
        (VIEWBOX_WIDTH - DIAGRAM_SIDE_PADDING * 2 - FEEDER_GAP * (feederCount - 1)) / feederCount,
      ),
    ),
  );
  const feederRowWidth = feederCount * feederBoxWidth + FEEDER_GAP * (feederCount - 1);
  const feederRowStartX = Math.round((VIEWBOX_WIDTH - feederRowWidth) / 2);
  const feederBoxX = Array.from(
    { length: feederCount },
    (_, index) => feederRowStartX + index * (feederBoxWidth + FEEDER_GAP),
  );
  const feederCenters = feederBoxX.map((x) => x + feederBoxWidth / 2);
  const transformerCenterX = TRANSFORMER_BOX.x + TRANSFORMER_BOX.width / 2;
  const supplyLineY = INLET_BOX.y + 120;
  const supplyBreakerX = Math.round((INLET_BOX.x + INLET_BOX.width + TRANSFORMER_BOX.x) / 2);
  const transformerFeedBreakerY = 474;

  return (
    <section className="panel scada-panel panel-diagram">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Enlinjeskjema</p>
          <h2>{snapshot.stationId}</h2>
        </div>
        <div className="diagram-toolbar">
          <label className="toggle-pill">
            <input type="checkbox" checked={autoLayout} onChange={() => setAutoLayout((current) => !current)} />
            <span>Auto layout</span>
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={showNames} onChange={() => setShowNames((current) => !current)} />
            <span>Vis navn</span>
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={showValues} onChange={() => setShowValues((current) => !current)} />
            <span>Vis verdier</span>
          </label>
        </div>
      </div>

      <div className="diagram-legend" aria-label="Symbolforklaring">
        <DiagramLegendItem label="Lukket bryter" tone="good" status="closed" />
        <DiagramLegendItem label="Åpen bryter" tone="neutral" status="open" />
        <DiagramLegendItem label="Utløst bryter" tone="critical" status="tripped" />
      </div>

      <div className={`svg-diagram-frame ${autoLayout ? "auto-layout" : "manual-layout"}`}>
        <svg
          className="svg-diagram-canvas"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label={`Enlinjeskjema for ${snapshot.stationId}`}
        >
          <defs>
            <filter id="diagram-route-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect x={0} y={0} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} className="diagram-svg-backdrop" rx={28} />

          <g className="diagram-svg-grid">
            {Array.from({ length: 9 }).map((_, index) => (
              <line
                key={`v-${index}`}
                x1={index * 145 + 30}
                y1={20}
                x2={index * 145 + 30}
                y2={VIEWBOX_HEIGHT - 34}
              />
            ))}
            {Array.from({ length: 8 }).map((_, index) => (
              <line
                key={`h-${index}`}
                x1={20}
                y1={index * 110 + 30}
                x2={VIEWBOX_WIDTH - 20}
                y2={index * 110 + 30}
              />
            ))}
          </g>

          <rect
            className={`diagram-state-zone power-${supplyRouteState}`}
            x={INLET_BOX.x + INLET_BOX.width - 18}
            y={supplyLineY - 30}
            width={TRANSFORMER_BOX.x - (INLET_BOX.x + INLET_BOX.width) + 36}
            height={60}
            rx={24}
            ry={24}
          />
          <rect
            className={`diagram-state-zone power-${transformerRouteState}`}
            x={transformerCenterX - 46}
            y={TRANSFORMER_BOX.y + TRANSFORMER_BOX.height - 6}
            width={92}
            height={BUSBAR_Y - (TRANSFORMER_BOX.y + TRANSFORMER_BOX.height) + 58}
            rx={26}
            ry={26}
          />
          <rect
            className={`diagram-state-zone power-${busRouteState}`}
            x={DIAGRAM_SIDE_PADDING - 8}
            y={BUSBAR_Y - 26}
            width={VIEWBOX_WIDTH - DIAGRAM_SIDE_PADDING * 2 + 16}
            height={48}
            rx={20}
            ry={20}
          />
          <rect
            className={`diagram-state-zone downstream-zone power-${busRouteState}`}
            x={feederRowStartX - 18}
            y={BUSBAR_Y + 18}
            width={feederRowWidth + 36}
            height={FEEDER_BOX_Y + FEEDER_BOX_HEIGHT - (BUSBAR_Y + 18)}
            rx={30}
            ry={30}
          />

          <g className="diagram-svg-route">
            {renderRouteSegment({
              x1: INLET_BOX.x + INLET_BOX.width,
              y1: supplyLineY,
              x2: supplyBreakerX - 70,
              y2: supplyLineY,
              tone: supplyTone,
              state: supplyRouteState,
              selected: selectsSupplyPath,
            })}
            {renderRouteSegment({
              x1: supplyBreakerX + 70,
              y1: supplyLineY,
              x2: TRANSFORMER_BOX.x,
              y2: supplyLineY,
              tone: supplyTone,
              state: supplyRouteState,
              selected: selectsSupplyPath,
            })}
            {renderInlineSelector(
              {
                x: supplyBreakerX - 76,
                y: supplyLineY - 46,
                width: 152,
                height: 86,
                selected: inletSelected,
                onClick: () => onSelect("BRK-IN"),
              },
              <>
                <text className="diagram-svg-annotation" x={supplyBreakerX} y={supplyLineY - 30} textAnchor="middle">
                  BRK-IN
                </text>
                {renderHorizontalBreaker(supplyBreakerX, supplyLineY, inletBreakerStatus, supplyTone, inletSelected)}
              </>,
            )}
            {renderRouteNode(INLET_BOX.x + INLET_BOX.width, supplyLineY, supplyTone, supplyRouteState, selectsSupplyPath)}
            {renderRouteNode(TRANSFORMER_BOX.x, supplyLineY, supplyTone, supplyRouteState, selectsSupplyPath)}

            {renderRouteSegment({
              x1: transformerCenterX,
              y1: TRANSFORMER_BOX.y + TRANSFORMER_BOX.height,
              x2: transformerCenterX,
              y2: transformerFeedBreakerY - 58,
              tone: supplyTone,
              state: transformerRouteState,
              selected: selectsTransformerPath,
            })}
            {renderRouteSegment({
              x1: transformerCenterX,
              y1: transformerFeedBreakerY + 58,
              x2: transformerCenterX,
              y2: BUSBAR_Y,
              tone: supplyTone,
              state: busRouteState,
              selected: selectsBusPath || transformerSelected,
            })}
            {renderInlineSelector(
              {
                x: transformerCenterX - 36,
                y: transformerFeedBreakerY - 70,
                width: 122,
                height: 146,
                selected: lvBreakerSelected,
                onClick: () => onSelect("LV-BRK"),
              },
              <>
                {renderVerticalBreaker(
                  transformerCenterX,
                  transformerFeedBreakerY,
                  lvBreakerStatus,
                  supplyTone,
                  lvBreakerSelected,
                  busRouteState,
                )}
                <text
                  className="diagram-svg-annotation"
                  x={transformerCenterX + 28}
                  y={transformerFeedBreakerY + 6}
                  textAnchor="start"
                >
                  LV-BRK
                </text>
              </>,
            )}
            {renderRouteNode(
              transformerCenterX,
              TRANSFORMER_BOX.y + TRANSFORMER_BOX.height,
              supplyTone,
              transformerRouteState,
              selectsTransformerPath,
            )}
            {renderRouteNode(transformerCenterX, BUSBAR_Y, supplyTone, busRouteState, selectsBusPath)}

            <text className="diagram-svg-annotation-large" x={DIAGRAM_SIDE_PADDING} y={BUSBAR_Y - 18}>
              0.4 kV samleskinne
            </text>
            <text className="diagram-svg-annotation" x={VIEWBOX_WIDTH - 120} y={BUSBAR_Y - 44} textAnchor="middle">
              BUS-01
            </text>
            {renderPill(getRouteStateLabel(busRouteState), busStateTone, VIEWBOX_WIDTH - 194, BUSBAR_Y - 28, 136)}
            {renderRouteSegment({
              x1: DIAGRAM_SIDE_PADDING,
              y1: BUSBAR_Y,
              x2: VIEWBOX_WIDTH - DIAGRAM_SIDE_PADDING,
              y2: BUSBAR_Y,
              tone: supplyTone,
              state: busRouteState,
              selected: selectsBusPath,
              accentWidth: 1,
            })}
            {renderRouteSegment({
              x1: DIAGRAM_SIDE_PADDING,
              y1: BUSBAR_Y + 8,
              x2: VIEWBOX_WIDTH - DIAGRAM_SIDE_PADDING,
              y2: BUSBAR_Y + 8,
              tone: supplyTone,
              state: busRouteState,
              selected: selectsBusPath,
            })}

            {displayFeeders.map((feeder, index) => {
              const feederAlarm = getStrongestAlarm(alarms, feeder.id);
              const tone = getFeederStateTone(feeder, feederAlarm) as SymbolTone;
              const upperState: RouteState = busRouteState;
              const lowerState: RouteState = busEnergized ? getRouteState(feeder.breakerStatus) : busRouteState;
              const centerX = feederCenters[index];

              return (
                <g key={`branch-${feeder.id}`}>
                  {renderRouteSegment({
                    x1: centerX,
                    y1: BUSBAR_Y + 8,
                    x2: centerX,
                    y2: FEEDER_BREAKER_Y - 58,
                    tone: supplyTone,
                    state: upperState,
                    selected: selectedAssetId === feeder.id,
                  })}
                  {renderVerticalBreaker(
                    centerX,
                    FEEDER_BREAKER_Y,
                    feeder.breakerStatus,
                    tone,
                    selectedAssetId === feeder.id,
                    lowerState,
                  )}
                  {renderRouteSegment({
                    x1: centerX,
                    y1: FEEDER_BREAKER_Y + 58,
                    x2: centerX,
                    y2: FEEDER_BOX_Y,
                    tone,
                    state: lowerState,
                    selected: selectedAssetId === feeder.id,
                  })}
                  {renderRouteNode(centerX, BUSBAR_Y + 8, supplyTone, upperState, selectedAssetId === feeder.id)}
                  {renderRouteNode(centerX, FEEDER_BOX_Y, tone, lowerState, selectedAssetId === feeder.id)}
                </g>
              );
            })}
          </g>

          {renderNodeBox(
            {
              box: INLET_BOX,
              title: "NETTINNTAK",
              subtitle: null,
              tone: getPowerStateTone(supplyRouteState, supplyTone),
              selected: inletSelected,
              onClick: () => onSelect("BRK-IN"),
              powerState: supplyRouteState,
            },
            <>
              {renderMetricPair("U L1-L2", `${formatValue(estimatedInletKv, 1)} kV`, INLET_BOX.x + 20, INLET_BOX.y + 102)}
              {renderMetricPair("P", `${formatValue(snapshot.transformer.activePowerKw / 1000, 2)} MW`, INLET_BOX.x + 178, INLET_BOX.y + 102)}
              {renderMetricPair("Q", `${formatValue(reactiveMvar, 2)} MVAr`, INLET_BOX.x + 20, INLET_BOX.y + 166)}
              {renderMetricPair("F", "50.00 Hz", INLET_BOX.x + 178, INLET_BOX.y + 166)}
              {renderMetricPair(
                "PF",
                formatValue(getPowerFactor(snapshot.transformer.activePowerKw, snapshot.transformer.apparentPowerKva), 2),
                INLET_BOX.x + 20,
                INLET_BOX.y + 230,
              )}
            </>,
            <>
              {renderPill(
                getRouteStateLabel(supplyRouteState),
                getPowerStateTone(supplyRouteState, supplyTone),
                INLET_BOX.x + INLET_BOX.width - 138,
                INLET_BOX.y + 18,
                120,
              )}
              <text className="diagram-svg-footer tone-good" x={INLET_BOX.x + 20} y={INLET_BOX.y + INLET_BOX.height - 22}>
                Innmating stabil
              </text>
            </>,
          )}

          {renderNodeBox(
            {
              box: TRANSFORMER_BOX,
              title: "T1 22/0.4 kV",
              subtitle: null,
              tone: getPowerStateTone(transformerRouteState, (transformerAlarm?.severity ?? "good") as SymbolTone),
                selected: transformerSelected,
                onClick: () => onSelect("T1"),
                powerState: transformerRouteState,
                titleInsetX: 118,
                titleInsetY: 58,
              },
            <>
              {renderTransformerGlyph(TRANSFORMER_BOX.x + 34, TRANSFORMER_BOX.y + 42)}
              {renderMetricPair("Last", `${formatValue(snapshot.transformer.loadPercent, 0)} %`, TRANSFORMER_BOX.x + 26, TRANSFORMER_BOX.y + 102)}
              {renderMetricPair("P", `${formatValue(snapshot.transformer.activePowerKw, 0)} kW`, TRANSFORMER_BOX.x + 202, TRANSFORMER_BOX.y + 102)}
              {renderMetricPair("S", `${formatValue(apparentPowerMva, 2)} MVA`, TRANSFORMER_BOX.x + 26, TRANSFORMER_BOX.y + 166)}
              {renderMetricPair("U L1-L2", `${formatValue(snapshot.transformer.secondaryVoltageV, 0)} V`, TRANSFORMER_BOX.x + 202, TRANSFORMER_BOX.y + 166)}
              {renderMetricPair("Temp. olje", `${formatValue(snapshot.transformer.topOilTempC, 0)} C`, TRANSFORMER_BOX.x + 26, TRANSFORMER_BOX.y + 230)}
              {renderMetricPair("Kvalitet", getQualityLabel(snapshot.transformer.quality), TRANSFORMER_BOX.x + 202, TRANSFORMER_BOX.y + 230)}
            </>,
            <>
              {renderPill(
                getRouteStateLabel(transformerRouteState),
                getPowerStateTone(transformerRouteState, supplyTone),
                transformerAlarm ? TRANSFORMER_BOX.x + TRANSFORMER_BOX.width - 272 : TRANSFORMER_BOX.x + TRANSFORMER_BOX.width - 136,
                TRANSFORMER_BOX.y + 18,
                transformerAlarm ? 112 : 118,
              )}
              {transformerAlarm
                ? renderPill(
                    transformerAlarm.title,
                    transformerAlarm.severity as SymbolTone,
                    TRANSFORMER_BOX.x + TRANSFORMER_BOX.width - 150,
                    TRANSFORMER_BOX.y + 18,
                    132,
                  )
                : <></>}
            </>,
          )}

          {displayFeeders.map((feeder, index) => {
            const feederAlarm = getStrongestAlarm(alarms, feeder.id);
            const tone = getFeederStateTone(feeder, feederAlarm) as SymbolTone;
            const localRouteState = getRouteState(feeder.breakerStatus);
            const box: DiagramBox = {
              x: feederBoxX[index],
              y: FEEDER_BOX_Y,
              width: feederBoxWidth,
              height: FEEDER_BOX_HEIGHT,
            };
            const title = showNames ? `${feeder.id} - ${feeder.name}` : feeder.id;
            const subtitle = showValues
              ? null
              : `${formatSignedValue(feeder.activePowerKw)} kW | ${formatValue(feeder.derived.utilizationPercent, 0)} %`;
            const isDimmed = selectedFeederId !== null && selectedFeederId !== feeder.id;
            const powerState = busEnergized ? localRouteState : "open";
            const visualTone = getPowerStateTone(powerState, tone);
            const stateLabel = powerState === "open" ? "SPENNINGSLØS" : getFeederStateLabel(feeder, feederAlarm);
            const footerText =
              powerState === "open" ? "Frakoblet oppstrøms" : feederAlarm ? feederAlarm.title : "Normal drift";
            const customerMetricLabel =
              feeder.customers === 0 && (feeder.nominalGenerationEquivalentHomes ?? 0) > 0 ? "Boliger" : "Kunder";
            const customerMetricValue =
              feeder.customers === 0 && (feeder.nominalGenerationEquivalentHomes ?? 0) > 0
                ? formatValue(feeder.generationEquivalentHomes ?? 0)
                : formatValue(feeder.customers);
            const titleWidth = Math.max(148, box.width - 36);
            const titleLineCount = getWrappedLineCount(title, titleWidth);
            const metricStartY = box.y + 124 + titleLineCount * 24;

            return (
              <g
                key={feeder.id}
                className={`diagram-feeder-group ${selectedAssetId === feeder.id ? "selected" : ""} ${isDimmed ? "dimmed" : ""}`}
              >
                {renderNodeBox(
                  {
                    box,
                    title,
                    subtitle,
                    tone,
                    selected: selectedAssetId === feeder.id,
                    onClick: () => onSelect(feeder.id),
                    powerState,
                    titleInsetY: 72,
                    titleWidth,
                  },
                  showValues ? (
                    <>
                      {renderInlineMetric("P", `${formatSignedValue(feeder.activePowerKw)} kW`, box.x + 18, metricStartY)}
                      {renderInlineMetric("Q", `${formatSignedValue(feeder.reactivePowerKvar)} kVAr`, box.x + 132, metricStartY)}
                      {renderInlineMetric("IL1", `${formatValue(feeder.current.l1, 0)} A`, box.x + 18, metricStartY + 32)}
                      {renderInlineMetric("IL2", `${formatValue(feeder.current.l2, 0)} A`, box.x + 132, metricStartY + 32)}
                      {renderInlineMetric("IL3", `${formatValue(feeder.current.l3, 0)} A`, box.x + 18, metricStartY + 64)}
                      {renderInlineMetric("UL1", `${formatValue(feeder.voltage.l1, 0)} V`, box.x + 132, metricStartY + 64)}
                      {renderInlineMetric("UL2", `${formatValue(feeder.voltage.l2, 0)} V`, box.x + 18, metricStartY + 96)}
                      {renderInlineMetric("UL3", `${formatValue(feeder.voltage.l3, 0)} V`, box.x + 132, metricStartY + 96)}
                      {renderInlineMetric(customerMetricLabel, customerMetricValue, box.x + 18, metricStartY + 128)}
                    </>
                  ) : (
                    <>
                      {renderInlineMetric("Last", `${formatValue(feeder.derived.utilizationPercent, 0)} %`, box.x + 18, box.y + 144)}
                      {renderInlineMetric("Status", stateLabel, box.x + 18, box.y + 176)}
                    </>
                  ),
                  <>
                    {renderPill(
                      getRouteStateLabel(powerState),
                      getPowerStateTone(powerState, "good"),
                      box.x + 18,
                      box.y + 18,
                      92,
                    )}
                    {renderPill(stateLabel, visualTone, box.x + box.width - 82, box.y + 18, 64)}
                    <text className={`diagram-svg-footer tone-${visualTone}`} x={box.x + 18} y={box.y + box.height - 24}>
                      {truncateText(footerText, 30)}
                    </text>
                  </>,
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
