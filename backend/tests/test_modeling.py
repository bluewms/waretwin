"""建模几何规则（app/modeling.py）。与 frontend/tests/modeling.test.ts 共用 fixtures/modeling_cases.json。"""
import json
import math
import time
from pathlib import Path

import pytest

from app import modeling as M

CASES = json.loads((Path(__file__).parent / 'fixtures' / 'modeling_cases.json').read_text(encoding='utf-8'))


def close(actual, expected, tol=1e-9):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(close(actual[k], expected[k], tol) for k in expected)
    if isinstance(expected, (list, tuple)):
        return isinstance(actual, (list, tuple)) and len(actual) == len(expected) and all(close(a, e, tol) for a, e in zip(actual, expected))
    if isinstance(expected, float) or (isinstance(expected, int) and not isinstance(expected, bool) and isinstance(actual, float)):
        return isinstance(actual, (int, float)) and not isinstance(actual, bool) and abs(actual - expected) <= tol
    return actual == expected


def test_shared_cases():
    for case in CASES:
        result = getattr(M, case['fn'])(*case['args'])
        assert close(result, case['expected']), (case['fn'], case['args'], result)


# ── Task 1 ─────────────────────────────────────────────
def test_rack_widths():
    assert close(M.rack_widths(2.5, 1), {'clear': 2.4, 'group_outer': 2.6, 'row_outer': 2.6})
    assert close(M.rack_widths(2.5, 10)['row_outer'], 25.1)


def test_level_slots():
    r = M.level_slots(2.4, 1.0)
    assert r['count'] == 2
    assert close(r['gap'], 0.4 / 3)
    assert close(r['offsets'], [0.4 / 3 + 0.5, 0.4 / 3 * 2 + 1.5])


def test_exact_division_capacity():
    for clear, width, n in ((2.4, 1.2, 2), (3.6, 1.2, 3), (0.3, 0.1, 3)):
        r = M.level_slots(clear, width)
        assert r['count'] == n, (clear, width, r)
        assert close(r['gap'], 0.0, 1e-9)


def test_container_wider_than_clear():
    assert M.level_slots(0.9, 1.0) == {'count': 0, 'gap': None, 'offsets': []}


def test_rack_column_centers_symmetric():
    xs = M.rack_column_centers(2.5, 2, 1.0)
    g = 0.4 / 3
    assert close(xs, [0.1 + g + 0.5, 0.1 + 2 * g + 1.5, 2.6 + g + 0.5, 2.6 + 2 * g + 1.5])
    assert close(M.rack_widths(2.5, 2)['row_outer'] - xs[-1], xs[0])


def test_rejects_invalid_rack():
    for args in ((0, 1), (2.5, 0), (2.5, 1.5), (math.nan, 1), (True, 1), (0.1, 1), (-2.5, 1), (math.inf, 1)):
        with pytest.raises(ValueError):
            M.rack_widths(*args)
    with pytest.raises(ValueError):
        M.level_slots(2.4, 0)


# ── Task 2 ─────────────────────────────────────────────
def test_level_support_heights():
    assert close(M.level_support_heights(3, 3, False, False), [0.0, 1.0, 2.0])
    assert close(M.level_support_heights(3, 3, True, True), [0.14, 1.04, 2.04])
    assert close(M.level_support_heights(3, 3, True, False), [0.1, 1.0, 2.0])
    assert close(M.level_support_heights(3, 3, False, True), [0.0, 1.04, 2.04])


def test_bottom_option_keeps_level_count():
    for bottom in (True, False):
        for boards in (True, False):
            assert len(M.level_support_heights(3, 3, bottom, boards)) == 3


def test_level_clear_heights():
    assert close(M.level_clear_heights(3, 3, False, False), [0.9, 0.9, 1.0])
    assert close(M.level_clear_heights(2, 1, False, False), [2.0])


RACK = {'center_spacing': 2.5, 'groups': 1, 'depth': 1.2, 'height': 3, 'levels': 3,
        'has_bottom': False, 'has_boards': False}


def test_rack_issues():
    assert M.rack_issues(RACK, {'width': 1.1, 'depth': 1.2, 'height': 1.0}) == [
        {'code': 'level_too_low', 'level': 1}, {'code': 'level_too_low', 'level': 2}]
    assert M.rack_issues(RACK, {'width': 1.1, 'depth': 1.2, 'height': 0.8}) == []
    assert {'code': 'container_too_deep'} in M.rack_issues(RACK, {'width': 1.1, 'depth': 1.3, 'height': 0.8})
    assert {'code': 'no_capacity'} in M.rack_issues(RACK, {'width': 2.5, 'depth': 1.2, 'height': 0.8})
    assert M.rack_issues(RACK, {'width': 1.1, 'depth': 1.2, 'height': 0.5}, 0.5) == [
        {'code': 'level_too_low', 'level': 1}, {'code': 'level_too_low', 'level': 2}]


def test_rejects_invalid_levels():
    for levels in (0, 1.5, True, -1):
        with pytest.raises(ValueError):
            M.level_support_heights(3, levels, False, False)
    with pytest.raises(ValueError):
        M.level_support_heights(3, 3, 'yes', False)


# ── Task 3 ─────────────────────────────────────────────
def test_ground_centers():
    cells = M.ground_centers(1.3, 1.3, 10, 10)
    assert len(cells) == 100
    assert close(cells[0], {'row': 0, 'col': 0, 'x': 0.65, 'z': 0.65})
    assert close(cells[-1], {'row': 9, 'col': 9, 'x': 12.35, 'z': 12.35})
    assert close(M.ground_centers(1.3, 1.3, 2, 1, 3)[1]['z'], 4.95)
    with pytest.raises(ValueError):
        M.ground_centers(1.3, 1.3, 2, 1, -1)


def test_ground_issues():
    assert M.ground_issues(1.3, 1.3, {'width': 1.1, 'depth': 1.1, 'height': 0.15}) == []
    assert M.ground_issues(1.3, 1.3, {'width': 1.4, 'depth': 1.1, 'height': 0.15}) == [{'code': 'container_too_large'}]
    assert M.ground_issues(1.1, 1.1, {'width': 1.1, 'depth': 1.1, 'height': 0.15}) == []


def test_rotation_matches_navgrid():
    assert close(M.to_world(0, 0, 90, 1, 0), [0.0, 1.0])
    assert close(M.to_world(10, 5, 0, 2, 3), [12.0, 8.0])
    assert close(M.to_world(0, 0, 180, 1, 0), [-1.0, 0.0])
    assert close(M.to_world(0, 0, -90, 1, 0), [0.0, -1.0])
    a = math.radians(30)
    assert close(M.to_world(1, 2, 30, 3, 4), [1 + 3 * math.cos(a) - 4 * math.sin(a), 2 + 3 * math.sin(a) + 4 * math.cos(a)])


def test_slot_names():
    assert M.rack_slot_name('N', 1, 2, 3) == 'N-01-02-3'
    assert M.rack_slot_name('A', 12, 105, 1) == 'A-12-105-1'
    assert M.ground_slot_name('F', 1, 2) == 'F-01-02'
    assert M.rack_slot_name('N', 1, 2, 3, 3) == 'N-001-002-3'
    for args in (('', 1, 1, 1), ('N', 0, 1, 1), ('N', 1, 1, 0), (None, 1, 1, 1)):
        with pytest.raises(ValueError):
            M.rack_slot_name(*args)


# ── Task 4 ─────────────────────────────────────────────
def test_stop_points():
    r = M.stop_points(1.2, 0.75, 1.0)
    assert close(r, {'above': [0.75, -0.6], 'below': [0.75, 1.8]})
    assert close(M.stop_points(1.2, 0.75, 1.0, 0)['below'], [0.75, 1.7])


def test_footprint():
    assert close(M.footprint(0, 0, 0, 2, 1), [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]])
    q = M.footprint(0, 0, 90, 2, 1)
    assert close(max(abs(p[0]) for p in q), 0.5) and close(max(abs(p[1]) for p in q), 1.0)
    assert close(M.footprint(0, 0, 0, 2, 1, 0.1)[0], [-1.1, -0.6])


RACK_A = [[0, 0], [2.6, 0], [2.6, 1.2], [0, 1.2]]


def test_touching_is_not_overlap():
    assert not M.quads_overlap(RACK_A, M.footprint(1.3, -0.6, 0, 2, 1, 0.1))


def test_one_cm_overlap_detected():
    neighbour = [[0, -2.39], [2.6, -2.39], [2.6, -1.19], [0, -1.19]]
    assert M.quads_overlap(neighbour, M.footprint(1.3, -0.6, 0, 2, 1, 0.1))


def test_rotated_overlap():
    assert M.quads_overlap(M.footprint(0, 0, 45, 2, 2), M.footprint(1.6, 0, 0, 1, 1))
    assert not M.quads_overlap(M.footprint(0, 0, 45, 2, 2), M.footprint(2.0, 0, 0, 1, 1))


BOUNDS = [[0, 0], [50, 0], [50, 50], [0, 50]]


def test_back_to_back():
    rack_b = [[10, 11.2], [12.6, 11.2], [12.6, 12.4], [10, 12.4]]
    cand = {'above': M.footprint(11.3, 9.4, 0, 2, 1, 0.1), 'below': M.footprint(11.3, 11.8, 0, 2, 1, 0.1)}
    assert M.side_availability(cand, [rack_b], BOUNDS) == {'above': True, 'below': False}


def test_out_of_bounds():
    cand = {'above': M.footprint(1.3, -0.6, 0, 2, 1, 0.1), 'below': M.footprint(1.3, 1.8, 0, 2, 1, 0.1)}
    assert M.side_availability(cand, [], BOUNDS) == {'above': False, 'below': True}


def test_concave_bounds():
    l_shape = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]
    across_notch = [[7, 4], [4, 7], [3, 6], [6, 3]]
    assert not M.polygon_contains(l_shape, across_notch)
    assert M.polygon_contains(l_shape, [[1, 1], [4, 1], [4, 4], [1, 4]])
    assert M.polygon_contains(l_shape, [[0, 0], [5, 0], [5, 5], [0, 5]])


# ── Task 5 ─────────────────────────────────────────────
def test_timing():
    assert M.to_seconds(5, 'min') == 300
    assert M.to_seconds(2, 'h') == 7200
    assert M.to_seconds(30, 's') == 30
    for args in ((0, 's'), (1, 'day'), (-1, 'min')):
        with pytest.raises(ValueError):
            M.to_seconds(*args)
    assert close(M.travel_seconds(10, 0.5), 20.0)
    assert close(M.travel_seconds(3, 0.5), 6.0)
    with pytest.raises(ValueError):
        M.travel_seconds(1, 0)


def test_handling_seconds():
    assert close(M.handling_seconds(15, 2, 0.2), 35.0)
    assert close(M.handling_seconds(15, 0, 0.2), 15.0)
    assert close(M.handling_seconds(15, 2, None), 15.0)
    with pytest.raises(ValueError):
        M.handling_seconds(15, 2, 0)
    with pytest.raises(ValueError):
        M.handling_seconds(-1, 2, 0.2)


# ── Task 6 ─────────────────────────────────────────────
GROUP = {'prefix': 'N', 'row': 1, 'origin': [5, 5], 'rotation': 0, 'center_spacing': 2.5, 'groups': 10,
         'depth': 1.2, 'height': 3, 'levels': 3, 'has_bottom': False, 'has_boards': True}
BOX = {'width': 1.0, 'depth': 1.0, 'height': 0.8}


def test_expand_rack_group():
    r = M.expand_rack_group(GROUP, BOX)
    assert len(r['slots']) == 60
    assert r['slots'][0]['name'] == 'N-01-01-1' and r['slots'][-1]['name'] == 'N-01-20-3'
    assert len({s['name'] for s in r['slots']}) == 60
    xs = [p[0] for p in r['outline']]
    assert close(max(xs) - min(xs), 25.1)
    first = r['slots'][0]
    assert close(first['center'], [5 + 0.1 + 0.4 / 3 + 0.5, 0.4, 5.6]) and first['group'] == 1
    assert r['slots'][-1]['group'] == 10
    assert close(r['slots'][2]['center'][1], 2.04 + 0.4)
    col = r['columns'][0]
    assert close(col['stops']['above']['position'], [first['center'][0], 5 - 0.6])
    assert close(col['stops']['below']['position'], [first['center'][0], 5 + 1.8])
    assert col['stops']['above']['heading'] == 0
    assert r['issues'] == []


def test_expand_rack_group_rotated():
    flat = M.expand_rack_group(GROUP, BOX)
    turned = M.expand_rack_group({**GROUP, 'rotation': 90}, BOX)
    for a, b in zip(flat['slots'], turned['slots']):
        lx, lz = a['center'][0] - 5, a['center'][2] - 5
        assert close([b['center'][0], b['center'][2]], M.to_world(5, 5, 90, lx, lz))
        assert close(b['center'][1], a['center'][1])
    assert turned['columns'][3]['stops']['above']['heading'] == 90
    sp = flat['columns'][3]['stops']['below']['position']
    assert close(turned['columns'][3]['stops']['below']['position'], M.to_world(5, 5, 90, sp[0] - 5, sp[1] - 5))


def _reachability(batch):
    r = M.expand_ground_batch(batch, {'width': 1.1, 'depth': 1.1, 'height': 0.15})
    cells = r['cells']
    out = []
    for i, col in enumerate(r['columns']):
        obstacles = cells[:i] + cells[i + 1:]
        out.append(M.side_availability(col['footprints'], obstacles, BOUNDS))
    return r, out


BATCH = {'prefix': 'F', 'origin': [5, 5], 'rotation': 0, 'width': 1.3, 'depth': 1.3, 'rows': 10, 'cols': 10}


def test_expand_ground_batch_tight_grid():
    r, sides = _reachability(BATCH)
    assert len(r['slots']) == 100 and len({s['name'] for s in r['slots']}) == 100
    assert r['slots'][0]['name'] == 'F-01-01' and r['slots'][-1]['name'] == 'F-10-10'
    assert close(r['slots'][0]['center'], [5.65, 0.075, 5.65])
    for i, s in enumerate(sides):
        row = i // 10
        if row == 0:
            assert s == {'above': True, 'below': False}
        elif row == 9:
            assert s == {'above': False, 'below': True}
        else:
            assert s == {'above': False, 'below': False}


def test_expand_ground_batch_with_aisle():
    r, sides = _reachability({**BATCH, 'aisle': 1.2})
    assert all(s['above'] or s['below'] for s in sides)
    zs = [p[1] for p in r['outline']]
    assert close(max(zs) - min(zs), 10 * 1.3 + 9 * 1.2)


# ── Task 7 ─────────────────────────────────────────────
def test_expand_50k_under_budget():
    group = {**GROUP, 'groups': 834, 'center_spacing': 2.5, 'levels': 15, 'height': 7.5}
    box = {'width': 0.6, 'depth': 0.4, 'height': 0.3}
    start = time.perf_counter()
    r = M.expand_rack_group(group, box)
    elapsed = time.perf_counter() - start
    assert len(r['slots']) >= 50_000
    assert elapsed < 3, elapsed
