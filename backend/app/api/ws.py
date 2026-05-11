import asyncio

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from backend.app.config import settings
from backend.app.services.app_state import AppState

router = APIRouter(tags=["websocket"])


def _state(request: Request | WebSocket) -> AppState:
    return request.app.state.app_state


@router.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    state = _state(websocket)
    await state.increment_websocket_clients()
    try:
        while True:
            dashboard = await state.get_dashboard()
            await websocket.send_json(dashboard.model_dump(mode="json"))
            await asyncio.sleep(settings.update_interval_sec)
    except WebSocketDisconnect:
        pass
    finally:
        await state.decrement_websocket_clients()

