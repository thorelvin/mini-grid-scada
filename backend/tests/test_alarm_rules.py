from backend.app.services.alarm_service import evaluate_snapshot
from simulator.grid_simulator import build_snapshot, create_default_controls


def test_overload_alarm_is_generated_for_heavy_ev_load():
    controls = create_default_controls()
    controls[2] = controls[2].model_copy(update={"loadKw": 260.0})

    snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=18.0,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
    )

    alarms = evaluate_snapshot(snapshot)

    assert any(
        alarm.objectId == "F3" and alarm.severity in {"high", "critical"}
        for alarm in alarms
    )
