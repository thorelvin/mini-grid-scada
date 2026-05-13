import type { BreakerStatus, FeederTelemetry, StationSnapshot, StationTopology } from "./types";

export interface TopologyImpactSummary {
  assetId: string;
  pathIds: string[];
  downstreamFeederIds: string[];
  totalCustomers: number;
  criticalCustomers: number;
  disconnectedCustomers: number;
  energizedFeederCount: number;
  deenergizedFeederCount: number;
  upstreamSupplyAvailable: boolean;
}

export interface CommandPreviewSummary {
  title: string;
  tone: "good" | "warn" | "neutral";
  headline: string;
  detail: string;
  customers: number;
  criticalCustomers: number;
}

function buildChildrenMap(topology: StationTopology): Map<string, string[]> {
  const childrenMap = new Map<string, string[]>();
  for (const edge of topology.edges) {
    const existing = childrenMap.get(edge.sourceId) ?? [];
    existing.push(edge.targetId);
    childrenMap.set(edge.sourceId, existing);
  }
  return childrenMap;
}

function buildParentMap(topology: StationTopology): Map<string, string> {
  const parentMap = new Map<string, string>();
  for (const edge of topology.edges) {
    parentMap.set(edge.targetId, edge.sourceId);
  }
  return parentMap;
}

function collectDescendants(childrenMap: Map<string, string[]>, startId: string): string[] {
  const collected: string[] = [];
  const queue = [...(childrenMap.get(startId) ?? [])];
  while (queue.length) {
    const nextId = queue.shift();
    if (!nextId || collected.includes(nextId)) {
      continue;
    }
    collected.push(nextId);
    queue.push(...(childrenMap.get(nextId) ?? []));
  }
  return collected;
}

function feederMap(snapshot: StationSnapshot): Map<string, FeederTelemetry> {
  return new Map(snapshot.feeders.map((feeder) => [feeder.id, feeder]));
}

function stationBreakerStatus(snapshot: StationSnapshot, breakerId: "BRK-IN" | "LV-BRK"): BreakerStatus {
  return (snapshot.stationBreakers ?? []).find((breaker) => breaker.id === breakerId)?.breakerStatus ?? "closed";
}

function isTransformerEnergized(snapshot: StationSnapshot): boolean {
  return (
    stationBreakerStatus(snapshot, "BRK-IN") === "closed" &&
    snapshot.transformer.quality === "good" &&
    snapshot.transformer.secondaryVoltageV > 40
  );
}

function isBusSupplyAvailable(snapshot: StationSnapshot): boolean {
  return isTransformerEnergized(snapshot) && stationBreakerStatus(snapshot, "LV-BRK") === "closed";
}

function isUpstreamSupplyAvailable(snapshot: StationSnapshot, assetId: string): boolean {
  if (assetId === "BRK-IN") {
    return true;
  }

  if (assetId === "T1" || assetId === "LV-BRK") {
    return stationBreakerStatus(snapshot, "BRK-IN") === "closed";
  }

  if (assetId === "BUS-01") {
    return isTransformerEnergized(snapshot);
  }

  return isBusSupplyAvailable(snapshot);
}

function isFeederEnergized(snapshot: StationSnapshot, feeder: FeederTelemetry): boolean {
  return isBusSupplyAvailable(snapshot) && feeder.breakerStatus === "closed";
}

export function getTopologyImpactSummary(
  topology: StationTopology | null,
  snapshot: StationSnapshot,
  assetId: string,
): TopologyImpactSummary | null {
  if (!topology) {
    return null;
  }

  const childrenMap = buildChildrenMap(topology);
  const parentMap = buildParentMap(topology);
  const feederById = feederMap(snapshot);

  const pathIds: string[] = [];
  let cursor: string | undefined = assetId;
  while (cursor) {
    pathIds.unshift(cursor);
    cursor = parentMap.get(cursor);
  }

  const descendants = collectDescendants(childrenMap, assetId);
  const downstreamFeederIds = descendants.filter((id) => feederById.has(id));
  if (feederById.has(assetId) && !downstreamFeederIds.includes(assetId)) {
    downstreamFeederIds.push(assetId);
  }

  const downstreamFeeders = downstreamFeederIds
    .map((feederId) => feederById.get(feederId))
    .filter((feeder): feeder is FeederTelemetry => Boolean(feeder));

  const totalCustomers = downstreamFeeders.reduce((sum, feeder) => sum + feeder.customers, 0);
  const criticalCustomers = downstreamFeeders.reduce((sum, feeder) => sum + feeder.criticalCustomers, 0);
  const disconnectedCustomers = downstreamFeeders.reduce(
    (sum, feeder) => sum + (isFeederEnergized(snapshot, feeder) ? 0 : feeder.customers),
    0,
  );
  const energizedFeederCount = downstreamFeeders.filter((feeder) => isFeederEnergized(snapshot, feeder)).length;
  const deenergizedFeederCount = downstreamFeeders.length - energizedFeederCount;

  return {
    assetId,
    pathIds,
    downstreamFeederIds,
    totalCustomers,
    criticalCustomers,
    disconnectedCustomers,
    energizedFeederCount,
    deenergizedFeederCount,
    upstreamSupplyAvailable: isUpstreamSupplyAvailable(snapshot, assetId),
  };
}

export function getFeederCommandPreviews(
  feeder: FeederTelemetry,
  snapshot: StationSnapshot,
): { open: CommandPreviewSummary; close: CommandPreviewSummary } {
  const supplyAvailable = isBusSupplyAvailable(snapshot);
  const openCustomers = feeder.breakerStatus === "closed" ? feeder.customers : 0;
  const openCriticalCustomers = feeder.breakerStatus === "closed" ? feeder.criticalCustomers : 0;
  const canRestoreCustomers = feeder.breakerStatus === "closed" ? 0 : feeder.customers;
  const canRestoreCriticalCustomers = feeder.breakerStatus === "closed" ? 0 : feeder.criticalCustomers;

  const open: CommandPreviewSummary = {
    title: "Ved utkobling",
    tone: openCustomers > 0 ? "warn" : "neutral",
    headline:
      openCustomers > 0 ? `${openCustomers} kunder mister forsyning` : "Ingen nye kunder kobles ut",
    detail:
      openCustomers > 0
        ? `${openCriticalCustomers} kritiske kunder ligger pa denne grenen.`
        : "Bryteren er allerede ute eller utlost.",
    customers: openCustomers,
    criticalCustomers: openCriticalCustomers,
  };

  let closeHeadline = "Feederen er allerede innkoblet";
  let closeDetail = "Ingen ekstra kunder vil fa endret status.";
  if (canRestoreCustomers > 0) {
    closeHeadline = supplyAvailable
      ? `${canRestoreCustomers} kunder kan fa forsyning tilbake`
      : "Oppstroms forsyning er ikke tilgjengelig";
    closeDetail = supplyAvailable
      ? `${canRestoreCriticalCustomers} kritiske kunder kan gjeninnkobles hvis interlocks er oppfylt.`
      : "Lukking alene gjenoppretter ikke last hvis trafo/bus ikke er spenningssatt.";
  }

  const close: CommandPreviewSummary = {
    title: "Ved innkobling",
    tone: canRestoreCustomers > 0 && supplyAvailable ? "good" : "neutral",
    headline: closeHeadline,
    detail: closeDetail,
    customers: canRestoreCustomers,
    criticalCustomers: canRestoreCriticalCustomers,
  };

  return { open, close };
}

export function getBreakerOutcomeLabel(status: BreakerStatus): string {
  if (status === "closed") {
    return "Spenningssatt";
  }
  if (status === "open") {
    return "Utkoblet";
  }
  return "Utlost";
}
