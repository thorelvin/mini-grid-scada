from simulator.grid_simulator import build_demo_topology


def test_topology_contains_transformer_and_five_feeders():
    topology = build_demo_topology("NST-001")
    ids = {asset.id for asset in topology.assets}

    assert "T1" in ids
    assert {"F1", "F2", "F3", "F4", "F5"}.issubset(ids)

