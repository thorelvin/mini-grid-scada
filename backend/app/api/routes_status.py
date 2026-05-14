from fastapi import APIRouter, Request

from backend.app.services.app_state import AppState

router = APIRouter(prefix="/api", tags=["status"])


def _state(request: Request) -> AppState:
    return request.app.state.app_state


@router.get("/status")
async def get_status(request: Request) -> dict[str, object]:
    health = await _state(request).get_health()
    return {"ok": True, "stationId": request.app.state.station_id, "health": health}


@router.get("/health")
async def get_health(request: Request):
    return await _state(request).get_health()


@router.get("/dashboard")
async def get_dashboard(request: Request):
    return await _state(request).get_dashboard()


@router.get("/trends")
async def get_trends(
    request: Request,
    voltage_window_sec: int | None = None,
    current_window_sec: int | None = None,
    active_power_window_sec: int | None = None,
    water_flow_window_sec: int | None = None,
    generation_support_window_sec: int | None = None,
    transformer_window_sec: int | None = None,
):
    return await _state(request).get_trends(
        voltage_window_sec=voltage_window_sec,
        current_window_sec=current_window_sec,
        active_power_window_sec=active_power_window_sec,
        water_flow_window_sec=water_flow_window_sec,
        generation_support_window_sec=generation_support_window_sec,
        transformer_window_sec=transformer_window_sec,
    )
