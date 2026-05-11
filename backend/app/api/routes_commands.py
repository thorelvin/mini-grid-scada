from fastapi import APIRouter, HTTPException, Request

from backend.app.domain.enums import CommandAction
from backend.app.domain.models import BreakerCommandRequest
from backend.app.services.app_state import AppState
from backend.app.services.simulator_service import SimulatorService

router = APIRouter(prefix="/api/commands", tags=["commands"])


def _state(request: Request) -> AppState:
    return request.app.state.app_state


def _simulator(request: Request) -> SimulatorService:
    return request.app.state.simulator_service


@router.post("/open-breaker")
async def open_breaker(request: Request, command: BreakerCommandRequest):
    await _simulator(request).refresh_now()
    try:
        result = await _state(request).execute_breaker_command(CommandAction.OPEN_BREAKER, command)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown feeder: {command.objectId}") from exc
    await _simulator(request).refresh_now()
    return result


@router.post("/close-breaker")
async def close_breaker(request: Request, command: BreakerCommandRequest):
    await _simulator(request).refresh_now()
    try:
        result = await _state(request).execute_breaker_command(CommandAction.CLOSE_BREAKER, command)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown feeder: {command.objectId}") from exc
    await _simulator(request).refresh_now()
    return result
