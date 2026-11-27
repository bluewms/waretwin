/** warehouse_layout.json 的型別，對應 docs/layout/warehouse_layout_格式說明.md */
export type P2 = [number, number];
export type P3 = [number, number, number];
export type Rect = [number, number, number, number];

export interface LayoutZone { id: string; name: string; color: string; polygon: P2[]; floor?: number }
export interface LayoutDock { id: string; kind: "INBOUND" | "OUTBOUND"; zone: string; rect: Rect; door: P2 }
export interface LayoutRack { id: string; zone: string; position: P3; size: P3; rotation: number; levels: number; model: string; blocks_grid: boolean; floor?: number }
export interface LayoutConveyor { id: string; name: string; zone: string; path: P2[]; width: number; speed_mps: number; direction: string; blocks_grid: boolean; /** 這條輸送帶供應的工作站；故障時該站的卸貨時間變長 */ feeds?: string }
export interface LayoutStation { id: string; kind: string; zone: string; rect: Rect; access_point: P2 }
export interface LayoutCharging { id: string; zone: string; position: P3; heading: number; power_kw: number; access_point: P2 }
export interface LayoutParking { id: string; zone: string; rect: Rect; slots: number }
export interface LayoutRestricted { id: string; name: string; rect: Rect; robots_allowed: boolean }
export interface LayoutWalkway { id: string; polygon: P2[]; robots_allowed: boolean; speed_limit_mps: number }
export interface LayoutCamera { id: string; zone: string; floor?: number; position: P3; look_at: P3; fov_deg: number; range_m: number }
export interface LayoutSensor { id: string; kind: string; zone: string; position: P3 }
export interface LayoutLocation { id: string; kind: string; zone: string; floor?: number; rack_id: string | null; level_range: [number, number] | null; access_point: P2 }
export interface LayoutSpawnRobot { id: string; position: P3; heading: number; battery: number; floor?: number }
export interface LayoutFloor { id: number; name: string; elevation: number; footprint?: P2[] }
export interface LayoutLift { id: string; cell: [number, number]; floors: number[]; ride_ticks: number }

// ── 设施（开发说明第二至第七节；schema 1.1，均为可选字段） ─────────────
export type ContainerType = 'plastic_pallet' | 'wood_pallet' | 'plastic_box';
/** 组织级容器模板；布局只保存 container_id，发布时写入 container_snapshots */
export interface ContainerTemplate { id: string; name: string; type: ContainerType; color: string; width: number; depth: number; height: number; created_at?: string; updated_at?: string }
/** 一组货架；批量创建时同一排的各组共享 row_key，column_start 递增 */
export interface LayoutRackGroup {
  id: string; row_key: string; prefix: string; row: number; column_start: number; floor: number;
  /** 网格外框起点 [x, z] */ origin: P2; rotation: number;
  /** 左右立柱中心距 */ center_spacing: number; depth: number; height: number; levels: number;
  has_bottom: boolean; has_boards: boolean; container_id: string; cargo_height?: number;
}
export interface LayoutGroundBatch {
  id: string; prefix: string; floor: number; origin: P2; rotation: number; width: number; depth: number;
  rows: number; cols: number; aisle: number; container_id: string; cargo_height?: number;
}
export type TimeUnit = 's' | 'min' | 'h';
export interface EquipmentTiming { mode: 'speed' | 'production'; speed_mps?: number; production_value?: number; production_unit?: TimeUnit }
export interface VehicleParams { width: number; depth: number; pick_s: number; drop_s: number; lift_speed_mps: number | null; low_battery_pct: number }
export interface LayoutEquipment {
  id: string; category: string; number: string; name?: string; floor: number; position: P2; rotation: number;
  timing: EquipmentTiming; vehicle?: VehicleParams; size?: { width: number; depth: number };
}
export interface EquipmentCategory {
  code: string; name: string; kind: 'vehicle' | 'lift' | 'conveyor' | 'station'; model: string;
  size: { width: number; depth: number; height: number };
  defaults: { timing: EquipmentTiming; vehicle?: Omit<VehicleParams, 'width' | 'depth'> };
  work_points?: { key: string; label: string; offset: P2; heading?: number }[];
}

export interface WarehouseLayout {
  schema_version: string;
  id: string;
  name: string;
  units: string;
  size: { width: number; depth: number; height: number };
  grid: { cell_size: number; cols: number; rows: number };
  floors: LayoutFloor[];
  /** 夾層支撐柱位（立在 F1 地面）：F1 導航網格以柱底板 0.9×0.9 m 封成障礙 */
  columns?: Array<[number, number]>;
  lifts: LayoutLift[];
  zones: LayoutZone[];
  docks: LayoutDock[];
  racks: LayoutRack[];
  conveyors: LayoutConveyor[];
  stations: LayoutStation[];
  charging_stations: LayoutCharging[];
  parking: LayoutParking[];
  restricted_areas: LayoutRestricted[];
  walkways: LayoutWalkway[];
  cameras: LayoutCamera[];
  sensors: LayoutSensor[];
  locations: LayoutLocation[];
  /** 建築結構柱等實體障礙：F1 導航網格整塊封鎖；WarehouseShell 由此渲染柱子 */
  obstacles: Array<{ id: string; kind: string; rect: [number, number, number, number] }>;
  spawn: { robots: LayoutSpawnRobot[] };
  rack_groups?: LayoutRackGroup[];
  ground_batches?: LayoutGroundBatch[];
  equipment?: LayoutEquipment[];
  /** 车身与设施之间的安全间隙，默认 0.1 m */
  stop_gap?: number;
  container_snapshots?: Record<string, ContainerTemplate>;
}
