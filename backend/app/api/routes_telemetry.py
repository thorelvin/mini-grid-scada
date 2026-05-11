from fastapi import APIRouter, Request

from backend.app.services.app_state import AppState

router = APIRouter(prefix="/api", tags=["telemetry"])


def _state(request: Request) -> AppState:
    return request.app.state.app_state


@router.get("/topology")
async def get_topology(request: Request):
    return await _state(request).get_topology()


@router.get("/telemetry/latest")
async def get_latest_telemetry(request: Request):
    return await _state(request).get_snapshot()

