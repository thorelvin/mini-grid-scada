from fastapi import APIRouter, Query, Request

from backend.app.services.app_state import AppState

router = APIRouter(prefix="/api", tags=["events"])


def _state(request: Request) -> AppState:
    return request.app.state.app_state


@router.get("/events")
async def get_events(request: Request, limit: int = Query(default=50, ge=1, le=200)):
    return await _state(request).get_events(limit=limit)

