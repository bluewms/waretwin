# 建模几何规则核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现第一阶段建模的纯计算规则（货架宽度与容量、层支承高度、地面库位网格、坐标旋转、停靠点、可用侧判断、取放货耗时、点位命名），前后端各一份且结果一致。

**Architecture:** 新增无外部依赖的纯函数模块 `backend/app/modeling.py` 与 `frontend/src/layout/modeling.ts`，函数一一对应（Python 用 snake_case，TS 用 camelCase）。两边测试读取同一份用例文件 `backend/tests/fixtures/modeling_cases.json` 保证一致。本计划不改布局结构、存储、界面和渲染；这些由后续计划（布局结构与校验接入、工作台界面、三维渲染、设备目录、性能、导入）消费本模块。

**Tech Stack:** Python 3.11（pytest），TypeScript 5（vitest）；不依赖 Shapely、polygon-clipping。

**Spec:** `plan/后台设施与容器管理开发说明.md`（第三、四、五、六、七节）

## Global Constraints

- 坐标与尺寸单位为米，平面 X、Z，高度 Y；旋转角为度。
- 旋转公式沿用现有导航网格：`x = x0 + lx·cos θ − lz·sin θ`，`z = z0 + lx·sin θ + lz·cos θ`（`frontend/src/layout/navgrid.ts`）。
- 设施局部原点为网格外框起点；0° 时 X 为宽度方向，Z 为深度方向。
- 立柱宽 0.1 m，横梁高 0.1 m，层板厚 0.04 m（`RackInstances.tsx` 现有基线）。
- 尺寸精度：整除判断使用 `1e-9` 容差，避免浮点误差少算容器。
- 默认安全间隙 `g = 0.1` m；未设置车辆时默认车身 2.0 × 1.0 m（宽 × 深）。
- 非有限数、布尔值、零或负尺寸、非正整数的层数/组数/行列数一律抛出 `ValueError`（TS 抛出 `RangeError`）。
- 模块不得引入新依赖。

## Review Focus

1. 整除场景（净宽 2.4 / 容器 1.2、3.6 / 1.2、0.3 / 0.1）必须算出 2、3、3 个，不能因浮点误差少一个 —— Task 1 测试 `exact_division_capacity`。
2. 旋转方向必须与导航网格一致：局部 (1, 0) 在 90° 时映射为 (0, 1) —— Task 3 测试 `rotation_matches_navgrid`。三维渲染（后续计划）需使用 `rotation.y = −θ` 才与此一致，在后续计划中注明。
3. 容器宽于净宽时返回数量 0 与 `no_capacity` 问题，不能除零或返回负间隙 —— Task 1 测试 `container_wider_than_clear`。
4. 停靠车身外框恰好贴着本货架边缘不算重叠；与相邻货架重叠 1 cm 必须算重叠 —— Task 4 测试 `touching_is_not_overlap`、`one_cm_overlap_detected`。
5. 无效输入（`NaN`、`True`、`0`、`-1`、层数 `1.5`）一律报错而不是静默产生几何 —— 各任务的 `rejects_invalid_*` 测试。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `backend/app/modeling.py` | Python 纯函数：全部规则 |
| `backend/tests/test_modeling.py` | Python 单元测试 + 共用用例回放 |
| `frontend/src/layout/modeling.ts` | TS 纯函数，与 Python 一一对应 |
| `frontend/tests/modeling.test.ts` | TS 单元测试 + 共用用例回放 |
| `backend/tests/fixtures/modeling_cases.json` | 共用用例：`[{fn, args, expected}]`，`fn` 用 Python 名称 |

共用用例回放：两边测试遍历 JSON，按名称映射调用函数，数值用 `1e-9` 绝对容差比较（列表、嵌套字典逐项比较）。TS 侧通过 `fs.readFileSync(new URL('../../backend/tests/fixtures/modeling_cases.json', import.meta.url))` 读取，并维护 `snake → camel` 名称表。

### Task 1: 货架宽度、每层容量与列中心

**Files:** Create `backend/app/modeling.py`、`frontend/src/layout/modeling.ts`、两份测试、用例文件。

**Interfaces — Produces:**
- `rack_widths(center_spacing: float, groups: int, post: float = 0.1) -> {"clear": float, "group_outer": float, "row_outer": float}`；`clear = w − t`，`group_outer = w + t`，`row_outer = G·w + t`。
- `level_slots(clear_width: float, container_width: float) -> {"count": int, "gap": float | None, "offsets": list[float]}`；`offsets` 为容器中心距左侧内边界的距离；`count == 0` 时 `gap` 为 `None`，`offsets` 为空。
- `rack_column_centers(center_spacing: float, groups: int, container_width: float, post: float = 0.1) -> list[float]`：整排局部 X，按组从左到右；第 k 组左内边界为 `post + k·w`。

- [x] **Step 1: 写失败测试**（Python 与 TS 各一份，名称一致）
  - `rack_widths(2.5, 1)` → `clear 2.4, group_outer 2.6, row_outer 2.6`；`rack_widths(2.5, 10)["row_outer"] == 25.1`。
  - `level_slots(2.4, 1.0)` → `count 2`，`gap ≈ 0.133333333`，`offsets ≈ [0.633333333, 1.766666667]`。
  - `exact_division_capacity`：`level_slots(2.4,1.2).count == 2`，`(3.6,1.2) == 3`，`(0.3,0.1) == 3`，且 `gap ≈ 0`。
  - `container_wider_than_clear`：`level_slots(0.9, 1.0) == {"count": 0, "gap": None, "offsets": []}`。
  - `rack_column_centers(2.5, 2, 1.0)` ≈ `[0.733333333, 1.866666667, 3.233333333, 4.366666667]`（对称性：`row_outer − 最后一个 == 第一个`）。
  - `rejects_invalid_rack`：`rack_widths(0,1)`、`(2.5,0)`、`(2.5,1.5)`、`(nan,1)`、`(True,1)`、`(0.1,1)`（净宽 0）均报错。
  - 用例文件加入以上数值用例。
- [x] **Step 2: 运行确认失败** — `cd backend && python -m pytest tests/test_modeling.py -q`、`cd frontend && npx vitest run tests/modeling.test.ts`，预期因模块不存在失败。
- [x] **Step 3: 实现** 上述三个函数及共用的 `_positive(name, value)`、`_positive_int(name, value)` 校验；容量 `n = floor(W / c + 1e-9)`，间隙 `g = max(0, (W − n·c) / (n + 1))`。
- [x] **Step 4: 运行确认通过**（同 Step 2 命令，预期 PASS）。
- [ ] **Step 5: Commit** — `git commit -m "feat(modeling): rack width conversion and per-level capacity"`

### Task 2: 层支承高度、净空与货架尺寸问题

**Interfaces — Consumes:** Task 1 校验函数、`level_slots`、`rack_widths`。 **Produces:**
- `level_support_heights(height: float, levels: int, has_bottom: bool, has_boards: bool) -> list[float]`：层距 `s = H / L`；第 1 层有底层时为 `0.1 + (0.04 if has_boards else 0)`，否则 `0`；第 j 层（j ≥ 2）为 `(j−1)·s + (0.04 if has_boards else 0)`。横梁上表面位于 `(j−1)·s`。
- `level_clear_heights(height, levels, has_bottom, has_boards) -> list[float]`：非顶层为 `j·s − 0.1 − support_j`，顶层为 `H − support_top`。
- `rack_issues(rack: dict, container: dict, cargo_height: float = 0) -> list[dict]`；`rack` 键：`center_spacing, groups, depth, height, levels, has_bottom, has_boards`；`container` 键：`width, depth, height`。问题码：`{"code": "no_capacity"}`、`{"code": "container_too_deep"}`（容器深 > 货架深 + 1e-9）、`{"code": "level_too_low", "level": n}`（1 起，`container.height + cargo_height > clear + 1e-9`）。

- [x] **Step 1: 写失败测试**
  - `level_support_heights(3, 3, False, False) == [0, 1, 2]`；`(3, 3, True, True) ≈ [0.14, 1.04, 2.04]`；`(3, 3, True, False) ≈ [0.1, 1, 2]`。
  - `bottom_option_keeps_level_count`：四种组合返回长度都等于 3。
  - `level_clear_heights(3, 3, False, False) ≈ [0.9, 0.9, 1.0]`。
  - `rack_issues` 示例：2.5 m、1.2 m 深、3 m 高、3 层，容器 1.1 × 1.2 × 1.0 → `[level_too_low 1, level_too_low 2]`（净空 0.9）；容器高 0.8 → `[]`；容器深 1.3 → 含 `container_too_deep`；容器宽 2.5 → 含 `no_capacity`。
  - `rejects_invalid_levels`：`levels` 为 `0`、`1.5`、`True` 报错；`levels` 为 1 时 `level_clear_heights(2, 1, False, False) == [2]`。
- [x] **Step 2–4:** 运行失败 → 实现 → 运行通过（命令同 Task 1）。
- [ ] **Step 5: Commit** — `feat(modeling): level support heights and rack fit issues`

### Task 3: 地面库位网格、坐标变换与命名

**Produces:**
- `ground_centers(width: float, depth: float, rows: int, cols: int, aisle: float = 0) -> list[dict]`：按行优先，`{"row": int, "col": int, "x": float, "z": float}`（0 起行列，局部坐标）；`x = (col + 0.5)·W`，`z = row·(D + A) + 0.5·D`；`aisle` 允许 0，须有限且 ≥ 0。
- `ground_issues(width, depth, container) -> list[dict]`：`{"code": "container_too_large"}`（容器宽或深超过库位 + 1e-9）。
- `to_world(origin_x, origin_z, rotation_deg, lx, lz) -> [x, z]`（公式见 Global Constraints）。
- `rack_slot_name(prefix: str, row: int, col: int, level: int, digits: int = 2) -> str` → `"N-01-02-3"`；`ground_slot_name(prefix, row, col, digits=2)` → `"N-01-02"`；入参行列层均为 1 起正整数，`prefix` 非空字符串。

- [x] **Step 1: 写失败测试**
  - `ground_centers(1.3, 1.3, 10, 10)` 长度 100，首项 `x 0.65, z 0.65`，末项 `x 12.35, z 12.35`；`ground_centers(1.3, 1.3, 2, 1, aisle=3)[1]["z"] ≈ 4.95`。
  - `ground_issues(1.3, 1.3, {"width":1.1,"depth":1.1,"height":0.15}) == []`；容器 1.4 宽 → `container_too_large`。
  - `rotation_matches_navgrid`：`to_world(0, 0, 90, 1, 0) ≈ [0, 1]`；`to_world(10, 5, 0, 2, 3) == [12, 8]`；`to_world(0, 0, 180, 1, 0) ≈ [-1, 0]`。
  - 命名：`rack_slot_name("N", 1, 2, 3) == "N-01-02-3"`；`rack_slot_name("A", 12, 105, 1) == "A-12-105-1"`（超出位数不截断）；`ground_slot_name("F", 1, 2) == "F-01-02"`；`rack_slot_name("", 1, 1, 1)`、`rack_slot_name("N", 0, 1, 1)` 报错。
- [x] **Step 2–4:** 运行失败 → 实现 → 运行通过。
- [ ] **Step 5: Commit** — `feat(modeling): ground grid, rotation and slot naming`

### Task 4: 停靠点、车身外框与可用侧判断

**Produces:**
- `stop_points(facility_depth: float, column_x: float, vehicle_depth: float, gap: float = 0.1) -> {"above": [lx, lz], "below": [lx, lz]}`：`above z = −(g + d/2)`，`below z = D + g + d/2`。
- `footprint(x: float, z: float, rotation_deg: float, width: float, depth: float, margin: float = 0) -> list[[x, z]]`：以 (x, z) 为中心、宽沿旋转后的 X、深沿旋转后的 Z、各边外扩 `margin` 的四个角点（逆时针）。
- `quads_overlap(a: list, b: list, eps: float = 1e-6) -> bool`：分离轴判断两个凸四边形重叠；任一轴上投影重叠长度 ≤ `eps` 视为不重叠（贴边不算）。
- `polygon_contains(polygon: list, points: list) -> bool`：所有点在多边形内或边上，且四边形各边与多边形边无真相交。
- `side_availability(candidates: dict[str, list], obstacles: list[list], bounds: list[list]) -> dict[str, bool]`：`candidates` 为 `{"above": quad, "below": quad}`；被任一障碍重叠或不被 `bounds` 包含则为 `False`。

- [x] **Step 1: 写失败测试**
  - `stop_points(1.2, 0.733333333, 1.0)` → `above ≈ [0.733333333, -0.6]`，`below ≈ [0.733333333, 1.8]`。
  - `footprint(0, 0, 0, 2, 1)` == `[[-1,-0.5],[1,-0.5],[1,0.5],[-1,0.5]]`；90° 时宽沿 Z：x 范围 ±0.5、z 范围 ±1。
  - `touching_is_not_overlap`：货架外框 `[[0,0],[2.6,0],[2.6,1.2],[0,1.2]]` 与 `footprint(1.3, -0.6, 0, 2, 1, margin=0.1)` 不重叠。
  - `one_cm_overlap_detected`：同一车身（z 范围 −1.2 至 0）与相邻货架 `[[0,-2.39],[2.6,-2.39],[2.6,-1.19],[0,-1.19]]`（伸入 1 cm）判定重叠。
  - `back_to_back`：两排货架背靠背（第二排 z 1.2–2.4），`side_availability` 对第一排结果为 `{"above": True, "below": False}`。
  - `out_of_bounds`：边界 `[[0,0],[50,0],[50,50],[0,50]]`，货架贴 z=0 放置时 `above` 为 `False`。
  - 凹多边形边界（L 形）中，车身跨过凹角时 `polygon_contains` 为 `False`。
- [x] **Step 2–4:** 运行失败 → 实现 → 运行通过。
- [ ] **Step 5: Commit** — `feat(modeling): stop points and side availability`

### Task 5: 耗时换算与取放货耗时

**Produces:**
- `to_seconds(value: float, unit: "s" | "min" | "h") -> float`，`value > 0`，未知单位报错。
- `travel_seconds(distance: float, speed: float) -> float`，`distance ≥ 0`，`speed > 0`。
- `handling_seconds(fixed_s: float, support_height: float, lift_speed: float | None) -> float`：`fixed + 2·h / speed`；`lift_speed` 为 `None`（TS `null`）时升降项为 0；`fixed ≥ 0`，`h ≥ 0`。

- [x] **Step 1: 写失败测试**
  - `to_seconds(5, "min") == 300`，`to_seconds(2, "h") == 7200`，`to_seconds(0, "s")` 报错，`to_seconds(1, "day")` 报错。
  - `travel_seconds(10, 0.5) == 20`，`travel_seconds(3, 0.5) == 6`，`travel_seconds(1, 0)` 报错。
  - `handling_seconds(15, 2, 0.2) == 35`，`handling_seconds(15, 0, 0.2) == 15`，`handling_seconds(15, 2, None) == 15`，`handling_seconds(15, 2, 0)` 报错。
- [x] **Step 2–4:** 运行失败 → 实现 → 运行通过。
- [ ] **Step 5: Commit** — `feat(modeling): timing conversions and handling time`

### Task 6: 货架组与地面库位批次展开

**Consumes:** Task 1–5 全部函数。 **Produces:**
- `expand_rack_group(group: dict, container: dict, vehicle: dict | None = None) -> dict`；`group` 键：`prefix, row, origin [x, z], rotation, center_spacing, groups, depth, height, levels, has_bottom, has_boards, elevation (默认 0), gap (默认 0.1)`；`vehicle` 键 `width, depth`，缺省为 2.0 × 1.0。返回：
  - `"slots"`：每个 `{"name", "column", "level", "group", "center": [x, y, z], "support_height"}`，`y = elevation + support + container.height / 2`，列号沿整排从 1 连续编号；
  - `"columns"`：每个 `{"column", "stops": {"above": {"position": [x, z], "heading": rotation}, "below": {...}}, "footprints": {"above": quad, "below": quad}}`，footprint 外扩 `gap`；
  - `"outline"`：整排外框四角（世界坐标）；`"issues"`：`rack_issues` 的结果。
- `expand_ground_batch(batch: dict, container: dict, vehicle: dict | None = None) -> dict`；`batch` 键：`prefix, origin, rotation, width, depth, rows, cols, aisle (默认 0), elevation, gap`。返回结构同上，`slots` 每格一个（`level` 为 1，`support_height` 0），`columns` 改为每格一个停靠对，`outline` 为每格外框列表 `"cells"` 加整批外框。

- [x] **Step 1: 写失败测试**
  - 10 组、2.5 m 中心距、1 m 宽容器、3 层的货架组：`slots` 长度 `10 × 2 × 3 = 60`，名称首个 `N-01-01-1`、末个 `N-01-20-3`；`outline` 宽 25.1。
  - 同一货架组 `rotation = 90`：每个 `slots[i].center` 等于 `to_world` 变换 0° 结果；`stops.above.heading == 90`。
  - 10 × 10 地面批次（1.3 m 格，原点 (5, 5)，边界 50 × 50 m）：`slots` 100 个，名称唯一；`aisle = 0` 时把所有其他格外框作为障碍，内部第 2–9 行的格位 `side_availability` 两侧都为 `False`（`unreachable`），第 1 行 `above` 为 `True`（边界足够大）。
  - `aisle = 1.2`（车深 1 + 2 × 0.1）时，所有格位至少一侧可用。
  - 共用用例文件加入一个小货架组（2 组 × 2 层）和 2 × 2 地面批次的完整展开结果。
- [x] **Step 2–4:** 运行失败 → 实现 → 运行通过。
- [ ] **Step 5: Commit** — `feat(modeling): expand rack groups and ground batches`

### Task 7: 性能基准

- [x] **Step 1:** 在两份测试中加入 `expand_50k_under_budget`：展开 50 000 个存放位置（例如 834 组 × 2 列 × 3 层的货架，组数可调），Python 用时 < 3 s，TS < 1 s（宽松上限，防止明显退化）。
- [x] **Step 2:** 运行通过；若超限，消除逐格重复计算（同列停靠点只算一次、三角函数只算一次）。
- [ ] **Step 3: Commit** — `test(modeling): 50k slot expansion budget`

## 验证说明

本会话环境无法安装依赖：后端完整测试需要 FastAPI、Shapely，前端需要 `npm ci`。本模块不依赖这些包，可单独运行 `test_modeling.py` 与 `modeling.test.ts`；完整套件与构建以 CI 为准。
