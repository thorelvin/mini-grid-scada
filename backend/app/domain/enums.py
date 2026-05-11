from enum import Enum


class DataQuality(str, Enum):
    GOOD = "good"
    ESTIMATED = "estimated"
    STALE = "stale"
    INVALID = "invalid"
    LOST = "lost"


class BreakerStatus(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    TRIPPED = "tripped"


class AlarmSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlarmState(str, Enum):
    NEW = "new"
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RETURNED = "returned"
    CLOSED = "closed"


class FeederType(str, Enum):
    HOUSING = "housing"
    INDUSTRY = "industry"
    EV_CHARGING = "ev_charging"
    SOLAR_PROSUMER = "solar_prosumer"


class FaultMode(str, Enum):
    NORMAL = "normal"
    OVERLOAD = "overload"
    PLANNED_OUTAGE = "planned_outage"
    SENSOR_FAULT = "sensor_fault"
    FORCED_TRIP = "forced_trip"


class AssetKind(str, Enum):
    STATION = "station"
    BREAKER = "breaker"
    TRANSFORMER = "transformer"
    BUSBAR = "busbar"
    FEEDER = "feeder"


class PowerDirection(str, Enum):
    IMPORT = "import"
    EXPORT = "export"
    NEUTRAL = "neutral"


class CommandAction(str, Enum):
    OPEN_BREAKER = "open_breaker"
    CLOSE_BREAKER = "close_breaker"
