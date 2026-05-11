from fastapi import APIRouter, HTTPException, Request

from backend.app.domain.models import FeederControlPatch, SimulatorSettingsPatch
from backend.app.services.app_state import AppState
from backend.app.services.simulator_service import SimulatorService
from simulator.scenarios import list_scenarios

router = APIRouter(prefix="/api/simulator", tags=["simulator"])


def _state(request: Request) -> AppState:
    return request.app.state.app_state


def _simulator(request: Request) -> SimulatorService:
    return request.app.state.simulator_service


@router.get("/controls")
async def get_controls(request: Request):
    return await _state(request).get_controls()


@router.post("/feeders/{feeder_id}/controls")
async def update_feeder_controls(request: Request, feeder_id: str, patch: FeederControlPatch):
    try:
        updated = await _state(request).update_control(feeder_id, patch)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown feeder: {feeder_id}") from exc
    await _simulator(request).refresh_now()
    return updated


@router.get("/settings")
async def get_settings(request: Request):
    return await _state(request).get_simulator_settings()


@router.post("/settings")
async def update_settings(request: Request, patch: SimulatorSettingsPatch):
    updated = await _state(request).update_simulator_settings(patch)
    await _simulator(request).refresh_now()
    return updated


@router.get("/scenarios")
async def get_scenarios():
    return list_scenarios()


@router.post("/scenarios/{scenario_id}/activate")
async def activate_scenario(request: Request, scenario_id: str):
    try:
        await _state(request).apply_scenario(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}") from exc
    await _simulator(request).refresh_now()
    return await _state(request).get_dashboard()


@router.post("/reset")
async def reset_simulation(request: Request):
    await _state(request).reset_simulation()
    await _simulator(request).refresh_now()
    return await _state(request).get_dashboard()
