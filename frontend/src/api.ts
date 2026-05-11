import type {
  BreakerCommandRequest,
  CommandResult,
  ConnectionStatus,
  DashboardPayload,
  FeederControlInput,
  SimulatorSettings,
} from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const wsBase = apiBase.replace(/^http/i, "ws");

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
  const socket = new WebSocket(`${wsBase}/ws/dashboard`);
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
