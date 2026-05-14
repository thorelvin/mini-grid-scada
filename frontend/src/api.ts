import type {
  BreakerCommandRequest,
  CommandResult,
  ConnectionStatus,
  DashboardTrends,
  DashboardPayload,
  FeederControlInput,
  SimulatorSettings,
} from "./types";

const apiBase = (import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000")
  .trim()
  .replace(/\/+$/, "");

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getDashboard(): Promise<DashboardPayload> {
  return fetchJson<DashboardPayload>(`${apiBase}/api/dashboard`);
}

export function getTrends(params?: {
  voltageWindowSec?: number;
  currentWindowSec?: number;
  activePowerWindowSec?: number;
  waterFlowWindowSec?: number;
  generationSupportWindowSec?: number;
  transformerWindowSec?: number;
}): Promise<DashboardTrends> {
  const searchParams = new URLSearchParams();
  if (params?.voltageWindowSec) {
    searchParams.set("voltage_window_sec", String(params.voltageWindowSec));
  }
  if (params?.currentWindowSec) {
    searchParams.set("current_window_sec", String(params.currentWindowSec));
  }
  if (params?.activePowerWindowSec) {
    searchParams.set("active_power_window_sec", String(params.activePowerWindowSec));
  }
  if (params?.waterFlowWindowSec) {
    searchParams.set("water_flow_window_sec", String(params.waterFlowWindowSec));
  }
  if (params?.generationSupportWindowSec) {
    searchParams.set("generation_support_window_sec", String(params.generationSupportWindowSec));
  }
  if (params?.transformerWindowSec) {
    searchParams.set("transformer_window_sec", String(params.transformerWindowSec));
  }
  const query = searchParams.toString();
  return fetchJson<DashboardTrends>(`${apiBase}/api/trends${query ? `?${query}` : ""}`);
}

export function updateFeederControls(
  feederId: string,
  patch: Partial<FeederControlInput>,
): Promise<FeederControlInput> {
  return fetchJson<FeederControlInput>(`${apiBase}/api/simulator/feeders/${feederId}/controls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function updateSimulatorSettings(
  patch: Partial<SimulatorSettings>,
): Promise<SimulatorSettings> {
  return fetchJson<SimulatorSettings>(`${apiBase}/api/simulator/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function activateScenario(scenarioId: string): Promise<DashboardPayload> {
  return fetchJson<DashboardPayload>(`${apiBase}/api/simulator/scenarios/${scenarioId}/activate`, {
    method: "POST",
  });
}

export function activateProfile(profileId: string): Promise<DashboardPayload> {
  return fetchJson<DashboardPayload>(`${apiBase}/api/simulator/profiles/${profileId}/activate`, {
    method: "POST",
  });
}

export function activateTimedEvent(eventId: string): Promise<DashboardPayload> {
  return fetchJson<DashboardPayload>(`${apiBase}/api/simulator/events/${eventId}/activate`, {
    method: "POST",
  });
}

export function resetSimulation(): Promise<DashboardPayload> {
  return fetchJson<DashboardPayload>(`${apiBase}/api/simulator/reset`, {
    method: "POST",
  });
}

export function openBreaker(command: BreakerCommandRequest): Promise<CommandResult> {
  return fetchJson<CommandResult>(`${apiBase}/api/commands/open-breaker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}

export function closeBreaker(command: BreakerCommandRequest): Promise<CommandResult> {
  return fetchJson<CommandResult>(`${apiBase}/api/commands/close-breaker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}

export function acknowledgeAlarm(alarmId: string): Promise<void> {
  return fetchJson(`${apiBase}/api/alarms/${alarmId}/acknowledge`, {
    method: "POST",
  }).then(() => undefined);
}

export function acknowledgeAlarms(objectId?: string): Promise<void> {
  const query = objectId ? `?object_id=${encodeURIComponent(objectId)}` : "";
  return fetchJson(`${apiBase}/api/alarms/acknowledge${query}`, {
    method: "POST",
  }).then(() => undefined);
}

export function connectDashboard(
  onData: (payload: DashboardPayload) => void,
  onStatus: (status: ConnectionStatus) => void,
  onError: (message: string) => void,
): () => void {
  const socketUrl = new URL("/ws/dashboard", `${apiBase}/`);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(socketUrl.toString());
  onStatus("connecting");

  socket.addEventListener("open", () => onStatus("live"));
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data) as DashboardPayload;
      onData(payload);
      onStatus("live");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unknown websocket error");
    }
  });
  socket.addEventListener("close", () => onStatus("polling"));
  socket.addEventListener("error", () => {
    onStatus("polling");
    onError("WebSocket unavailable, falling back to HTTP polling.");
  });

  return () => socket.close();
}

export { apiBase };
