# 后台设施管理（工作台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/workspace` 中实现“设施”：组织级容器模板、货架组、地面库位批次、统一设备目录与设备实例；保存、服务端校验（含不可达）、发布快照；二维平面与三维预览；选中存放位置时显示停靠车辆与取放货耗时。

**Architecture:** 布局文档新增 `rack_groups`、`ground_batches`、`equipment`、`stop_gap` 和发布时写入的 `container_snapshots`；`schema_version` 升为 `1.1`，旧文档缺字段时按空集合处理。容器模板存于 SQLite 表 `layout_container_templates`（按组织隔离）。设备类别目录 `backend/app/equipment_catalog.json` 由 API 提供。所有几何来自已完成的 `modeling.py` / `modeling.ts`；服务端新增纯函数模块 `layout_facilities.py` 做校验与发布前准备。

**Tech Stack:** FastAPI、SQLite、React 18、React Three Fiber、zustand（沿用）。

**Spec:** `plan/后台设施与容器管理开发说明.md`；几何核心见 `2026-11-26-modeling-geometry-core.md`。

## Global Constraints

- 一条货架组记录 = 一组货架（`groups = 1`）；批量创建 G 组时生成 G 条记录，共享 `row_key`，`column_start` 递增，原点沿旋转后的 X 方向相隔中心距 `w`。
- 同一 `row_key` 的相邻组外框重叠一个立柱宽，不算设施重叠；三维渲染按世界坐标去重立柱。
- 容器类型：`plastic_pallet`、`wood_pallet`（固定色 `#b07a48`）、`plastic_box`；名称在组织内不区分大小写唯一；被任何版本引用时禁止删除。
- 校验问题统一 `{path, code, message, severity, object_id?, count?, names?}`；`severity` 为 `error` 或 `warning`；`slot_unreachable`、`reference_vehicle_missing` 为警告，其余设施问题为错误。
- 不可达以设施为单位汇总（计数 + 前 20 个名称），不逐个存放位置列出。
- 可用侧判断使用均匀网格空间索引，5 万存放位置校验 < 5 s。
- 设备编号在同一仓库内按（类别，编号）唯一。
- 不修改仿真引擎和公开演示；旧版 `racks` 继续可编辑。

## Review Focus

1. 已发布版本只读：所有添加入口禁用并显示“复制为草稿后编辑”原因 —— 前端 `addDisabledReason` 测试。
2. 删除被引用的容器模板必须被拒绝（409），不能留下悬空引用 —— `test_layout_containers.py::test_delete_referenced_is_refused`。
3. 旧布局（无新集合、`schema_version 1.0`）打开、保存不报错 —— `normalizeLayout` 测试与 `test_layout_facilities.py::test_legacy_document_has_no_issues`。
4. 背靠背与紧密排布的不可达汇总正确，且同排相邻组不误报重叠 —— `test_layout_facilities.py`。
5. 发布后修改容器模板不改变已发布快照 —— `test_layout_facilities.py::test_publish_snapshot_is_frozen`。

---

### Task 1: 几何核心补充 `column_start` 与空间索引
- `expand_rack_group` / `expandRackGroup` 增加 `group.column_start`（默认 1），列号与名称从该值开始；重新生成共用用例。
- 新增 `SpatialIndex(cell=2.0)`：`add(quad, tag)`、`query(quad) -> list`（Python 与 TS 各一份），测试插入 1 万个外框后查询结果与暴力法一致。

### Task 2: 错误类型拆分与容器模板存储
- 新建 `backend/app/layout_errors.py`（`LayoutNotFound`、`LayoutConflict`、`LayoutInvalid`），`layout_store.py` 改为从此导入并保持原名可用。
- 新建 `backend/app/layout_containers.py`：`ContainerTemplates(path)` 提供 `list(org)`、`get_many(org, ids) -> dict`、`create(org, data)`、`update(org, id, data)`、`delete(org, id)`。
- 测试 `backend/tests/test_layout_containers.py`：组织隔离、重名 409、木托盘颜色固定、无效尺寸 422、被引用删除 409、未引用可删除。

### Task 3: 设备目录与设施校验
- `backend/app/equipment_catalog.json`：AGV-LATENT、SFL-CBD20、LIFT、CONVEYOR、CHARGER、WRAPPER（含尺寸、默认耗时、车辆默认取放动作、作业点偏移）。
- `backend/app/layout_facilities.py`：`facility_issues(document, containers, catalog) -> list[dict]`；`publish_prepare(document, containers, catalog) -> (errors, document)`（写入 `container_snapshots`、`schema_version 1.1`）。
- 测试 `backend/tests/test_layout_facilities.py`：缺容器、容量不足、越界、设施重叠、同排不误报、重复名称、不可达汇总、参考车辆缺失警告、设备重复编号/无效耗时、旧文档无问题、快照冻结、5 万存放位置 < 5 s。

### Task 4: API 接入
- `layout_api.py`：`GET/POST /containers`、`PUT/DELETE /containers/{id}`、`GET /equipment-catalog`；`validation` 合并设施问题（`valid` = 无 error）；`publish` 通过 `prepare` 回调执行设施校验与快照。
- `layout_store.publish(..., prepare=None)`：在同一事务中调用 `prepare(document)`，有错误抛 `LayoutInvalid`，否则插入准备后的文档。
- 通过浏览器对运行中的后端调用验证。

### Task 5: 前端数据层
- `layout/types.ts` 新增类型；`services/workspace.ts` 新增容器与目录接口；`workspace/facilities.ts`：`normalizeLayout`、`createRackRow`、`createGroundBatch`、`createEquipment`、`referenceVehicle`、`expandAll`、`findSlot`、`handlingFor`、`addDisabledReason`。测试 `frontend/tests/facilities.test.ts`。

### Task 6: 工作台界面
- 左栏“设施”：添加容器 / 货架 / 库位 / 设备四个入口（禁用时显示原因）+ 对象列表；保留“旧版货架”。
- 弹窗：容器模板管理（列表、新建、编辑、删除）、货架（实时显示净宽、外廓、每层数量、问题）、地面库位、设备（按类别显示字段、耗时方式切换）。
- 右栏按选中类型显示可编辑属性；存放位置显示名称、中心、支承高度、停靠侧、取放货耗时。
- 二维：设施外框、容器（单个 path）、设备、选中位置的停靠车辆；可拖动设施原点。
- 三维预览（切换按钮）：实例化立柱（去重）、横梁、层板、容器、设备简模、停靠车辆。
- 校验面板显示 error / warning 与不可达名称。
- 发布按钮（草稿保存后可用）。

### Task 7: 浏览器验收
- 在内置浏览器中按开发说明第十二节逐项操作：容器、十组货架、百个库位、旋转 90°、行间通道、停靠点、设备 001/002、保存重开、发布只读。

---

## 完成情况（2026-11-26）

Task 1–7 已完成并在本机运行中的开发服务器上通过浏览器验收：

- 容器模板：新建塑料托盘、木托盘（颜色固定）、塑料箱；重名 409、无效 422；被已保存布局引用时拒绝删除（中文提示）。
- 货架：10 组连续生成，净宽 2.4 / 单组外廓 2.6 / 整排 25.1 m，每层 2 个，共 60 个；逐组编辑；整排旋转 90° 后保持连续，停靠点随之旋转。
- 地面库位：10 × 10 紧密排布时校验报告 80 个不可达（F-02-01 起）；行间通道 1.2 m 后全部可达。
- 设备：SFL-CBD20 001 / 002（编号自动递增）、充电桩（按生产时间 2 小时）。
- 存放位置：N-01-05-3 支承高度 2.04 m（有层板），取货 35.4 s、放货 32.4 s。
- 发布：schema 1.1 + 容器快照；只读时入口禁用并提示“复制为草稿后编辑”；复制草稿后恢复可编辑。
- 5 万存放位置：布局文档 275 KB，保存 0.05 s、服务端校验 0.29 s，打开平面 0.13 s，切换三维 0.34 s。

测试：Python 50 个（modeling 33、containers 5、facilities 12），TypeScript 27 个（modeling 18、facilities 9），`tsc --noEmit` 通过。
本会话无法安装依赖，原有后端完整测试、vitest 与 `vite build`、Playwright 需在 CI 或本机运行；e2e 脚本已同步新按钮名称。

### 剩余事项

1. 三维帧率：测量时浏览器面板处于隐藏状态，结果不可靠；已加入像素倍率上限、Lambert 材质与按需重绘，需在可见窗口复测 5 万存放位置是否 ≥ 30 帧。
2. 旧布局中的 AGV、提升机、流水线尚未映射到统一设备目录（开发说明第六节最后一段）。
3. 地面库位单格名称覆盖（与 Odoo 点位绑定后不随参数改名）尚未实现；目前名称由批次参数推导。
4. CAD / 表格导入（实施顺序第 8 项）尚未开始。
5. 外部 GLB 车型通过目录加载尚未实现（首期使用内置简模）。
