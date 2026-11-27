"""设施校验与发布准备（app/layout_facilities.py）。"""
import json
import time
from copy import deepcopy
from pathlib import Path

from app import modeling as M
from app.layout_facilities import containers_for, facility_issues, publish_prepare, reference_vehicle

C = {'c1': {'id': 'c1', 'name': 'Box', 'type': 'plastic_box', 'color': '#3a9d6e', 'width': 1.0, 'depth': 1.0, 'height': 0.8},
     'c2': {'id': 'c2', 'name': 'Pallet', 'type': 'plastic_pallet', 'color': '#2f6fb3', 'width': 1.1, 'depth': 1.1, 'height': 0.15}}
FORKLIFT = {'id': 'v1', 'category': 'SFL-CBD20', 'number': '001', 'floor': 1, 'position': [2, 2], 'rotation': 0,
            'timing': {'mode': 'speed', 'speed_mps': 1.0},
            'vehicle': {'width': 2.0, 'depth': 1.0, 'pick_s': 15, 'drop_s': 12, 'lift_speed_mps': 0.2, 'low_battery_pct': 20}}


def doc(width=60, depth=40, **extra):
    return {'schema_version': '1.1', 'size': {'width': width, 'depth': depth, 'height': 10},
            'floors': [{'id': 1, 'name': 'F1', 'elevation': 0}], 'rack_groups': [], 'ground_batches': [],
            'equipment': [deepcopy(FORKLIFT)], **extra}


def rack_row(origin, groups, prefix='N', row=1, rotation=0, spacing=2.5, container='c1', key=None, templates=C):
    per = M.level_slots(M.rack_widths(spacing, 1)['clear'], templates[container]['width'])['count']
    out = []
    for k in range(groups):
        o = M.to_world(origin[0], origin[1], rotation, k * spacing, 0)
        out.append({'id': f'{prefix}{row}-{k}', 'row_key': key or f'{prefix}{row}', 'prefix': prefix, 'row': row,
                    'column_start': 1 + k * per, 'floor': 1, 'origin': o, 'rotation': rotation, 'center_spacing': spacing,
                    'depth': 1.2, 'height': 3, 'levels': 3, 'has_bottom': False, 'has_boards': True, 'container_id': container})
    return out


def codes(issues, severity=None):
    return sorted(i['code'] for i in issues if severity is None or i['severity'] == severity)


def test_legacy_document_has_no_issues():
    legacy = json.loads((Path(__file__).parents[1] / 'app' / 'warehouse_layout.json').read_text(encoding='utf-8'))
    assert facility_issues(legacy, {}) == []


def test_clean_rack_row_has_no_issues():
    d = doc(rack_groups=rack_row([5, 5], 10))
    assert facility_issues(d, C) == []


def test_container_missing_and_capacity():
    d = doc(rack_groups=rack_row([5, 5], 1))
    d['rack_groups'][0]['container_id'] = 'gone'
    assert codes(facility_issues(d, C)) == ['container_missing']
    wide = {**C, 'c1': {**C['c1'], 'width': 2.5}}
    assert 'no_capacity' in codes(facility_issues(doc(rack_groups=rack_row([5, 5], 1)), wide))
    tall = {**C, 'c1': {**C['c1'], 'height': 1.0}}
    levels = [i.get('level') for i in facility_issues(doc(rack_groups=rack_row([5, 5], 1)), tall) if i['code'] == 'level_too_low']
    assert levels == [1, 2, 3]  # 有层板时顶层净空 3 − 2.04 = 0.96 m，同样放不下 1 m 高的容器


def test_out_of_bounds_and_overlap():
    assert 'facility_out_of_bounds' in codes(facility_issues(doc(rack_groups=rack_row([58, 5], 1)), C))
    rows = rack_row([5, 5], 3, row=1) + rack_row([6, 5.5], 1, row=2)
    assert codes(facility_issues(doc(rack_groups=rows), C), 'error').count('facility_overlap') >= 1
    # 同排相邻组共用立柱：不算重叠
    assert 'facility_overlap' not in codes(facility_issues(doc(rack_groups=rack_row([5, 5], 10, rotation=30)), C))


def test_rack_inside_ground_aisle_is_not_overlap():
    batch = {'id': 'g', 'prefix': 'G', 'floor': 1, 'origin': [5, 5], 'rotation': 0, 'width': 1.3, 'depth': 1.3,
             'rows': 2, 'cols': 4, 'aisle': 3.0, 'container_id': 'c2'}
    d = doc(ground_batches=[batch], rack_groups=rack_row([20, 5], 1))
    assert 'facility_overlap' not in codes(facility_issues(d, C))


def test_duplicate_names():
    rows = rack_row([5, 5], 1, row=1) + rack_row([5, 15], 1, row=1, key='other')
    issues = facility_issues(doc(rack_groups=rows), C)
    dup = [i for i in issues if i['code'] == 'duplicate_slot_name']
    assert dup and dup[0]['count'] == 6


def test_back_to_back_rows_are_reachable_from_their_aisles():
    rows = rack_row([5, 10], 4, row=1) + rack_row([5, 11.2], 4, row=2)
    issues = facility_issues(doc(rack_groups=rows), C)
    assert 'slot_unreachable' not in codes(issues)
    assert 'facility_overlap' not in codes(issues)


def test_tight_ground_grid_unreachable_summary_and_aisle_fix():
    batch = {'id': 'g', 'prefix': 'F', 'floor': 1, 'origin': [5, 5], 'rotation': 0, 'width': 1.3, 'depth': 1.3,
             'rows': 10, 'cols': 10, 'container_id': 'c2'}
    issues = facility_issues(doc(ground_batches=[batch]), C)
    warn = [i for i in issues if i['code'] == 'slot_unreachable']
    assert len(warn) == 1 and warn[0]['severity'] == 'warning' and warn[0]['count'] == 80
    assert len(warn[0]['names']) == 20 and warn[0]['names'][0] == 'F-02-01'
    assert codes(issues, 'error') == []
    assert 'slot_unreachable' not in codes(facility_issues(doc(ground_batches=[{**batch, 'aisle': 1.2}]), C))


def test_reference_vehicle_missing_warning():
    d = doc(rack_groups=rack_row([5, 5], 1))
    d['equipment'] = []
    assert codes(facility_issues(d, C)) == ['reference_vehicle_missing']
    assert reference_vehicle(d) is None
    assert reference_vehicle(doc())['depth'] == 1.0
    assert facility_issues({**doc(), 'equipment': []}, C) == []


def test_equipment_rules():
    d = doc()
    d['equipment'] += [
        {**deepcopy(FORKLIFT), 'id': 'v2'},  # duplicate SFL-CBD20-001
        {**deepcopy(FORKLIFT), 'id': 'v3', 'number': '003', 'timing': {'mode': 'speed', 'speed_mps': 0}},
        {'id': 'c', 'category': 'CHARGER', 'number': '01', 'floor': 1, 'position': [30, 1], 'rotation': 0,
         'timing': {'mode': 'production', 'production_value': 2, 'production_unit': 'day'}},
        {'id': 'x', 'category': 'NOPE', 'number': '1', 'floor': 1, 'position': [3, 3], 'rotation': 0, 'timing': {}},
        {**deepcopy(FORKLIFT), 'id': 'v4', 'number': '004', 'vehicle': {**FORKLIFT['vehicle'], 'lift_speed_mps': 0}},
        {'id': 'w', 'category': 'WRAPPER', 'number': '01', 'floor': 1, 'position': [59.5, 20], 'rotation': 0,
         'timing': {'mode': 'production', 'production_value': 5, 'production_unit': 'min'}},
    ]
    assert codes(facility_issues(d, C)) == ['duplicate_equipment', 'equipment_out_of_bounds', 'invalid_timing',
                                            'invalid_timing', 'invalid_vehicle', 'unknown_category']


def test_publish_snapshot_is_frozen():
    d = doc(rack_groups=rack_row([5, 5], 1))
    errors, prepared = publish_prepare(d, C)
    assert errors == [] and prepared['container_snapshots']['c1']['width'] == 1.0
    assert prepared['schema_version'] == '1.1' and 'container_snapshots' not in d
    changed = {**C, 'c1': {**C['c1'], 'width': 0.6}}
    assert containers_for(prepared, changed, published=True)['c1']['width'] == 1.0
    assert containers_for(prepared, changed, published=False)['c1']['width'] == 0.6
    errors, _ = publish_prepare(doc(rack_groups=rack_row([58, 5], 1)), C)
    assert 'facility_out_of_bounds' in codes(errors)


def test_50k_positions_validate_under_budget():
    small = {**C, 'c1': {**C['c1'], 'width': 0.6, 'depth': 0.4, 'height': 0.3}}
    rows = []
    for r in range(21):
        rows += rack_row([2, 2 + r * 4.2], 40, row=r + 1, container='c1', templates=small)
    for g in rows:
        g.update(levels=15, height=7.5)
    d = doc(width=110, depth=92, rack_groups=rows)
    start = time.perf_counter()
    issues = facility_issues(d, small)
    elapsed = time.perf_counter() - start
    slots = 21 * 40 * 4 * 15
    assert slots >= 50_000
    assert codes(issues, 'error') == [], issues[:3]
    assert elapsed < 5, elapsed
