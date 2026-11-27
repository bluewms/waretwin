/**
 * 建模几何规则：纯函数，无外部依赖。与 backend/app/modeling.py 一一对应（Python snake_case ↔ TS camelCase，
 * 返回对象的键与布局 JSON 一致，使用 snake_case）。
 *
 * 规则来源：plan/后台设施与容器管理开发说明.md 第三至第七节。
 * 单位：米、秒、度。设施局部原点为网格外框起点；0° 时 X 为宽度方向、Z 为深度方向。
 * 旋转公式与导航网格一致：x = x0 + lx·cosθ − lz·sinθ，z = z0 + lx·sinθ + lz·cosθ。
 * 注意：Three.js 绕 Y 轴的正旋转方向与此相反，渲染时使用 rotation.y = −θ。
 */
import type { P2 } from './types';

export const POST_WIDTH = 0.1;
export const BEAM_HEIGHT = 0.1;
export const BOARD_THICKNESS = 0.04;
export const EPS = 1e-9;
export const OVERLAP_EPS = 1e-6;
export const DEFAULT_GAP = 0.1;
export const DEFAULT_VEHICLE: VehicleSize = { width: 2.0, depth: 1.0 };
export const UNIT_SECONDS = { s: 1, min: 60, h: 3600 } as const;
export type TimeUnit = keyof typeof UNIT_SECONDS;

export interface ContainerSize { width: number; depth: number; height: number }
export interface VehicleSize { width: number; depth: number }
export interface RackSpec {
  center_spacing: number; groups: number; depth: number; height: number; levels: number;
  has_bottom: boolean; has_boards: boolean;
}
export interface RackGroupSpec extends RackSpec {
  prefix: string; row: number; origin: P2; rotation?: number; elevation?: number; gap?: number;
}
export interface GroundBatchSpec {
  prefix: string; origin: P2; rotation?: number; width: number; depth: number; rows: number; cols: number;
  aisle?: number; elevation?: number; gap?: number;
}
export type Issue = { code: 'no_capacity' } | { code: 'container_too_deep' } | { code: 'level_too_low'; level: number }
  | { code: 'container_too_large' };
export type Side = 'above' | 'below';
export interface StopColumn {
  column: number; name?: string;
  stops: Record<Side, { position: P2; heading: number }>;
  footprints: Record<Side, P2[]>;
}
export interface RackSlot { name: string; column: number; level: number; group: number; center: [number, number, number]; support_height: number }
export interface GroundSlot { name: string; row: number; col: number; level: number; center: [number, number, number]; support_height: number }

// ── 输入校验 ─────────────────────────────────────────────
function num(name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name} must be a finite number`);
  return v;
}
function positive(name: string, v: unknown): number {
  const x = num(name, v); if (x <= 0) throw new RangeError(`${name} must be positive`); return x;
}
function nonNegative(name: string, v: unknown): number {
  const x = num(name, v); if (x < 0) throw new RangeError(`${name} must not be negative`); return x;
}
function positiveInt(name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer`);
  return v;
}
function flag(name: string, v: unknown): boolean {
  if (typeof v !== 'boolean') throw new RangeError(`${name} must be true or false`); return v;
}
function size(name: string, c: ContainerSize): [number, number, number] {
  return [positive(`${name}.width`, c?.width), positive(`${name}.depth`, c?.depth), positive(`${name}.height`, c?.height)];
}

// ── 第三、四节：货架宽度与每层容量 ─────────────────────────
export function rackWidths(centerSpacing: number, groups: number, post = POST_WIDTH) {
  const w = positive('center_spacing', centerSpacing), g = positiveInt('groups', groups), t = positive('post', post);
  const clear = w - t;
  if (clear <= EPS) throw new RangeError('center_spacing must exceed the post width');
  return { clear, group_outer: w + t, row_outer: g * w + t };
}

export function levelSlots(clearWidth: number, containerWidth: number): { count: number; gap: number | null; offsets: number[] } {
  const W = positive('clear_width', clearWidth), c = positive('container_width', containerWidth);
  const n = Math.floor(W / c + EPS);
  if (n < 1) return { count: 0, gap: null, offsets: [] };
  const gap = Math.max(0, (W - n * c) / (n + 1));
  return { count: n, gap, offsets: Array.from({ length: n }, (_, i) => gap + c / 2 + i * (c + gap)) };
}

export function rackColumnCenters(centerSpacing: number, groups: number, containerWidth: number, post = POST_WIDTH): number[] {
  const widths = rackWidths(centerSpacing, groups, post);
  const { offsets } = levelSlots(widths.clear, containerWidth);
  const out: number[] = [];
  for (let k = 0; k < groups; k++) for (const off of offsets) out.push(post + k * centerSpacing + off);
  return out;
}

// ── 第三节：层支承高度与净空 ───────────────────────────────
export function levelSupportHeights(height: number, levels: number, hasBottom: boolean, hasBoards: boolean): number[] {
  const H = positive('height', height), L = positiveInt('levels', levels);
  const board = flag('has_boards', hasBoards) ? BOARD_THICKNESS : 0;
  const s = H / L;
  const out = [flag('has_bottom', hasBottom) ? BEAM_HEIGHT + board : 0];
  for (let j = 1; j < L; j++) out.push(j * s + board);
  return out;
}

export function levelClearHeights(height: number, levels: number, hasBottom: boolean, hasBoards: boolean): number[] {
  const support = levelSupportHeights(height, levels, hasBottom, hasBoards);
  const s = height / levels;
  return support.map((sup, j) => (j < levels - 1 ? (j + 1) * s - BEAM_HEIGHT : height) - sup);
}

export function rackIssues(rack: RackSpec, container: ContainerSize, cargoHeight = 0): Issue[] {
  const widths = rackWidths(rack?.center_spacing, rack?.groups);
  const depth = positive('rack.depth', rack?.depth);
  const [cw, cd, ch] = size('container', container);
  const cargo = nonNegative('cargo_height', cargoHeight);
  const issues: Issue[] = [];
  if (levelSlots(widths.clear, cw).count === 0) issues.push({ code: 'no_capacity' });
  if (cd > depth + EPS) issues.push({ code: 'container_too_deep' });
  levelClearHeights(rack.height, rack.levels, rack.has_bottom, rack.has_boards).forEach((c, j) => {
    if (ch + cargo > c + EPS) issues.push({ code: 'level_too_low', level: j + 1 });
  });
  return issues;
}

// ── 第五节：地面库位网格 ─────────────────────────────────
export function groundCenters(width: number, depth: number, rows: number, cols: number, aisle = 0) {
  const W = positive('width', width), D = positive('depth', depth);
  const R = positiveInt('rows', rows), C = positiveInt('cols', cols), A = nonNegative('aisle', aisle);
  const out: { row: number; col: number; x: number; z: number }[] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out.push({ row: r, col: c, x: (c + 0.5) * W, z: r * (D + A) + 0.5 * D });
  return out;
}

export function groundIssues(width: number, depth: number, container: ContainerSize): Issue[] {
  const W = positive('width', width), D = positive('depth', depth);
  const [cw, cd] = size('container', container);
  return cw > W + EPS || cd > D + EPS ? [{ code: 'container_too_large' }] : [];
}

// ── 坐标变换与命名 ───────────────────────────────────────
type CosSin = readonly [number, number];
function cosSin(rotationDeg: number): CosSin {
  const deg = ((num('rotation', rotationDeg) % 360) + 360) % 360;
  if (deg === 0) return [1, 0];
  if (deg === 90) return [0, 1];
  if (deg === 180) return [-1, 0];
  if (deg === 270) return [0, -1];
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}
const apply = (ox: number, oz: number, [c, s]: CosSin, lx: number, lz: number): P2 => [ox + lx * c - lz * s, oz + lx * s + lz * c];

export function toWorld(originX: number, originZ: number, rotationDeg: number, lx: number, lz: number): P2 {
  return apply(num('origin_x', originX), num('origin_z', originZ), cosSin(rotationDeg), num('lx', lx), num('lz', lz));
}

function prefixOf(prefix: unknown): string {
  if (typeof prefix !== 'string' || !prefix.trim()) throw new RangeError('prefix must be a non-empty string');
  return prefix.trim();
}
const pad = (n: number, d: number) => String(n).padStart(d, '0');

export function rackSlotName(prefix: string, row: number, col: number, level: number, digits = 2): string {
  const p = prefixOf(prefix), d = positiveInt('digits', digits);
  return `${p}-${pad(positiveInt('row', row), d)}-${pad(positiveInt('col', col), d)}-${positiveInt('level', level)}`;
}

export function groundSlotName(prefix: string, row: number, col: number, digits = 2): string {
  const p = prefixOf(prefix), d = positiveInt('digits', digits);
  return `${p}-${pad(positiveInt('row', row), d)}-${pad(positiveInt('col', col), d)}`;
}

// ── 第七节：停靠点与可用侧 ───────────────────────────────
export function stopPoints(facilityDepth: number, columnX: number, vehicleDepth: number, gap = DEFAULT_GAP): Record<Side, P2> {
  const D = positive('facility_depth', facilityDepth), x = num('column_x', columnX);
  const d = positive('vehicle_depth', vehicleDepth), g = nonNegative('gap', gap);
  return { above: [x, -(g + d / 2)], below: [x, D + g + d / 2] };
}

function rawFootprint(x: number, z: number, cs: CosSin, width: number, depth: number, margin: number): P2[] {
  const hw = width / 2 + margin, hd = depth / 2 + margin;
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as P2[]).map(([lx, lz]) => apply(x, z, cs, lx, lz));
}

export function footprint(x: number, z: number, rotationDeg: number, width: number, depth: number, margin = 0): P2[] {
  return rawFootprint(num('x', x), num('z', z), cosSin(rotationDeg), positive('width', width), positive('depth', depth),
    nonNegative('margin', margin));
}

/** 分离轴判断两个凸多边形是否重叠；任一轴上投影重叠长度不超过 eps 即视为不重叠（贴边不算）。 */
export function quadsOverlap(a: P2[], b: P2[], eps = OVERLAP_EPS): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ex = q[0] - p[0], ez = q[1] - p[1], len = Math.hypot(ex, ez);
      if (len === 0) continue;
      const nx = -ez / len, nz = ex / len;
      const pa = a.map(v => v[0] * nx + v[1] * nz), pb = b.map(v => v[0] * nx + v[1] * nz);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= eps) return false;
    }
  }
  return true;
}

const orient = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(p: P2, a: P2, b: P2, eps = OVERLAP_EPS): boolean {
  if (Math.abs(orient(a, b, p)) > eps * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))) return false;
  return Math.min(a[0], b[0]) - eps <= p[0] && p[0] <= Math.max(a[0], b[0]) + eps
    && Math.min(a[1], b[1]) - eps <= p[1] && p[1] <= Math.max(a[1], b[1]) + eps;
}
function pointIn(polygon: P2[], p: P2): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) if (onSegment(p, polygon[i], polygon[(i + 1) % n])) return true;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x > p[0]) inside = !inside;
    }
  }
  return inside;
}
function properCross(a: P2, b: P2, c: P2, d: P2, eps = 1e-12): boolean {
  const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** points 组成的多边形（如车身外框）完全位于 polygon 内（允许贴边）。适用于凹多边形边界。 */
export function polygonContains(polygon: P2[], points: P2[]): boolean {
  if (!points.every(p => pointIn(polygon, p))) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < polygon.length; j++) if (properCross(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return false;
    if (!pointIn(polygon, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) return false;
  }
  return true;
}

export function sideAvailability<K extends string>(candidates: Record<K, P2[]>, obstacles: P2[][], bounds: P2[]): Record<K, boolean> {
  const out = {} as Record<K, boolean>;
  for (const side of Object.keys(candidates) as K[]) {
    const quad = candidates[side];
    out[side] = polygonContains(bounds, quad) && !obstacles.some(o => quadsOverlap(quad, o));
  }
  return out;
}

// ── 第六、七节：耗时 ─────────────────────────────────────
export function toSeconds(value: number, unit: TimeUnit): number {
  if (!Object.prototype.hasOwnProperty.call(UNIT_SECONDS, unit)) throw new RangeError(`unknown time unit ${String(unit)}`);
  return positive('value', value) * UNIT_SECONDS[unit];
}

export function travelSeconds(distance: number, speed: number): number {
  return nonNegative('distance', distance) / positive('speed', speed);
}

export function handlingSeconds(fixedS: number, supportHeight: number, liftSpeed: number | null | undefined): number {
  const fixed = nonNegative('fixed_s', fixedS), h = nonNegative('support_height', supportHeight);
  if (liftSpeed === null || liftSpeed === undefined) return fixed;
  return fixed + (2 * h) / positive('lift_speed', liftSpeed);
}

// ── 批量展开 ─────────────────────────────────────────────
function vehicleOf(v: VehicleSize | null | undefined): [number, number] {
  const x = v ?? DEFAULT_VEHICLE;
  return [positive('vehicle.width', x.width), positive('vehicle.depth', x.depth)];
}

function column(ox: number, oz: number, cs: CosSin, rotation: number, D: number, x: number, vw: number, vd: number,
  gap: number, extra: { column: number; name?: string }, z0 = 0): StopColumn {
  const local = stopPoints(D, x, vd, gap);
  const stops = {} as StopColumn['stops'], prints = {} as StopColumn['footprints'];
  for (const side of ['above', 'below'] as Side[]) {
    const [lx, lz] = local[side];
    const [wx, wz] = apply(ox, oz, cs, lx, lz + z0);
    stops[side] = { position: [wx, wz], heading: rotation };
    prints[side] = rawFootprint(wx, wz, cs, vw, vd, gap);
  }
  return { ...extra, stops, footprints: prints };
}

const quad = (ox: number, oz: number, cs: CosSin, x0: number, z0: number, x1: number, z1: number): P2[] =>
  ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as P2[]).map(([x, z]) => apply(ox, oz, cs, x, z));

function originOf(origin: unknown): P2 {
  const o = Array.isArray(origin) ? origin : [];
  return [num('origin.x', o[0]), num('origin.z', o[1])];
}

export function expandRackGroup(group: RackGroupSpec, container: ContainerSize, vehicle?: VehicleSize | null) {
  const prefix = prefixOf(group?.prefix), row = positiveInt('row', group.row);
  const [ox, oz] = originOf(group.origin);
  const rotation = num('rotation', group.rotation ?? 0), cs = cosSin(rotation);
  const elevation = num('elevation', group.elevation ?? 0), gap = nonNegative('gap', group.gap ?? DEFAULT_GAP);
  const D = positive('depth', group.depth), groups = positiveInt('groups', group.groups);
  const w = positive('center_spacing', group.center_spacing);
  const [cw, , ch] = size('container', container);
  const [vw, vd] = vehicleOf(vehicle);
  const widths = rackWidths(w, groups);
  const xs = rackColumnCenters(w, groups, cw);
  const perGroup = Math.max(1, Math.floor(xs.length / groups));
  const supports = levelSupportHeights(group.height, group.levels, group.has_bottom, group.has_boards);
  const slots: RackSlot[] = [], columns: StopColumn[] = [];
  xs.forEach((x, i) => {
    const col = i + 1, [wx, wz] = apply(ox, oz, cs, x, D / 2), gi = Math.floor(i / perGroup) + 1;
    supports.forEach((sup, j) => slots.push({ name: rackSlotName(prefix, row, col, j + 1), column: col, level: j + 1,
      group: gi, center: [wx, elevation + sup + ch / 2, wz], support_height: sup }));
    columns.push(column(ox, oz, cs, rotation, D, x, vw, vd, gap, { column: col }));
  });
  return { slots, columns, outline: quad(ox, oz, cs, 0, 0, widths.row_outer, D), issues: rackIssues(group, container) };
}

export function expandGroundBatch(batch: GroundBatchSpec, container: ContainerSize, vehicle?: VehicleSize | null) {
  const prefix = prefixOf(batch?.prefix);
  const [ox, oz] = originOf(batch.origin);
  const rotation = num('rotation', batch.rotation ?? 0), cs = cosSin(rotation);
  const elevation = num('elevation', batch.elevation ?? 0), gap = nonNegative('gap', batch.gap ?? DEFAULT_GAP);
  const W = positive('width', batch.width), D = positive('depth', batch.depth);
  const rows = positiveInt('rows', batch.rows), cols = positiveInt('cols', batch.cols);
  const aisle = nonNegative('aisle', batch.aisle ?? 0);
  const [, , ch] = size('container', container);
  const [vw, vd] = vehicleOf(vehicle);
  const slots: GroundSlot[] = [], columns: StopColumn[] = [], cells: P2[][] = [];
  groundCenters(W, D, rows, cols, aisle).forEach((cell, i) => {
    const name = groundSlotName(prefix, cell.row + 1, cell.col + 1);
    const x0 = cell.col * W, z0 = cell.row * (D + aisle);
    const [wx, wz] = apply(ox, oz, cs, cell.x, cell.z);
    slots.push({ name, row: cell.row + 1, col: cell.col + 1, level: 1, center: [wx, elevation + ch / 2, wz], support_height: 0 });
    // 停靠点在单个库位自身的外框中计算，再平移到该格位置
    columns.push(column(ox, oz, cs, rotation, D, cell.x, vw, vd, gap, { column: i + 1, name }, z0));
    cells.push(quad(ox, oz, cs, x0, z0, x0 + W, z0 + D));
  });
  const totalDepth = rows * D + (rows - 1) * aisle;
  return { slots, columns, cells, outline: quad(ox, oz, cs, 0, 0, cols * W, totalDepth), issues: groundIssues(W, D, container) };
}
