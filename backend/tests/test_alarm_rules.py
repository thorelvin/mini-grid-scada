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

    assert next(feeder for feeder in snapshot.feeders if feeder.id == "F3").breakerStatus == "tripped"
    assert any(
        alarm.objectId == "F3" and alarm.severity in {"high", "critical"}
        for alarm in alarms
    )


def test_service_target_voltage_biases_snapshot_toward_realistic_house_voltage():
    controls = create_default_controls()

    baseline_snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=18.0,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
        service_target_phase_voltage_v=230.0,
    )
    calibrated_snapshot = build_snapshot(
        station_id="NST-001",
        mode="simulation",
        controls=controls,
        ambient_temp_c=18.0,
        nominal_phase_voltage_v=230.0,
        nominal_line_voltage_v=400.0,
        transformer_rating_kva=1250.0,
        service_target_phase_voltage_v=232.0,
    )

    assert calibrated_snapshot.transformer.secondaryVoltageV > baseline_snapshot.transformer.secondaryVoltageV


def test_hydro_low_flow_and_derating_generate_specific_alarms():
    controls = create_default_controls()
    controls[4] = controls[4].model_copy(update={"waterFlowPercent": 30.0, "solarKw": 96.0})

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

    assert any(alarm.objectId == "F5" and alarm.title == "Low water flow" for alarm in alarms)
    assert any(alarm.objectId == "F5" and alarm.title == "Hydro generation derated" for alarm in alarms)


def test_hydro_intake_restriction_alarm_appears_for_estimated_low_flow():
    controls = create_default_controls()
    controls[4] = controls[4].model_copy(update={"waterFlowPercent": 42.0, "communicationState": "estimated", "solarKw": 94.0})

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

    assert any(alarm.objectId == "F5" and alarm.title == "Intake restriction suspected" for alarm in alarms)
