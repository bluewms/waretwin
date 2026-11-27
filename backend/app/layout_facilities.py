"""设施校验与发布准备（开发说明第二至第七节、第十节）。纯函数，只依赖 modeling.py 与标准库。

问题格式：{path, code, message, severity, object_id?, count?, names?}。
severity 为 error（阻止发布）或 warning（仅提示：slot_unreachable、reference_vehicle_missing）。
"""
from __future__ import annotations

import json
import math
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from . import modeling as M

SCHEMA_VERSION = '1.1'
MAX_LISTED_NAMES = 20
TIME_UNITS = tuple(M.UNIT_SECONDS)
COLLECTIONS = ('rack_groups', 'ground_batches', 'equipment')


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    return json.loads(Path(__file__).with_name('equipment_catalog.json').read_text(encoding='utf-8'))


def catalog_index(catalog: Optional[dict] = None) -> dict[str, dict]:
    return {c['code']: c for c in (catalog or load_catalog())['categories']}


def referenced_containers(document: dict) -> set[str]:
    return {item.get('container_id') for key in ('rack_groups', 'ground_batches')
            for item in (document.get(key) or []) if isinstance(item, dict) and isinstance(item.get('container_id'), str)}


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _floor_bounds(document: dict, floor: int) -> list:
    for f in document.get('floors') or []:
        if f.get('id') == floor and f.get('footprint'):
            return [list(p) for p in f['footprint']]
    size = document.get('size') or {}
    w, d = size.get('width', 0), size.get('depth', 0)
    return [[0, 0], [w, 0], [w, d], [0, d]]


def _elevation(document: dict, floor: int) -> float:
    for f in document.get('floors') or []:
        if f.get('id') == floor:
            return f.get('elevation', 0) or 0
    return 0


def _rect(x0, z0, x1, z1) -> list:
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]


def equipment_size(item: dict, category: dict) -> tuple[float, float]:
    vehicle = item.get('vehicle') or {}
    if category.get('kind') == 'vehicle' and _finite(vehicle.get('width')) and _finite(vehicle.get('depth')):
        return float(vehicle['width']), float(vehicle['depth'])
    size = item.get('size') or {}
    w = size.get('width') if _finite(size.get('width')) and size['width'] > 0 else category['size']['width']
    d = size.get('depth') if _finite(size.get('depth')) and size['depth'] > 0 else category['size']['depth']
    return float(w), float(d)


def reference_vehicle(document: dict, catalog: Optional[dict] = None) -> Optional[dict]:
    """本仓库车身深度最大的车辆；没有车辆时返回 None（调用方使用默认 2.0 × 1.0 并给出警告）。"""
    cats = catalog_index(catalog)
    best = None
    for item in document.get('equipment') or []:
        cat = cats.get(item.get('category')) if isinstance(item, dict) else None
        if not cat or cat.get('kind') != 'vehicle':
            continue
        try:
            w, d = equipment_size(item, cat)
        except (TypeError, KeyError):
            continue
        if w > 0 and d > 0 and (best is None or d > best['depth']):
            best = {'width': w, 'depth': d, 'id': item.get('id')}
    return best


def expand_document(document: dict, containers: dict, catalog: Optional[dict] = None) -> dict:
    """展开所有货架组与地面库位批次。返回 {facilities, vehicle, vehicle_missing, issues}。"""
    issues: list[dict] = []
    vehicle = reference_vehicle(document, catalog)
    size = {'width': vehicle['width'], 'depth': vehicle['depth']} if vehicle else dict(M.DEFAULT_VEHICLE)
    gap = document.get('stop_gap', M.DEFAULT_GAP)
    if not _finite(gap) or gap < 0:
        issues.append(_issue('stop_gap', 'invalid_stop_gap', 'Stop gap must be a non-negative number of metres'))
        gap = M.DEFAULT_GAP
    facilities = []
    for key, kind in (('rack_groups', 'rack'), ('ground_batches', 'ground')):
        items = document.get(key)
        if items is None:
            continue
        if not isinstance(items, list):
            issues.append(_issue(key, 'collection', f'{key} must be a list'))
            continue
        for i, item in enumerate(items):
            path = f'{key}[{i}]'
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id']:
                issues.append(_issue(path, 'invalid_facility', 'Facility must be an object with an id'))
                continue
            container = containers.get(item.get('container_id'))
            if container is None:
                issues.append(_issue(path, 'container_missing', 'Bound container template does not exist', item['id']))
                continue
            floor = item.get('floor', 1)
            spec = {**item, 'elevation': _elevation(document, floor), 'gap': gap}
            try:
                if kind == 'rack':
                    result = M.expand_rack_group({**spec, 'groups': 1}, container, size)
                else:
                    result = M.expand_ground_batch(spec, container, size)
                    cargo = item.get('cargo_height', 0) or 0
                    if not _finite(cargo) or cargo < 0:
                        raise ValueError('cargo_height must not be negative')
            except (ValueError, TypeError) as exc:
                issues.append(_issue(path, 'invalid_facility', str(exc), item['id']))
                continue
            if kind == 'rack':
                rack_spec = {**item, 'groups': 1}
                result['issues'] = M.rack_issues(rack_spec, container, item.get('cargo_height', 0) or 0)
            for problem in result['issues']:
                text = {'no_capacity': 'Container is wider than the clear width between posts',
                        'container_too_deep': 'Container is deeper than the rack',
                        'level_too_low': f"Level {problem.get('level')} is too low for the container and cargo",
                        'container_too_large': 'Container is larger than the location'}[problem['code']]
                issues.append({**_issue(path, problem['code'], text, item['id']), **({'level': problem['level']} if 'level' in problem else {})})
            facilities.append({'kind': kind, 'path': path, 'item': item, 'floor': floor, 'result': result})
    return {'facilities': facilities, 'vehicle': size, 'vehicle_missing': vehicle is None, 'issues': issues}


def _issue(path: str, code: str, message: str, object_id: Optional[str] = None, severity: str = 'error') -> dict:
    out = {'path': path, 'code': code, 'message': message, 'severity': severity}
    if object_id:
        out['object_id'] = object_id
    return out


def _equipment_issues(document: dict, cats: dict) -> tuple[list[dict], list[tuple]]:
    issues, shapes, seen = [], [], {}
    items = document.get('equipment')
    if items is None:
        return issues, shapes
    if not isinstance(items, list):
        return [_issue('equipment', 'collection', 'equipment must be a list')], shapes
    for i, item in enumerate(items):
        path = f'equipment[{i}]'
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id']:
            issues.append(_issue(path, 'invalid_equipment', 'Equipment must be an object with an id'))
            continue
        oid = item['id']
        cat = cats.get(item.get('category'))
        if cat is None:
            issues.append(_issue(path, 'unknown_category', 'Equipment category is not in the catalog', oid))
            continue
        number = item.get('number')
        if not isinstance(number, str) or not number.strip() or len(number.strip()) > 40:
            issues.append(_issue(path, 'equipment_number', 'Equipment number is required', oid))
        else:
            key = (cat['code'], number.strip())
            if key in seen:
                issues.append(_issue(path, 'duplicate_equipment', f'{cat["code"]}-{number.strip()} is used twice', oid))
            seen[key] = oid
        pos = item.get('position')
        if not (isinstance(pos, list) and len(pos) == 2 and all(_finite(v) for v in pos)) or not _finite(item.get('rotation', 0)):
            issues.append(_issue(path, 'invalid_position', 'Equipment position and rotation must be numbers', oid))
            continue
        timing = item.get('timing') or {}
        mode = timing.get('mode')
        if mode == 'speed':
            if not _finite(timing.get('speed_mps')) or timing['speed_mps'] <= 0:
                issues.append(_issue(path, 'invalid_timing', 'Running speed must be greater than zero', oid))
        elif mode == 'production':
            if not _finite(timing.get('production_value')) or timing['production_value'] <= 0 \
                    or timing.get('production_unit') not in TIME_UNITS:
                issues.append(_issue(path, 'invalid_timing', 'Production time must be greater than zero with unit s, min or h', oid))
        else:
            issues.append(_issue(path, 'invalid_timing', 'Timing mode must be speed or production', oid))
        if cat['kind'] == 'vehicle':
            v = item.get('vehicle') or {}
            ok = all(_finite(v.get(k)) and v[k] > 0 for k in ('width', 'depth')) \
                and all(_finite(v.get(k)) and v[k] >= 0 for k in ('pick_s', 'drop_s')) \
                and (v.get('lift_speed_mps') is None or (_finite(v['lift_speed_mps']) and v['lift_speed_mps'] > 0)) \
                and _finite(v.get('low_battery_pct')) and 0 < v['low_battery_pct'] < 100
            if not ok:
                issues.append(_issue(path, 'invalid_vehicle', 'Vehicle size, handling times, lift speed or battery threshold are invalid', oid))
                continue
        try:
            w, d = equipment_size(item, cat)
            quad = M.footprint(pos[0], pos[1], item.get('rotation', 0), w, d)
        except (ValueError, TypeError, KeyError):
            issues.append(_issue(path, 'invalid_equipment', 'Equipment size is invalid', oid))
            continue
        shapes.append((path, oid, item.get('floor', 1), quad, cat['kind']))
    return issues, shapes


def _static_obstacles(document: dict, floor: int) -> list[tuple[list, str]]:
    out = []
    for r in document.get('racks') or []:
        if (r.get('floor') or 1) == floor:
            try:
                x, _, z = r['position']; w, _, d = r['size']
                out.append((M.footprint(x + w / 2, z + d / 2, 0, w, d) if not r.get('rotation') else
                            [M.to_world(x, z, r['rotation'], px, pz) for px, pz in ((0, 0), (w, 0), (w, d), (0, d))], f"racks:{r.get('id')}"))
            except (KeyError, TypeError, ValueError):
                pass
    for key in ('obstacles', 'stations'):
        for o in document.get(key) or []:
            if (o.get('floor') or 1) == floor and isinstance(o.get('rect'), list) and len(o['rect']) == 4:
                out.append((_rect(*o['rect']), f"{key}:{o.get('id')}"))
    for o in document.get('restricted_areas') or []:
        if (o.get('floor') or 1) == floor and not o.get('robots_allowed') and isinstance(o.get('rect'), list):
            out.append((_rect(*o['rect']), f"restricted:{o.get('id')}"))
    if floor == 1:
        for i, c in enumerate(document.get('columns') or []):
            out.append((_rect(c[0] - .45, c[1] - .45, c[0] + .45, c[1] + .45), f'columns:{i}'))
    return out


def facility_issues(document: dict, containers: dict, catalog: Optional[dict] = None) -> list[dict]:
    if not isinstance(document, dict):
        return [_issue('', 'document', 'Layout must be an object')]
    cats = catalog_index(catalog)
    expanded = expand_document(document, containers, catalog)
    issues = list(expanded['issues'])
    eq_issues, eq_shapes = _equipment_issues(document, cats)
    issues += eq_issues
    facilities = expanded['facilities']

    # 名称唯一
    owners: dict[str, str] = {}
    duplicates: dict[str, list[str]] = {}
    for f in facilities:
        for slot in f['result']['slots']:
            if slot['name'] in owners:
                duplicates.setdefault(f['path'], []).append(slot['name'])
            else:
                owners[slot['name']] = f['path']
    for path, names in duplicates.items():
        issues.append({**_issue(path, 'duplicate_slot_name', f'{len(names)} storage names are already used elsewhere'),
                       'count': len(names), 'names': names[:MAX_LISTED_NAMES]})

    floors = sorted({f['floor'] for f in facilities} | {s[2] for s in eq_shapes})
    for floor in floors:
        bounds = _floor_bounds(document, floor)
        index = M.SpatialIndex(2.0)
        outlines = []  # (path, object_id, quad, group_key)
        for f in (x for x in facilities if x['floor'] == floor):
            item = f['item']
            if f['kind'] == 'rack':
                outlines.append((f['path'], item['id'], f['result']['outline'], f"row:{item.get('row_key') or item['id']}"))
                index.add(f['result']['outline'], ('rack', item['id'], item.get('row_key') or item['id']))
            else:
                if not M.polygon_contains(bounds, f['result']['outline']):
                    issues.append(_issue(f['path'], 'facility_out_of_bounds', 'Facility lies outside the floor', item['id']))
                for ci, cell in enumerate(f['result']['cells']):
                    index.add(cell, ('cell', item['id'], ci))
                    # 逐格检查重叠：批次外框包含行间通道，不能用来判断与其他设施是否重叠
                    outlines.append((f['path'], item['id'], cell, f"batch:{item['id']}"))
        for path, oid, efloor, quad, kind in eq_shapes:
            if efloor != floor:
                continue
            if not M.polygon_contains(bounds, quad):
                issues.append(_issue(path, 'equipment_out_of_bounds', 'Equipment lies outside the floor', oid))
            if kind != 'vehicle':
                index.add(quad, ('equipment', oid, None))
                outlines.append((path, oid, quad, f'eq:{oid}'))
        for quad, tag in _static_obstacles(document, floor):
            index.add(quad, ('static', tag, None))

        reported = set()
        for path, oid, quad, group in outlines:
            if group.startswith('row:') and not M.polygon_contains(bounds, quad):
                issues.append(_issue(path, 'facility_out_of_bounds', 'Facility lies outside the floor', oid))
            for other, tag in index.query(quad):
                other_group = {'rack': f'row:{tag[2]}', 'cell': f'batch:{tag[1]}', 'equipment': f'eq:{tag[1]}'}.get(tag[0], tag[1])
                if other_group == group or tag[1] == oid:
                    continue
                pair = tuple(sorted((oid, str(tag[1]))))
                if pair in reported or not M.quads_overlap(quad, other):
                    continue
                reported.add(pair)
                issues.append(_issue(path, 'facility_overlap', f'Overlaps {tag[1]}', oid))

        # 可用侧与不可达
        for f in (x for x in facilities if x['floor'] == floor):
            item, result = f['item'], f['result']
            levels = len(result['slots']) // max(1, len(result['columns']))
            blocked_names, blocked = [], 0
            for ci, col in enumerate(result['columns']):
                own = ('rack', item['id']) if f['kind'] == 'rack' else ('cell', item['id'], ci)
                sides = {}
                for side, quad in col['footprints'].items():
                    ok = M.polygon_contains(bounds, quad)
                    if ok:
                        for other, tag in index.query(quad):
                            if tag[:len(own)] == own or (f['kind'] == 'rack' and tag[0] == 'rack' and tag[2] == (item.get('row_key') or item['id'])):
                                continue
                            if M.quads_overlap(quad, other):
                                ok = False
                                break
                    sides[side] = ok
                col['available'] = sides
                if not any(sides.values()):
                    blocked += levels
                    start = ci * levels
                    blocked_names += [s['name'] for s in result['slots'][start:start + levels]][:MAX_LISTED_NAMES - len(blocked_names)]
            if blocked:
                issues.append({**_issue(f['path'], 'slot_unreachable', f'{blocked} storage positions have no reachable stop point',
                                        item['id'], 'warning'), 'count': blocked, 'names': blocked_names})

    if facilities and expanded['vehicle_missing']:
        issues.append(_issue('equipment', 'reference_vehicle_missing',
                             'No vehicle has been added; stop points use the default 2.0 × 1.0 m body', severity='warning'))
    return issues


def publish_prepare(document: dict, containers: dict, catalog: Optional[dict] = None) -> tuple[list[dict], dict]:
    """返回 (阻止发布的错误, 待发布文档)。待发布文档写入所引用容器模板的快照。"""
    issues = facility_issues(document, containers, catalog)
    errors = [i for i in issues if i['severity'] == 'error']
    prepared = deepcopy(document)
    if any(prepared.get(k) for k in COLLECTIONS):
        prepared['schema_version'] = SCHEMA_VERSION
    snapshots = {}
    for cid in sorted(referenced_containers(document)):
        if cid in containers:
            t = containers[cid]
            snapshots[cid] = {k: t[k] for k in ('id', 'name', 'type', 'color', 'width', 'depth', 'height') if k in t}
    if snapshots:
        prepared['container_snapshots'] = snapshots
    return errors, prepared


def containers_for(document: dict, templates: dict, published: bool) -> dict:
    """已发布版本使用自身快照；草稿使用组织当前模板（快照只作缺失时的后备）。"""
    snaps = document.get('container_snapshots') or {}
    return {**templates, **snaps} if published else {**snaps, **templates}
