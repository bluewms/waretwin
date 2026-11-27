"""建模几何规则：纯函数，无外部依赖。与 frontend/src/layout/modeling.ts 一一对应。

规则来源：plan/后台设施与容器管理开发说明.md 第三至第七节。
单位：米、秒、度。设施局部原点为网格外框起点；0° 时 X 为宽度方向、Z 为深度方向。
旋转公式与导航网格一致：x = x0 + lx·cosθ − lz·sinθ，z = z0 + lx·sinθ + lz·cosθ。
"""
from __future__ import annotations

import math
from typing import Any, Optional

POST_WIDTH = 0.1        # 立柱截面宽
BEAM_HEIGHT = 0.1       # 横梁高
BOARD_THICKNESS = 0.04  # 层板厚
EPS = 1e-9              # 统一尺寸精度（整除与放得下的判断）
OVERLAP_EPS = 1e-6      # 重叠判断容差：贴边不算重叠
DEFAULT_GAP = 0.1       # 车身与设施之间的安全间隙
DEFAULT_VEHICLE = {'width': 2.0, 'depth': 1.0}
UNIT_SECONDS = {'s': 1, 'min': 60, 'h': 3600}

Point = list  # [x, z]


# ── 输入校验 ─────────────────────────────────────────────
def _number(name: str, value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{name} must be a finite number')
    return float(value)


def _positive(name: str, value: Any) -> float:
    value = _number(name, value)
    if value <= 0:
        raise ValueError(f'{name} must be positive')
    return value


def _non_negative(name: str, value: Any) -> float:
    value = _number(name, value)
    if value < 0:
        raise ValueError(f'{name} must not be negative')
    return value


def _positive_int(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or value != int(value) or value < 1:
        raise ValueError(f'{name} must be a positive integer')
    return int(value)


def _flag(name: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f'{name} must be true or false')
    return value


def _size(name: str, item: dict) -> tuple[float, float, float]:
    return (_positive(f'{name}.width', item.get('width')), _positive(f'{name}.depth', item.get('depth')),
            _positive(f'{name}.height', item.get('height')))


# ── 第三、四节：货架宽度与每层容量 ─────────────────────────
def rack_widths(center_spacing: float, groups: int, post: float = POST_WIDTH) -> dict:
    w, g, t = _positive('center_spacing', center_spacing), _positive_int('groups', groups), _positive('post', post)
    clear = w - t
    if clear <= EPS:
        raise ValueError('center_spacing must exceed the post width')
    return {'clear': clear, 'group_outer': w + t, 'row_outer': g * w + t}


def level_slots(clear_width: float, container_width: float) -> dict:
    W, c = _positive('clear_width', clear_width), _positive('container_width', container_width)
    n = math.floor(W / c + EPS)
    if n < 1:
        return {'count': 0, 'gap': None, 'offsets': []}
    gap = max(0.0, (W - n * c) / (n + 1))
    return {'count': n, 'gap': gap, 'offsets': [gap + c / 2 + i * (c + gap) for i in range(n)]}


def rack_column_centers(center_spacing: float, groups: int, container_width: float, post: float = POST_WIDTH) -> list[float]:
    widths = rack_widths(center_spacing, groups, post)
    offsets = level_slots(widths['clear'], container_width)['offsets']
    w = float(center_spacing)
    return [post + k * w + off for k in range(int(groups)) for off in offsets]


# ── 第三节：层支承高度与净空 ───────────────────────────────
def level_support_heights(height: float, levels: int, has_bottom: bool, has_boards: bool) -> list[float]:
    H, L = _positive('height', height), _positive_int('levels', levels)
    board = BOARD_THICKNESS if _flag('has_boards', has_boards) else 0.0
    s = H / L
    first = BEAM_HEIGHT + board if _flag('has_bottom', has_bottom) else 0.0
    return [first] + [j * s + board for j in range(1, L)]


def level_clear_heights(height: float, levels: int, has_bottom: bool, has_boards: bool) -> list[float]:
    support = level_support_heights(height, levels, has_bottom, has_boards)
    H, L = float(height), int(levels)
    s = H / L
    return [((j + 1) * s - BEAM_HEIGHT if j < L - 1 else H) - support[j] for j in range(L)]


def rack_issues(rack: dict, container: dict, cargo_height: float = 0) -> list[dict]:
    widths = rack_widths(rack.get('center_spacing'), rack.get('groups'))
    depth = _positive('rack.depth', rack.get('depth'))
    cw, cd, ch = _size('container', container)
    cargo = _non_negative('cargo_height', cargo_height)
    issues: list[dict] = []
    if level_slots(widths['clear'], cw)['count'] == 0:
        issues.append({'code': 'no_capacity'})
    if cd > depth + EPS:
        issues.append({'code': 'container_too_deep'})
    clear = level_clear_heights(rack.get('height'), rack.get('levels'), rack.get('has_bottom'), rack.get('has_boards'))
    issues += [{'code': 'level_too_low', 'level': j + 1} for j, c in enumerate(clear) if ch + cargo > c + EPS]
    return issues


# ── 第五节：地面库位网格 ─────────────────────────────────
def ground_centers(width: float, depth: float, rows: int, cols: int, aisle: float = 0) -> list[dict]:
    W, D = _positive('width', width), _positive('depth', depth)
    R, C, A = _positive_int('rows', rows), _positive_int('cols', cols), _non_negative('aisle', aisle)
    return [{'row': r, 'col': c, 'x': (c + 0.5) * W, 'z': r * (D + A) + 0.5 * D} for r in range(R) for c in range(C)]


def ground_issues(width: float, depth: float, container: dict) -> list[dict]:
    W, D = _positive('width', width), _positive('depth', depth)
    cw, cd, _ = _size('container', container)
    return [{'code': 'container_too_large'}] if cw > W + EPS or cd > D + EPS else []


# ── 坐标变换与命名 ───────────────────────────────────────
def _cos_sin(rotation_deg: float) -> tuple[float, float]:
    deg = _number('rotation', rotation_deg) % 360
    exact = {0: (1.0, 0.0), 90: (0.0, 1.0), 180: (-1.0, 0.0), 270: (0.0, -1.0)}
    if deg in exact:
        return exact[deg]
    a = math.radians(deg)
    return math.cos(a), math.sin(a)


def _apply(ox: float, oz: float, cs: tuple[float, float], lx: float, lz: float) -> Point:
    c, s = cs
    return [ox + lx * c - lz * s, oz + lx * s + lz * c]


def to_world(origin_x: float, origin_z: float, rotation_deg: float, lx: float, lz: float) -> Point:
    return _apply(_number('origin_x', origin_x), _number('origin_z', origin_z), _cos_sin(rotation_deg),
                  _number('lx', lx), _number('lz', lz))


def _prefix(prefix: Any) -> str:
    if not isinstance(prefix, str) or not prefix.strip():
        raise ValueError('prefix must be a non-empty string')
    return prefix.strip()


def rack_slot_name(prefix: str, row: int, col: int, level: int, digits: int = 2) -> str:
    p, d = _prefix(prefix), _positive_int('digits', digits)
    r, c, l = _positive_int('row', row), _positive_int('col', col), _positive_int('level', level)
    return f'{p}-{r:0{d}d}-{c:0{d}d}-{l}'


def ground_slot_name(prefix: str, row: int, col: int, digits: int = 2) -> str:
    p, d = _prefix(prefix), _positive_int('digits', digits)
    r, c = _positive_int('row', row), _positive_int('col', col)
    return f'{p}-{r:0{d}d}-{c:0{d}d}'


# ── 第七节：停靠点与可用侧 ───────────────────────────────
def stop_points(facility_depth: float, column_x: float, vehicle_depth: float, gap: float = DEFAULT_GAP) -> dict:
    D, x = _positive('facility_depth', facility_depth), _number('column_x', column_x)
    d, g = _positive('vehicle_depth', vehicle_depth), _non_negative('gap', gap)
    return {'above': [x, -(g + d / 2)], 'below': [x, D + g + d / 2]}


def _footprint(x: float, z: float, cs: tuple[float, float], width: float, depth: float, margin: float) -> list[Point]:
    hw, hd = width / 2 + margin, depth / 2 + margin
    return [_apply(x, z, cs, lx, lz) for lx, lz in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]


def footprint(x: float, z: float, rotation_deg: float, width: float, depth: float, margin: float = 0) -> list[Point]:
    return _footprint(_number('x', x), _number('z', z), _cos_sin(rotation_deg), _positive('width', width),
                      _positive('depth', depth), _non_negative('margin', margin))


def quads_overlap(a: list, b: list, eps: float = OVERLAP_EPS) -> bool:
    """分离轴判断两个凸多边形是否重叠；任一轴上投影重叠长度不超过 eps 即视为不重叠（贴边不算）。"""
    for poly in (a, b):
        n = len(poly)
        for i in range(n):
            ex, ez = poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]
            length = math.hypot(ex, ez)
            if length == 0:
                continue
            nx, nz = -ez / length, ex / length
            pa = [p[0] * nx + p[1] * nz for p in a]
            pb = [p[0] * nx + p[1] * nz for p in b]
            if min(max(pa), max(pb)) - max(min(pa), min(pb)) <= eps:
                return False
    return True


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(p: Point, a: Point, b: Point, eps: float = OVERLAP_EPS) -> bool:
    if abs(_orient(a, b, p)) > eps * max(1.0, math.hypot(b[0] - a[0], b[1] - a[1])):
        return False
    return min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps and min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps


def _point_in(polygon: list, p: Point) -> bool:
    n = len(polygon)
    if any(_on_segment(p, polygon[i], polygon[(i + 1) % n]) for i in range(n)):
        return True
    inside = False
    for i in range(n):
        a, b = polygon[i], polygon[(i + 1) % n]
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x > p[0]:
                inside = not inside
    return inside


def _proper_cross(a: Point, b: Point, c: Point, d: Point, eps: float = 1e-12) -> bool:
    d1, d2, d3, d4 = _orient(c, d, a), _orient(c, d, b), _orient(a, b, c), _orient(a, b, d)
    return ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and ((d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps))


def polygon_contains(polygon: list, points: list) -> bool:
    """points 组成的多边形（如车身外框）完全位于 polygon 内（允许贴边）。适用于凹多边形边界。"""
    if not all(_point_in(polygon, p) for p in points):
        return False
    n, m = len(points), len(polygon)
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        for j in range(m):
            if _proper_cross(a, b, polygon[j], polygon[(j + 1) % m]):
                return False
        mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        if not _point_in(polygon, mid):
            return False
    return True


def side_availability(candidates: dict, obstacles: list, bounds: list) -> dict:
    return {side: polygon_contains(bounds, quad) and not any(quads_overlap(quad, o) for o in obstacles)
            for side, quad in candidates.items()}


# ── 第六、七节：耗时 ─────────────────────────────────────
def to_seconds(value: float, unit: str) -> float:
    if unit not in UNIT_SECONDS:
        raise ValueError(f'unknown time unit {unit!r}')
    return _positive('value', value) * UNIT_SECONDS[unit]


def travel_seconds(distance: float, speed: float) -> float:
    return _non_negative('distance', distance) / _positive('speed', speed)


def handling_seconds(fixed_s: float, support_height: float, lift_speed: Optional[float]) -> float:
    fixed, h = _non_negative('fixed_s', fixed_s), _non_negative('support_height', support_height)
    if lift_speed is None:
        return fixed
    return fixed + 2 * h / _positive('lift_speed', lift_speed)


# ── 批量展开 ─────────────────────────────────────────────
def _vehicle(vehicle: Optional[dict]) -> tuple[float, float]:
    v = vehicle or DEFAULT_VEHICLE
    return _positive('vehicle.width', v.get('width')), _positive('vehicle.depth', v.get('depth'))


def _column(ox, oz, cs, rotation, D, x, vw, vd, gap, extra: dict, z0: float = 0.0) -> dict:
    """单列（或单个地面库位）的上下停靠点与车身外框；z0 为该格外框在设施局部 Z 上的起点。"""
    local = stop_points(D, x, vd, gap)
    stops, prints = {}, {}
    for side, (lx, lz) in local.items():
        wx, wz = _apply(ox, oz, cs, lx, lz + z0)
        stops[side] = {'position': [wx, wz], 'heading': rotation}
        prints[side] = _footprint(wx, wz, cs, vw, vd, gap)
    return {**extra, 'stops': stops, 'footprints': prints}


def _quad(ox, oz, cs, x0, z0, x1, z1) -> list[Point]:
    return [_apply(ox, oz, cs, x, z) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]


def expand_rack_group(group: dict, container: dict, vehicle: Optional[dict] = None) -> dict:
    prefix, row = _prefix(group.get('prefix')), _positive_int('row', group.get('row'))
    origin = group.get('origin') or [None, None]
    ox, oz = _number('origin.x', origin[0]), _number('origin.z', origin[1])
    rotation = _number('rotation', group.get('rotation', 0))
    cs = _cos_sin(rotation)
    elevation = _number('elevation', group.get('elevation', 0))
    gap = _non_negative('gap', group.get('gap', DEFAULT_GAP))
    D = _positive('depth', group.get('depth'))
    groups = _positive_int('groups', group.get('groups'))
    w = _positive('center_spacing', group.get('center_spacing'))
    cw, cd, ch = _size('container', container)
    vw, vd = _vehicle(vehicle)
    widths = rack_widths(w, groups)
    xs = rack_column_centers(w, groups, cw)
    per_group = max(1, len(xs) // groups)
    supports = level_support_heights(group.get('height'), group.get('levels'), group.get('has_bottom'), group.get('has_boards'))
    slots, columns = [], []
    half_h = ch / 2
    for i, x in enumerate(xs):
        col = i + 1
        wx, wz = _apply(ox, oz, cs, x, D / 2)
        gi = i // per_group + 1
        for j, sup in enumerate(supports):
            slots.append({'name': rack_slot_name(prefix, row, col, j + 1), 'column': col, 'level': j + 1,
                          'group': gi, 'center': [wx, elevation + sup + half_h, wz], 'support_height': sup})
        columns.append(_column(ox, oz, cs, rotation, D, x, vw, vd, gap, {'column': col}))
    return {'slots': slots, 'columns': columns, 'outline': _quad(ox, oz, cs, 0, 0, widths['row_outer'], D),
            'issues': rack_issues(group, container)}


def expand_ground_batch(batch: dict, container: dict, vehicle: Optional[dict] = None) -> dict:
    prefix = _prefix(batch.get('prefix'))
    origin = batch.get('origin') or [None, None]
    ox, oz = _number('origin.x', origin[0]), _number('origin.z', origin[1])
    rotation = _number('rotation', batch.get('rotation', 0))
    cs = _cos_sin(rotation)
    elevation = _number('elevation', batch.get('elevation', 0))
    gap = _non_negative('gap', batch.get('gap', DEFAULT_GAP))
    W, D = _positive('width', batch.get('width')), _positive('depth', batch.get('depth'))
    rows, cols = _positive_int('rows', batch.get('rows')), _positive_int('cols', batch.get('cols'))
    aisle = _non_negative('aisle', batch.get('aisle', 0))
    _, _, ch = _size('container', container)
    vw, vd = _vehicle(vehicle)
    slots, columns, cells = [], [], []
    for i, cell in enumerate(ground_centers(W, D, rows, cols, aisle)):
        r, c = cell['row'], cell['col']
        name = ground_slot_name(prefix, r + 1, c + 1)
        x0, z0 = c * W, r * (D + aisle)
        wx, wz = _apply(ox, oz, cs, cell['x'], cell['z'])
        slots.append({'name': name, 'row': r + 1, 'col': c + 1, 'level': 1,
                      'center': [wx, elevation + ch / 2, wz], 'support_height': 0.0})
        # 停靠点在单个库位自身的外框中计算，再平移到该格位置
        col = _column(ox, oz, cs, rotation, D, cell['x'], vw, vd, gap, {'column': i + 1, 'name': name}, z0)
        columns.append(col)
        cells.append(_quad(ox, oz, cs, x0, z0, x0 + W, z0 + D))
    total_depth = rows * D + (rows - 1) * aisle
    return {'slots': slots, 'columns': columns, 'cells': cells,
            'outline': _quad(ox, oz, cs, 0, 0, cols * W, total_depth), 'issues': ground_issues(W, D, container)}

