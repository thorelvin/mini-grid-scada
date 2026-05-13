import { startTransition, useEffect, useState } from "react";

import {
  acknowledgeAlarm,
  acknowledgeAlarms,
  activateProfile,
  activateScenario,
  activateTimedEvent,
  closeBreaker,
  connectDashboard,
  getDashboard,
  openBreaker,
  resetSimulation,
  updateFeederControls,
  updateSimulatorSettings,
} from "../api";
import type {
  BreakerCommandRequest,
  ConnectionStatus,
  DashboardPayload,
  FeederControlInput,
  SimulatorSettings,
} from "../types";

const MAX_DASHBOARD_HISTORY = 180;

function appendDashboardHistory(
  history: DashboardPayload[],
  next: DashboardPayload,
): DashboardPayload[] {
  if (history.length === 0) {
    return [next];
  }

  const last = history[history.length - 1];
  if (last.snapshot.timestamp === next.snapshot.timestamp) {
    return [...history.slice(0, -1), next];
  }

  const nextHistory = [...history, next];
  return nextHistory.length > MAX_DASHBOARD_HISTORY
    ? nextHistory.slice(nextHistory.length - MAX_DASHBOARD_HISTORY)
    : nextHistory;
}

export function useTelemetryStore() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashboardHistory, setDashboardHistory] = useState<DashboardPayload[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    let disposed = false;
    let latestConnectionStatus: ConnectionStatus = "connecting";

    function commitDashboard(next: DashboardPayload) {
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
        setError(null);
      });
    }

    async function refresh() {
      try {
        setIsPending(true);
        const next = await getDashboard();
        if (disposed) {
          return;
        }
        commitDashboard(next);
      } catch (nextError) {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : "Unknown API error");
          latestConnectionStatus = "offline";
          setConnectionStatus("offline");
        }
      } finally {
        if (!disposed) {
          setIsPending(false);
        }
      }
    }

    void refresh();
    const disconnect = connectDashboard(
      (next) => {
        if (disposed) {
          return;
        }
        commitDashboard(next);
      },
      (status) => {
        if (!disposed) {
          latestConnectionStatus = status;
          setConnectionStatus(status);
        }
      },
      (message) => {
        if (!disposed) {
          setError(message);
        }
      },
    );

    const pollHandle = window.setInterval(() => {
      if (document.visibilityState === "visible" && latestConnectionStatus !== "live") {
        void refresh();
      }
    }, 4000);

    return () => {
      disposed = true;
      disconnect();
      window.clearInterval(pollHandle);
    };
  }, []);

  async function patchFeederControl(feederId: string, patch: Partial<FeederControlInput>) {
    setIsPending(true);
    try {
      await updateFeederControls(feederId, patch);
      const next = await getDashboard();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function patchSimulatorSettings(patch: Partial<SimulatorSettings>) {
    setIsPending(true);
    try {
      await updateSimulatorSettings(patch);
      const next = await getDashboard();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function runScenario(scenarioId: string) {
    setIsPending(true);
    try {
      const next = await activateScenario(scenarioId);
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function runProfile(profileId: string) {
    setIsPending(true);
    try {
      const next = await activateProfile(profileId);
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function runTimedEvent(eventId: string) {
    setIsPending(true);
    try {
      const next = await activateTimedEvent(eventId);
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function resetToNormal() {
    setIsPending(true);
    try {
      const next = await resetSimulation();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function executeOpenBreaker(command: BreakerCommandRequest) {
    setIsPending(true);
    try {
      await openBreaker(command);
      const next = await getDashboard();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function executeCloseBreaker(command: BreakerCommandRequest) {
    setIsPending(true);
    try {
      await closeBreaker(command);
      const next = await getDashboard();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function acknowledge(alarmId: string) {
    setIsPending(true);
    try {
      await acknowledgeAlarm(alarmId);
      const next = await getDashboard();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  async function acknowledgeAll(objectId?: string) {
    setIsPending(true);
    try {
      await acknowledgeAlarms(objectId);
      const next = await getDashboard();
      startTransition(() => {
        setDashboard(next);
        setDashboardHistory((current) => appendDashboardHistory(current, next));
      });
    } finally {
      setIsPending(false);
    }
  }

  return {
    dashboard,
    dashboardHistory,
    connectionStatus,
    error,
    isPending,
    patchFeederControl,
    patchSimulatorSettings,
    runScenario,
    runProfile,
    runTimedEvent,
    resetToNormal,
    executeOpenBreaker,
    executeCloseBreaker,
    acknowledge,
    acknowledgeAll,
  };
}
