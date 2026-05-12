from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    api_title: str = "Mini Grid SCADA Backend"
    station_id: str = os.getenv("SCADA_STATION_ID", "NST-001")
    simulation_mode: str = os.getenv("SCADA_MODE", "simulation")
    update_interval_sec: float = float(os.getenv("SCADA_UPDATE_INTERVAL_SEC", "2.0"))
    nominal_phase_voltage_v: float = float(os.getenv("SCADA_NOMINAL_PHASE_VOLTAGE_V", "230.0"))
    service_target_phase_voltage_v: float = float(os.getenv("SCADA_SERVICE_TARGET_PHASE_VOLTAGE_V", "232.0"))
    nominal_line_voltage_v: float = float(os.getenv("SCADA_NOMINAL_LINE_VOLTAGE_V", "400.0"))
    transformer_rating_kva: float = float(os.getenv("SCADA_TRANSFORMER_RATING_KVA", "1250.0"))
    trend_history_hours: float = float(os.getenv("SCADA_TREND_HISTORY_HOURS", "12"))
    default_trend_window_sec: int = int(os.getenv("SCADA_DEFAULT_TREND_WINDOW_SEC", "900"))
    trend_max_points: int = int(os.getenv("SCADA_TREND_MAX_POINTS", "180"))
    api_host: str = os.getenv("SCADA_API_HOST", "127.0.0.1")
    api_port: int = int(os.getenv("SCADA_API_PORT", "8000"))

    @property
    def cors_origins(self) -> list[str]:
        raw = os.getenv("SCADA_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

    @property
    def trend_history_max_snapshots(self) -> int:
        return max(240, int((self.trend_history_hours * 3600) / max(self.update_interval_sec, 0.5)))


settings = Settings()
