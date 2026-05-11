from fastapi import APIRouter, HTTPException, Request

from backend.app.services.app_state import AppState

router = APIRouter(prefix="/api", tags=["alarms"])


def _state(request: Request) -> AppState:
    return request.app.state.app_state


@router.get("/alarms/active")
async def get_active_alarms(request: Request):
    return await _state(request).get_active_alarms()


@router.post("/alarms/acknowledge")
async def acknowledge_alarms(request: Request, object_id: str | None = None):
    return await _state(request).acknowledge_alarms(object_id=object_id)


@router.post("/alarms/{alarm_id}/acknowledge")
async def acknowledge_alarm(request: Request, alarm_id: str):
    try:
        return await _state(request).acknowledge_alarm(alarm_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown alarm: {alarm_id}") from exc
