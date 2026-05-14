import type { Alarm, BreakerStatus, FeederControlInput, FeederTelemetry, StationSnapshot, StationTopology } from "./types";

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

export interface StationBranchPreviewItem {
  feederId: string;
  label: string;
  action: "drop" | "restore" | "hold" | "blocked" | "already_live" | "already_out";
  tone: "good" | "warn" | "neutral";
  detail: string;
  customers: number;
  criticalCustomers: number;
}

export interface StationRestoreAssessment {
  breakerId: "BRK-IN" | "LV-BRK";
  readyToClose: boolean;
  wouldEnergizeBus: boolean;
  blockingReasons: string[];
  advisoryNotes: string[];
  restoreSteps: string[];
  nextAction: string;
  openImpact: CommandPreviewSummary;
  closeImpact: CommandPreviewSummary;
  openBranchPreview: StationBranchPreviewItem[];
  closeBranchPreview: StationBranchPreviewItem[];
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

function controlMap(controls: FeederControlInput[]): Map<string, FeederControlInput> {
  return new Map(controls.map((control) => [control.id, control]));
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

function isDegradedCommunication(control: FeederControlInput): boolean {
  return (
    control.communicationState === "stale" ||
    control.communicationState === "invalid" ||
    control.communicationState === "lost"
  );
}

function isGenerationSupportFeeder(feeder: FeederTelemetry): boolean {
  return feeder.customers === 0 && (feeder.nominalGenerationEquivalentHomes ?? 0) > 0;
}

function describeBranchScope(feeder: FeederTelemetry): string {
  if (isGenerationSupportFeeder(feeder)) {
    return `local production support for ca. ${feeder.generationEquivalentHomes ?? 0} homes`;
  }

  return `${feeder.customers} customers, ${feeder.criticalCustomers} critical`;
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
  const generationEquivalentHomes = feeder.generationEquivalentHomes ?? 0;
  const isGenerationOnlyBranch = feeder.customers === 0 && generationEquivalentHomes > 0;
  const openCustomers = feeder.breakerStatus === "closed" ? feeder.customers : 0;
  const openCriticalCustomers = feeder.breakerStatus === "closed" ? feeder.criticalCustomers : 0;
  const canRestoreCustomers = feeder.breakerStatus === "closed" ? 0 : feeder.customers;
  const canRestoreCriticalCustomers = feeder.breakerStatus === "closed" ? 0 : feeder.criticalCustomers;

  const open: CommandPreviewSummary = {
    title: "Ved utkobling",
    tone: openCustomers > 0 || isGenerationOnlyBranch ? "warn" : "neutral",
    headline:
      openCustomers > 0
        ? `${openCustomers} kunder mister forsyning`
        : isGenerationOnlyBranch
          ? `Lokal produksjon tilsvarende ca. ${generationEquivalentHomes} boliger faller ut`
          : "Ingen nye kunder kobles ut",
    detail:
      openCustomers > 0
        ? `${openCriticalCustomers} kritiske kunder ligger pa denne grenen.`
        : isGenerationOnlyBranch
          ? "Oppstroms nett er fortsatt tilgjengelig, men lokal vannkraftstotte forsvinner."
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
  } else if (isGenerationOnlyBranch && feeder.breakerStatus !== "closed") {
    closeHeadline = supplyAvailable
      ? `Lokal produksjon tilsvarende ca. ${generationEquivalentHomes} boliger kan komme tilbake`
      : "Oppstroms forsyning er ikke tilgjengelig";
    closeDetail = supplyAvailable
      ? "Vannkraftgrenen kan bidra inn pa samleskinnen igjen hvis interlocks er oppfylt."
      : "Lukking alene gjenoppretter ikke eksport hvis bus ikke er spenningssatt.";
  }

  const close: CommandPreviewSummary = {
    title: "Ved innkobling",
    tone: (canRestoreCustomers > 0 || isGenerationOnlyBranch) && supplyAvailable ? "good" : "neutral",
    headline: closeHeadline,
    detail: closeDetail,
    customers: canRestoreCustomers,
    criticalCustomers: canRestoreCriticalCustomers,
  };

  return { open, close };
}

export function getStationBreakerRestoreAssessment(
  topology: StationTopology | null,
  snapshot: StationSnapshot,
  alarms: Alarm[],
  controls: FeederControlInput[],
  breakerId: "BRK-IN" | "LV-BRK",
): StationRestoreAssessment {
  const impactSummary = getTopologyImpactSummary(topology, snapshot, breakerId);
  const downstreamFeederIds = impactSummary?.downstreamFeederIds ?? snapshot.feeders.map((feeder) => feeder.id);
  const feederById = feederMap(snapshot);
  const controlById = controlMap(controls);
  const downstreamControls = downstreamFeederIds
    .map((feederId) => controlById.get(feederId))
    .filter((control): control is FeederControlInput => Boolean(control));
  const downstreamClosedControls = downstreamControls.filter((control) => control.breakerStatus === "closed");
  const inletClosed = stationBreakerStatus(snapshot, "BRK-IN") === "closed";
  const lvClosed = stationBreakerStatus(snapshot, "LV-BRK") === "closed";
  const wouldEnergizeBus = breakerId === "LV-BRK" || (breakerId === "BRK-IN" && lvClosed);

  const blockingReasons: string[] = [];
  const advisoryNotes: string[] = [];

  if (breakerId === "LV-BRK" && !inletClosed) {
    blockingReasons.push("BRK-IN must be closed before LV-BRK can energize the 0.4 kV bus.");
  }

  if (wouldEnergizeBus) {
    const criticalObjectIds = new Set<string>(["T1", ...downstreamFeederIds]);
    const criticalAlarms = alarms.filter(
      (alarm) =>
        alarm.severity === "critical" &&
        alarm.state !== "acknowledged" &&
        criticalObjectIds.has(alarm.objectId),
    );
    const degradedFeeders = downstreamClosedControls
      .filter((control) => isDegradedCommunication(control))
      .map((control) => control.id);
    const unsafeFeeders = downstreamClosedControls
      .filter(
        (control) =>
          control.faultMode === "overload" ||
          control.faultMode === "forced_trip" ||
          control.faultMode === "sensor_fault",
      )
      .map((control) => control.id);

    if (criticalAlarms.length) {
      blockingReasons.push("Acknowledge critical transformer or downstream alarms before bus restore.");
    }
    if (degradedFeeders.length) {
      blockingReasons.push(`Restore telemetry quality on closed feeders: ${degradedFeeders.join(", ")}.`);
    }
    if (unsafeFeeders.length) {
      blockingReasons.push(`Clear active faults on closed feeders: ${unsafeFeeders.join(", ")}.`);
    }
  }

  if (breakerId === "BRK-IN" && !lvClosed) {
    advisoryNotes.push("Closing BRK-IN now will energize only the transformer. The bus remains isolated until LV-BRK is closed.");
  }
  if (breakerId === "BRK-IN" && lvClosed) {
    advisoryNotes.push("Closing BRK-IN will also restore the live path through LV-BRK to every downstream feeder that is already closed.");
  }
  if (breakerId === "LV-BRK" && inletClosed) {
    advisoryNotes.push("Any feeder breaker that is already closed will be restored immediately when LV-BRK closes.");
  }
  if (breakerId === "LV-BRK" && !inletClosed) {
    advisoryNotes.push("Use BRK-IN first to re-energize the transformer, then restore the low-voltage bus.");
  }

  const restoreSteps =
    breakerId === "BRK-IN"
      ? [
          "Review active transformer and downstream alarms.",
          lvClosed
            ? "Treat BRK-IN closing as a station restore: all closed downstream paths will re-energize immediately."
            : "Close BRK-IN first to energize only the transformer while LV-BRK stays open.",
          "Verify transformer voltage, quality, and top-oil temperature before restoring the bus.",
          "Restore LV-BRK and feeders in sequence after faults and telemetry issues are cleared.",
        ]
      : [
          "Confirm BRK-IN is already closed and the transformer is healthy.",
          "Clear trips, overloads, and telemetry issues on downstream feeders that remain closed.",
          "Acknowledge critical alarms before restoring the low-voltage bus.",
          "Close LV-BRK and verify feeders branch by branch after the bus is energized.",
        ];

  const totalCustomers = impactSummary?.totalCustomers ?? 0;
  const criticalCustomers = impactSummary?.criticalCustomers ?? 0;
  const criticalObjectIds = new Set(
    alarms
      .filter((alarm) => alarm.severity === "critical" && alarm.state !== "acknowledged")
      .map((alarm) => alarm.objectId),
  );

  const closeBranchPreview: StationBranchPreviewItem[] = downstreamFeederIds
    .map((feederId) => feederById.get(feederId))
    .filter((feeder): feeder is FeederTelemetry => Boolean(feeder))
    .map((feeder): StationBranchPreviewItem => {
      const control = controlById.get(feeder.id);
      const feederScope = describeBranchScope(feeder);
      const branchClosed = control?.breakerStatus === "closed";
      const blockedByTelemetry = control ? isDegradedCommunication(control) : false;
      const blockedByFault =
        control?.faultMode === "overload" ||
        control?.faultMode === "forced_trip" ||
        control?.faultMode === "sensor_fault";
      const blockedByAlarm = criticalObjectIds.has(feeder.id);

      if (breakerId === "BRK-IN" && !lvClosed) {
        return {
          feederId: feeder.id,
          label: `${feeder.id} - ${feeder.name}`,
          action: branchClosed ? "hold" : "already_out",
          tone: "neutral" as const,
          detail: branchClosed
            ? `Bus remains isolated after BRK-IN closes, so ${feederScope} is still held until LV-BRK closes.`
            : "Feeder breaker is already open/tripped and remains isolated until it is restored later.",
          customers: feeder.customers,
          criticalCustomers: feeder.criticalCustomers,
        };
      }

      if (!branchClosed) {
        return {
          feederId: feeder.id,
          label: `${feeder.id} - ${feeder.name}`,
          action: "hold" as const,
          tone: "neutral" as const,
          detail: isGenerationSupportFeeder(feeder)
            ? "Feeder breaker is open/tripped, so local production stays out until the branch is restored."
            : "Feeder breaker is open/tripped, so this branch remains isolated after station restore.",
          customers: feeder.customers,
          criticalCustomers: feeder.criticalCustomers,
        };
      }

      if (blockedByTelemetry || blockedByFault || blockedByAlarm) {
        const blockers: string[] = [];
        if (blockedByTelemetry) {
          blockers.push("telemetry must return to good");
        }
        if (blockedByFault) {
          blockers.push("active fault mode must be cleared");
        }
        if (blockedByAlarm) {
          blockers.push("critical alarm must be acknowledged");
        }

        return {
          feederId: feeder.id,
          label: `${feeder.id} - ${feeder.name}`,
          action: "blocked" as const,
          tone: "warn" as const,
          detail: `${feederScope} stays out until ${blockers.join(", ")}.`,
          customers: feeder.customers,
          criticalCustomers: feeder.criticalCustomers,
        };
      }

      return {
        feederId: feeder.id,
        label: `${feeder.id} - ${feeder.name}`,
        action: isFeederEnergized(snapshot, feeder) ? ("already_live" as const) : ("restore" as const),
        tone: isFeederEnergized(snapshot, feeder) ? ("neutral" as const) : ("good" as const),
        detail: isGenerationSupportFeeder(feeder)
          ? isFeederEnergized(snapshot, feeder)
            ? `Branch is already exporting ${feederScope}.`
            : `Branch can resume ${feederScope} as soon as the station path is restored.`
          : isFeederEnergized(snapshot, feeder)
            ? `Branch is already live for ${feederScope}.`
            : `Branch can be restored for ${feederScope}.`,
        customers: feeder.customers,
        criticalCustomers: feeder.criticalCustomers,
      };
    });

  const openBranchPreview: StationBranchPreviewItem[] = downstreamFeederIds
    .map((feederId) => feederById.get(feederId))
    .filter((feeder): feeder is FeederTelemetry => Boolean(feeder))
    .map((feeder): StationBranchPreviewItem => {
      const branchLive = isFeederEnergized(snapshot, feeder);
      return {
        feederId: feeder.id,
        label: `${feeder.id} - ${feeder.name}`,
        action: branchLive ? ("drop" as const) : ("already_out" as const),
        tone: branchLive ? ("warn" as const) : ("neutral" as const),
        detail: branchLive
          ? isGenerationSupportFeeder(feeder)
            ? `Opening ${breakerId} drops ${describeBranchScope(feeder)} off the bus immediately.`
            : `${describeBranchScope(feeder)} loses supply immediately if ${breakerId} opens.`
          : "Branch is already isolated, so opening the station path adds no new outage here.",
        customers: feeder.customers,
        criticalCustomers: feeder.criticalCustomers,
      };
    });

  const openImpact: CommandPreviewSummary = {
    title: "Ved utkobling",
    tone: totalCustomers > 0 ? "warn" : "neutral",
    headline:
      totalCustomers > 0
        ? `${totalCustomers} kunder kan miste forsyning`
        : breakerId === "BRK-IN"
          ? "Kun oppstroms mating isoleres"
          : "Kun samleskinnen isoleres",
    detail:
      totalCustomers > 0
        ? `${criticalCustomers} kritiske kunder ligger nedstroms for denne stasjonsbryteren.`
        : "Ingen lukkede nedstroms grener blir koblet ut akkurat na.",
    customers: totalCustomers,
    criticalCustomers,
  };

  let closeHeadline = "Ingen ny forsyning endres";
  let closeDetail = "Bryteren er allerede inne eller bus restore er ikke aktuelt na.";
  let closeTone: "good" | "warn" | "neutral" = "neutral";
  let nextAction = "Hold the station path as-is and continue monitoring.";

  if (breakerId === "BRK-IN" && !lvClosed) {
    closeHeadline = "Kun transformatoren blir energisert";
    closeDetail = "Lavspentbussen forblir isolert til LV-BRK lukkes i neste steg.";
    closeTone = "good";
    nextAction = "Close BRK-IN, verify transformer health, then use LV-BRK for controlled bus restore.";
  } else if (totalCustomers > 0) {
    closeHeadline = blockingReasons.length
      ? "Restore er fortsatt sperret"
      : `${totalCustomers} kunder kan fa forsyning tilbake`;
    closeDetail = blockingReasons.length
      ? "Rydd sperrene under restore-statusen for stasjonslukking."
      : `${criticalCustomers} kritiske kunder kan gjeninnkobles hvis downstream brytere er klare.`;
    closeTone = blockingReasons.length ? "warn" : "good";
    nextAction = blockingReasons.length
      ? "Clear the blocking conditions below before closing this station breaker."
      : breakerId === "LV-BRK"
        ? "Close LV-BRK, then confirm each downstream feeder branch picks up as expected."
        : "Close BRK-IN and watch every already-closed downstream branch during restore.";
  } else {
    nextAction =
      breakerId === "BRK-IN"
        ? "Use BRK-IN to re-energize the transformer path before you touch the low-voltage bus."
        : "Use LV-BRK only after BRK-IN and the transformer path are confirmed healthy.";
  }

  return {
    breakerId,
    readyToClose: blockingReasons.length === 0,
    wouldEnergizeBus,
    blockingReasons,
    advisoryNotes,
    restoreSteps,
    nextAction,
    openImpact,
    closeImpact: {
      title: "Ved innkobling",
      tone: closeTone,
      headline: closeHeadline,
      detail: closeDetail,
      customers: totalCustomers,
      criticalCustomers,
    },
    openBranchPreview,
    closeBranchPreview,
  };
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
