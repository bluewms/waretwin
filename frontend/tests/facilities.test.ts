import { describe, expect, test } from 'vitest';
import type { ContainerTemplate, EquipmentCategory, WarehouseLayout } from '../src/layout/types';
import {
  addDisabledReason, columnAt, columnAvailability, containerMap, createEquipment, createRackRow, expandFacilities, handlingFor,
  markSchema, nextEquipmentNumber, nextRowNumber, normalizeLayout, rackPreview, referenceVehicle, rotateRow,
} from '../src/workspace/facilities';

const BOX: ContainerTemplate = { id: 'c1', name: 'Box', type: 'plastic_box', color: '#3a9d6e', width: 1, depth: 1, height: 0.8 };
const FORK: EquipmentCategory = { code: 'SFL-CBD20', name: 'Forklift', kind: 'vehicle', model: 'builtin:forklift',
  size: { width: 2, depth: 1, height: 2.2 }, defaults: { timing: { mode: 'speed', speed_mps: 1 }, vehicle: { pick_s: 15, drop_s: 12, lift_speed_mps: 0.2, low_battery_pct: 20 } } };
const CHARGER: EquipmentCategory = { code: 'CHARGER', name: 'Charger', kind: 'station', model: 'builtin:charger',
  size: { width: 0.9, depth: 0.5, height: 1.2 }, defaults: { timing: { mode: 'production', production_value: 2, production_unit: 'h' } } };
const CATALOG = { [FORK.code]: FORK, [CHARGER.code]: CHARGER };

function layout(): WarehouseLayout {
  return { schema_version: '1.0', id: 'w', name: 'W', units: 'm', size: { width: 60, depth: 40, height: 10 },
    grid: { cell_size: 1, cols: 60, rows: 40 }, floors: [{ id: 1, name: 'F1', elevation: 0 }], lifts: [], zones: [], docks: [], racks: [],
    conveyors: [], stations: [], charging_stations: [], parking: [], restricted_areas: [], walkways: [], cameras: [], sensors: [],
    locations: [], obstacles: [], spawn: { robots: [] } } as WarehouseLayout;
}
const row = (origin: [number, number], groups: number, rowNo = 1, rotation = 0) => createRackRow({ prefix: 'N', row: rowNo, floor: 1, origin, rotation,
  center_spacing: 2.5, depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: false, groups, container_id: 'c1' }, BOX);

describe('facilities helpers', () => {
  test('legacy layout normalises without mutation; schema bumps only with facilities', () => {
    const legacy = layout();
    const n = normalizeLayout(legacy);
    expect(n.rack_groups).toEqual([]); expect(legacy.rack_groups).toBe(undefined);
    markSchema(n); expect(n.schema_version).toBe('1.0');
    n.rack_groups = row([5, 5], 1); markSchema(n); expect(n.schema_version).toBe('1.1');
  });
  test('rack row: contiguous origins, continuous columns, shared row key', () => {
    const groups = row([5, 5], 10, 1, 90);
    expect(groups).toHaveLength(10);
    expect(new Set(groups.map(g => g.row_key)).size).toBe(1);
    expect(groups.map(g => g.column_start)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
    expect(groups[1].origin[0]).toBeCloseTo(5, 9); expect(groups[1].origin[1]).toBeCloseTo(7.5, 9);
  });
  test('rotating a row keeps groups contiguous around the first origin', () => {
    const groups = row([5, 5], 4);
    rotateRow(groups, groups[0].row_key, 90);
    expect(groups.map(g => g.rotation)).toEqual([90, 90, 90, 90]);
    groups.forEach((g, k) => { expect(g.origin[0]).toBeCloseTo(5, 9); expect(g.origin[1]).toBeCloseTo(5 + 2.5 * k, 9); });
    rotateRow(groups, groups[0].row_key, 0);
    groups.forEach((g, k) => { expect(g.origin[0]).toBeCloseTo(5 + 2.5 * k, 9); expect(g.origin[1]).toBeCloseTo(5, 9); });
  });
  test('rack preview reports capacity and issues', () => {
    const p = rackPreview({ center_spacing: 2.5, depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: false, groups: 10 }, BOX);
    expect(p.per).toBe(2); expect(p.total).toBe(60); expect(p.widths?.row_outer).toBeCloseTo(25.1, 9); expect(p.issues).toEqual([]);
    expect(rackPreview({ center_spacing: 2.5, depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: false, groups: 1 },
      { ...BOX, width: 2.5 }).issues).toEqual([{ code: 'no_capacity' }]);
    expect(rackPreview({ center_spacing: 0.05, depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: false, groups: 1 }, BOX).error).toBeTruthy();
  });
  test('numbers', () => {
    const l = normalizeLayout(layout());
    l.rack_groups = row([5, 5], 2, 3);
    expect(nextRowNumber(l, 'N')).toBe(4); expect(nextRowNumber(l, 'M')).toBe(1);
    l.equipment = [createEquipment(FORK, '001', 1, [3, 3])];
    expect(nextEquipmentNumber(l, 'SFL-CBD20')).toBe('002'); expect(nextEquipmentNumber(l, 'CHARGER')).toBe('001');
  });
  test('reference vehicle and handling time', () => {
    const l = normalizeLayout(layout());
    expect(referenceVehicle(l, CATALOG)).toEqual({ width: 2, depth: 1, missing: true });
    const v = createEquipment(FORK, '001', 1, [3, 3]);
    l.equipment = [v, createEquipment(CHARGER, '01', 1, [30, 1])];
    expect(referenceVehicle(l, CATALOG).missing).toBe(false);
    expect(handlingFor(v, 2)).toEqual({ pick: 35, drop: 32 });
    expect(handlingFor(undefined, 2)).toBeNull();
  });
  test('expand, click-to-column and availability (back to back)', () => {
    const l = normalizeLayout(layout());
    l.rack_groups = [...row([5, 10], 2, 1), ...row([5, 11.2], 2, 2)];
    const containers = containerMap([BOX], l, false);
    const f = expandFacilities(l, containers, { width: 2, depth: 1 });
    expect(f).toHaveLength(4); expect(f[0].slots[0].name).toBe('N-01-01-1'); expect(f[1].slots[0].name).toBe('N-01-03-1');
    expect(columnAt(f[0], [f[0].slots[3].center[0], 10.6])).toBe(1);
    expect(columnAvailability(l, f, f[0], 0, CATALOG)).toEqual({ above: true, below: false });
    expect(columnAvailability(l, f, f[2], 1, CATALOG)).toEqual({ above: false, below: true });
    l.rack_groups[0].container_id = 'gone';
    expect(expandFacilities(l, containers, { width: 2, depth: 1 })[0].error).toBe('container_missing');
  });
  test('published layouts use their snapshot', () => {
    const l = { ...layout(), container_snapshots: { c1: BOX } };
    expect(containerMap([{ ...BOX, width: 0.5 }], l, true).c1.width).toBe(1);
    expect(containerMap([{ ...BOX, width: 0.5 }], l, false).c1.width).toBe(0.5);
  });
  test('add entry disabled reasons', () => {
    const base = { hasLayout: true, readOnly: false, busy: false, containerCount: 1, catalogLoaded: true };
    expect(addDisabledReason('rack', base)).toBeNull();
    expect(addDisabledReason('rack', { ...base, readOnly: true })).toBe('Published versions are read-only. Create an alternative draft to edit.');
    expect(addDisabledReason('rack', { ...base, containerCount: 0 })).toBe('Create a container template first');
    expect(addDisabledReason('ground', { ...base, hasLayout: false })).toBe('Select or create a warehouse first');
    expect(addDisabledReason('container', { ...base, hasLayout: false })).toBeNull();
    expect(addDisabledReason('equipment', { ...base, catalogLoaded: false })).toBe('Equipment catalog is not loaded yet');
  });
});
