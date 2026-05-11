from __future__ import annotations

import asyncio

from backend.app.config import settings
from backend.app.services.alarm_service import evaluate_snapshot
from backend.app.services.app_state import AppState
from simulator.grid_simulator import build_snapshot


class SimulatorService:
    def __init__(self, app_state: AppState) -> None:
        self._app_state = app_state
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop_event.clear()
        await self._app_state.set_simulator_running(True)
        await self._produce_frame()
        self._task = asyncio.create_task(self._run_loop(), name="mini-grid-simulator")
        await self._app_state.add_event("system", "simulator", "Simulator loop started.")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        await self._app_state.set_simulator_running(False)
        await self._app_state.add_event("system", "simulator", "Simulator loop stopped.")

    async def refresh_now(self) -> None:
        await self._produce_frame()

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            await self._produce_frame()
            await asyncio.sleep(settings.update_interval_sec)

    async def _produce_frame(self) -> None:
        controls = await self._app_state.get_controls()
        simulator_settings = await self._app_state.get_simulator_settings()
        snapshot = build_snapshot(
            station_id=settings.station_id,
            mode=settings.simulation_mode,
            controls=controls,
            ambient_temp_c=simulator_settings.ambientTempC,
            nominal_phase_voltage_v=settings.nominal_phase_voltage_v,
            nominal_line_voltage_v=settings.nominal_line_voltage_v,
            transformer_rating_kva=settings.transformer_rating_kva,
        )
        alarms = evaluate_snapshot(snapshot)
        await self._app_state.update_frame(snapshot, alarms)
