/**
 * 工作台设施的纯函数：批量创建、展开、参考车辆、停靠可用侧、取放耗时、添加入口禁用原因。
 * 几何全部来自 ../layout/modeling（与 backend/app/modeling.py 一致）；服务端 layout_facilities.py 为权威校验。
 */
import type {
  ContainerTemplate, EquipmentCategory, LayoutEquipment, LayoutGroundBatch, LayoutRackGroup, P2, WarehouseLayout,
} from '../layout/types';
import {
  DEFAULT_GAP, DEFAULT_VEHICLE, expandGroundBatch, expandRackGroup, footprint, groundIssues, handlingSeconds, levelSlots,
  polygonContains, quadsOverlap, rackIssues, rackWidths, toWorld, type Issue, type StopColumn,
} from '../layout/modeling';

export const SCHEMA_VERSION = '1.1';
const newId = () => crypto.randomUUID();

/** 旧布局缺少设施集合时补成空集合；有设施时版本号为 1.1。不修改入参。 */
export function normalizeLayout(doc: WarehouseLayout): WarehouseLayout {
  const out: WarehouseLayout = { ...doc, rack_groups: doc.rack_groups ?? [], ground_batches: doc.ground_batches ?? [], equipment: doc.equipment ?? [] };
  return out;
}

export function markSchema(doc: WarehouseLayout): void {
  if ((doc.rack_groups?.length ?? 0) + (doc.ground_batches?.length ?? 0) + (doc.equipment?.length ?? 0) > 0) doc.schema_version = SCHEMA_VERSION;
}

/** 与服务端 containers_for 一致：已发布版本优先用自身快照，草稿优先用组织当前模板。 */
export function containerMap(templates: ContainerTemplate[], layout: WarehouseLayout, published: boolean): Record<string, ContainerTemplate> {
  const current = Object.fromEntries(templates.map(t => [t.id, t]));
  const snaps = layout.container_snapshots ?? {};
  return published ? { ...current, ...snaps } : { ...snaps, ...current };
}

// ── 批量创建 ────────────────────────────────────────────────
export interface RackRowInput {
  prefix: string; row: number; floor: number; origin: P2; rotation: number; center_spacing: number; depth: number;
  height: number; levels: number; has_bottom: boolean; has_boards: boolean; groups: number; container_id: string; cargo_height?: number;
}

export function perLevel(centerSpacing: number, container: ContainerTemplate): number {
  return levelSlots(rackWidths(centerSpacing, 1).clear, container.width).count;
}

/** 一排 G 组：每组一条记录，原点沿旋转后的 X 方向相隔中心距，列号连续。 */
export function createRackRow(input: RackRowInput, container: ContainerTemplate): LayoutRackGroup[] {
  const per = Math.max(1, perLevel(input.center_spacing, container));
  const rowKey = newId();
  const { groups, ...rest } = input;
  return Array.from({ length: groups }, (_, k) => ({
    ...rest, id: newId(), row_key: rowKey, column_start: 1 + k * per,
    origin: toWorld(input.origin[0], input.origin[1], input.rotation, k * input.center_spacing, 0),
  }));
}

/** 整排旋转：以本排第一组（列号最小）的外框起点为轴，按各组中心距连续排布，保持连接处立柱共用。 */
export function rotateRow(groups: LayoutRackGroup[], rowKey: string, rotation: number): void {
  const row = groups.filter(g => g.row_key === rowKey).sort((a, b) => a.column_start - b.column_start);
  if (!row.length) return;
  const [ox, oz] = row[0].origin;
  let offset = 0;
  for (const g of row) {
    g.origin = toWorld(ox, oz, rotation, offset, 0);
    g.rotation = rotation;
    offset += g.center_spacing;
  }
}

export function rackPreview(input: Pick<RackRowInput, 'center_spacing' | 'depth' | 'height' | 'levels' | 'has_bottom' | 'has_boards' | 'groups' | 'cargo_height'>,
  container: ContainerTemplate | undefined) {
  try {
    const widths = rackWidths(input.center_spacing, input.groups);
    if (!container) return { widths, per: null, total: null, issues: [] as Issue[], error: null };
    const per = perLevel(input.center_spacing, container);
    const issues = rackIssues({ ...input, groups: 1 }, container, input.cargo_height ?? 0);
    return { widths, per, total: per * input.levels * input.groups, issues, error: null };
  } catch (err) {
    return { widths: null, per: null, total: null, issues: [] as Issue[], error: err instanceof Error ? err.message : String(err) };
  }
}

export function groundPreview(input: Pick<LayoutGroundBatch, 'width' | 'depth' | 'rows' | 'cols' | 'aisle'>, container: ContainerTemplate | undefined) {
  try {
    if (!(input.aisle >= 0)) throw new RangeError('aisle must not be negative');
    const issues = container ? groundIssues(input.width, input.depth, container) : [];
    return { total: input.rows * input.cols, outerWidth: input.cols * input.width,
      outerDepth: input.rows * input.depth + (input.rows - 1) * input.aisle, issues, error: Number.isInteger(input.rows) && Number.isInteger(input.cols) && input.rows > 0 && input.cols > 0 ? null : 'rows/cols' };
  } catch (err) {
    return { total: 0, outerWidth: 0, outerDepth: 0, issues: [] as Issue[], error: err instanceof Error ? err.message : String(err) };
  }
}

export function createGroundBatch(input: Omit<LayoutGroundBatch, 'id'>): LayoutGroundBatch {
  return { ...input, id: newId() };
}

export function nextRowNumber(layout: WarehouseLayout, prefix: string): number {
  const rows = [...(layout.rack_groups ?? [])].filter(g => g.prefix === prefix).map(g => g.row);
  return rows.length ? Math.max(...rows) + 1 : 1;
}

export function nextEquipmentNumber(layout: WarehouseLayout, category: string): string {
  const used = new Set((layout.equipment ?? []).filter(e => e.category === category).map(e => e.number));
  for (let n = 1; ; n++) { const s = String(n).padStart(3, '0'); if (!used.has(s)) return s; }
}

export function createEquipment(category: EquipmentCategory, number: string, floor: number, position: P2, rotation = 0): LayoutEquipment {
  const item: LayoutEquipment = { id: newId(), category: category.code, number, floor, position, rotation, timing: { ...category.defaults.timing } };
  if (category.kind === 'vehicle') {
    const v = category.defaults.vehicle ?? { pick_s: 10, drop_s: 10, lift_speed_mps: null, low_battery_pct: 20 };
    item.vehicle = { width: category.size.width, depth: category.size.depth, ...v };
  }
  return item;
}

export function equipmentSize(item: LayoutEquipment, category: EquipmentCategory | undefined): { width: number; depth: number; height: number } {
  const height = category?.size.height ?? 1;
  if (category?.kind === 'vehicle' && item.vehicle) return { width: item.vehicle.width, depth: item.vehicle.depth, height };
  return { width: item.size?.width ?? category?.size.width ?? 1, depth: item.size?.depth ?? category?.size.depth ?? 1, height };
}

export function equipmentLabel(item: LayoutEquipment): string {
  return item.name?.trim() || `${item.category}-${item.number}`;
}

// ── 展开与停靠 ──────────────────────────────────────────────
export interface ReferenceVehicle { width: number; depth: number; missing: boolean; vehicle?: LayoutEquipment }

/** 车身深度最大的车辆；没有车辆时使用默认 2.0 × 1.0（missing = true）。 */
export function referenceVehicle(layout: WarehouseLayout, catalog: Record<string, EquipmentCategory>): ReferenceVehicle {
  let best: ReferenceVehicle | null = null;
  for (const item of layout.equipment ?? []) {
    if (catalog[item.category]?.kind !== 'vehicle' || !item.vehicle) continue;
    if (!best || item.vehicle.depth > best.depth) best = { width: item.vehicle.width, depth: item.vehicle.depth, missing: false, vehicle: item };
  }
  return best ?? { ...DEFAULT_VEHICLE, missing: true };
}

export interface ExpandedSlot { name: string; column: number; level: number; center: [number, number, number]; support_height: number }
export interface ExpandedFacility {
  kind: 'rack' | 'ground'; id: string; floor: number; rotation: number; container: ContainerTemplate | null;
  slots: ExpandedSlot[]; columns: StopColumn[]; outline: P2[]; cells: P2[][]; levels: number; error: string | null;
  item: LayoutRackGroup | LayoutGroundBatch;
}

function elevationOf(layout: WarehouseLayout, floor: number) { return layout.floors.find(f => f.id === floor)?.elevation ?? 0; }

export function expandFacilities(layout: WarehouseLayout, containers: Record<string, ContainerTemplate>, vehicle: { width: number; depth: number }): ExpandedFacility[] {
  const gap = layout.stop_gap ?? DEFAULT_GAP;
  const out: ExpandedFacility[] = [];
  for (const g of layout.rack_groups ?? []) {
    const c = containers[g.container_id] ?? null;
    const base = { kind: 'rack' as const, id: g.id, floor: g.floor, rotation: g.rotation, container: c, item: g };
    try {
      if (!c) throw new Error('container_missing');
      const r = expandRackGroup({ ...g, groups: 1, elevation: elevationOf(layout, g.floor), gap }, c, vehicle);
      out.push({ ...base, slots: r.slots, columns: r.columns, outline: r.outline, cells: [], levels: g.levels, error: null });
    } catch (err) {
      out.push({ ...base, slots: [], columns: [], outline: [], cells: [], levels: g.levels, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const b of layout.ground_batches ?? []) {
    const c = containers[b.container_id] ?? null;
    const base = { kind: 'ground' as const, id: b.id, floor: b.floor, rotation: b.rotation, container: c, item: b };
    try {
      if (!c) throw new Error('container_missing');
      const r = expandGroundBatch({ ...b, elevation: elevationOf(layout, b.floor), gap }, c, vehicle);
      out.push({ ...base, slots: r.slots.map((s, i) => ({ name: s.name, column: i + 1, level: 1, center: s.center, support_height: 0 })),
        columns: r.columns, outline: r.outline, cells: r.cells, levels: 1, error: null });
    } catch (err) {
      out.push({ ...base, slots: [], columns: [], outline: [], cells: [], levels: 1, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

export function floorBounds(layout: WarehouseLayout, floor: number): P2[] {
  const fp = layout.floors.find(f => f.id === floor)?.footprint;
  if (fp?.length) return fp;
  const { width: w, depth: d } = layout.size;
  return [[0, 0], [w, 0], [w, d], [0, d]];
}

/** 某个停靠列的可用侧（与服务端规则一致；只用于选中时的显示）。 */
export function columnAvailability(layout: WarehouseLayout, facilities: ExpandedFacility[], facility: ExpandedFacility, columnIndex: number,
  catalog: Record<string, EquipmentCategory>): { above: boolean; below: boolean } {
  const col = facility.columns[columnIndex];
  const bounds = floorBounds(layout, facility.floor);
  const rowKey = facility.kind === 'rack' ? (facility.item as LayoutRackGroup).row_key : null;
  const obstacles: P2[][] = [];
  for (const f of facilities) {
    if (f.floor !== facility.floor || f.error) continue;
    if (f.kind === 'rack') {
      if (f.id === facility.id || (rowKey && (f.item as LayoutRackGroup).row_key === rowKey)) continue;
      obstacles.push(f.outline);
    } else f.cells.forEach((cell, i) => { if (!(f.id === facility.id && i === columnIndex)) obstacles.push(cell); });
  }
  for (const e of layout.equipment ?? []) {
    const cat = catalog[e.category];
    if (e.floor !== facility.floor || !cat || cat.kind === 'vehicle') continue;
    const s = equipmentSize(e, cat);
    obstacles.push(footprint(e.position[0], e.position[1], e.rotation, s.width, s.depth));
  }
  for (const r of layout.racks ?? []) if ((r.floor ?? 1) === facility.floor) {
    const [x, , z] = r.position, [w, , d] = r.size;
    obstacles.push(([[0, 0], [w, 0], [w, d], [0, d]] as P2[]).map(([px, pz]) => toWorld(x, z, r.rotation ?? 0, px, pz)));
  }
  for (const o of [...(layout.obstacles ?? []), ...(layout.stations ?? [])]) {
    const [x0, z0, x1, z1] = o.rect; obstacles.push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  }
  for (const o of layout.restricted_areas ?? []) if (!o.robots_allowed) {
    const [x0, z0, x1, z1] = o.rect; obstacles.push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  }
  if (facility.floor === 1) for (const [x, z] of layout.columns ?? []) obstacles.push([[x - .45, z - .45], [x + .45, z - .45], [x + .45, z + .45], [x - .45, z + .45]]);
  const ok = (quad: P2[]) => polygonContains(bounds, quad) && !obstacles.some(o => quadsOverlap(quad, o));
  return { above: ok(col.footprints.above), below: ok(col.footprints.below) };
}

export function handlingFor(vehicle: LayoutEquipment | undefined, supportHeight: number): { pick: number; drop: number } | null {
  if (!vehicle?.vehicle) return null;
  const v = vehicle.vehicle;
  return { pick: handlingSeconds(v.pick_s, supportHeight, v.lift_speed_mps), drop: handlingSeconds(v.drop_s, supportHeight, v.lift_speed_mps) };
}

/** 平面点击 → 设施中最近的停靠列下标（局部坐标反变换后按容器中心 X 取最近）。 */
export function columnAt(facility: ExpandedFacility, point: P2): number {
  if (!facility.columns.length) return -1;
  let best = 0, dist = Infinity;
  facility.slots.forEach((s, i) => {
    const d = Math.hypot(s.center[0] - point[0], s.center[2] - point[1]);
    if (d < dist) { dist = d; best = Math.floor(i / facility.levels); }
  });
  return best;
}

export type AddKind = 'container' | 'rack' | 'ground' | 'equipment';
/** 添加入口不可用的原因（i18n 消息键）；可用时返回 null。 */
export function addDisabledReason(kind: AddKind, state: { hasLayout: boolean; readOnly: boolean; busy: boolean; containerCount: number; catalogLoaded: boolean }):
  'Select or create a warehouse first' | 'Published versions are read-only. Create an alternative draft to edit.' | 'Please wait for the current operation to finish' | 'Create a container template first' | 'Equipment catalog is not loaded yet' | null {
  if (state.busy) return 'Please wait for the current operation to finish';
  if (kind === 'container') return null;
  if (!state.hasLayout) return 'Select or create a warehouse first';
  if (state.readOnly) return 'Published versions are read-only. Create an alternative draft to edit.';
  if ((kind === 'rack' || kind === 'ground') && state.containerCount === 0) return 'Create a container template first';
  if (kind === 'equipment' && !state.catalogLoaded) return 'Equipment catalog is not loaded yet';
  return null;
}

export function containerTypeLabel(type: ContainerTemplate['type']): 'Plastic pallet' | 'Wood pallet' | 'Plastic box' {
  return type === 'wood_pallet' ? 'Wood pallet' : type === 'plastic_box' ? 'Plastic box' : 'Plastic pallet';
}
