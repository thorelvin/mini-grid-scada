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

export function useTelemetryStore() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    let disposed = false;
    let latestConnectionStatus: ConnectionStatus = "connecting";

    async function refresh() {
      try {
        setIsPending(true);
        const next = await getDashboard();
        if (disposed) {
          return;
        }
        startTransition(() => {
          setDashboard(next);
          setError(null);
        });
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
        startTransition(() => {
          setDashboard(next);
          setError(null);
        });
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
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function patchSimulatorSettings(patch: Partial<SimulatorSettings>) {
    setIsPending(true);
    try {
      await updateSimulatorSettings(patch);
      const next = await getDashboard();
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function runScenario(scenarioId: string) {
    setIsPending(true);
    try {
      const next = await activateScenario(scenarioId);
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function runProfile(profileId: string) {
    setIsPending(true);
    try {
      const next = await activateProfile(profileId);
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function runTimedEvent(eventId: string) {
    setIsPending(true);
    try {
      const next = await activateTimedEvent(eventId);
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function resetToNormal() {
    setIsPending(true);
    try {
      const next = await resetSimulation();
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function executeOpenBreaker(command: BreakerCommandRequest) {
    setIsPending(true);
    try {
      await openBreaker(command);
      const next = await getDashboard();
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function executeCloseBreaker(command: BreakerCommandRequest) {
    setIsPending(true);
    try {
      await closeBreaker(command);
      const next = await getDashboard();
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function acknowledge(alarmId: string) {
    setIsPending(true);
    try {
      await acknowledgeAlarm(alarmId);
      const next = await getDashboard();
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  async function acknowledgeAll(objectId?: string) {
    setIsPending(true);
    try {
      await acknowledgeAlarms(objectId);
      const next = await getDashboard();
      startTransition(() => setDashboard(next));
    } finally {
      setIsPending(false);
    }
  }

  return {
    dashboard,
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
