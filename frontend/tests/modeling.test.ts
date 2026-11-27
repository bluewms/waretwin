import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import * as M from '../src/layout/modeling';
import type { P2 } from '../src/layout/types';

/** 与 backend/tests/test_modeling.py 共用的用例：fn 为 Python 名称，这里映射到 camelCase。 */
const CASES: { fn: string; args: unknown[]; expected: unknown }[] =
  JSON.parse(readFileSync(new URL('../../backend/tests/fixtures/modeling_cases.json', import.meta.url), 'utf-8'));
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function close(actual: unknown, expected: unknown, tol = 1e-9): boolean {
  if (typeof expected === 'number') return typeof actual === 'number' && Math.abs(actual - expected) <= tol;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => close(actual[i], e, tol));
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    const a = actual as Record<string, unknown>, e = expected as Record<string, unknown>;
    const ka = Object.keys(a).sort(), ke = Object.keys(e).sort();
    return ka.length === ke.length && ka.every((k, i) => k === ke[i]) && ke.every(k => close(a[k], e[k], tol));
  }
  return actual === expected;
}
const near = (actual: unknown, expected: unknown) => expect(close(actual, expected)).toBe(true);

describe('shared cases (parity with Python)', () => {
  test('every case matches backend/app/modeling.py', () => {
    const fns = M as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const c of CASES) {
      const fn = fns[camel(c.fn)];
      expect(typeof fn).toBe('function');
      const result = fn(...c.args);
      if (!close(result, c.expected)) throw new Error(`${c.fn}(${JSON.stringify(c.args).slice(0, 120)}) → ${JSON.stringify(result).slice(0, 300)}`);
    }
  });
});

describe('rack width and capacity', () => {
  test('width conversion', () => {
    near(M.rackWidths(2.5, 1), { clear: 2.4, group_outer: 2.6, row_outer: 2.6 });
    near(M.rackWidths(2.5, 10).row_outer, 25.1);
  });
  test('exact division capacity', () => {
    for (const [clear, width, n] of [[2.4, 1.2, 2], [3.6, 1.2, 3], [0.3, 0.1, 3]]) {
      const r = M.levelSlots(clear, width);
      expect(r.count).toBe(n);
      near(r.gap, 0);
    }
  });
  test('container wider than clear width', () => {
    expect(M.levelSlots(0.9, 1.0)).toEqual({ count: 0, gap: null, offsets: [] });
  });
  test('rejects invalid rack input', () => {
    for (const args of [[0, 1], [2.5, 0], [2.5, 1.5], [NaN, 1], [true, 1], [0.1, 1], [Infinity, 1]] as unknown as [number, number][]) {
      expect(() => M.rackWidths(...args)).toThrow(RangeError);
    }
  });
});

describe('levels', () => {
  test('support heights and bottom option keeps level count', () => {
    near(M.levelSupportHeights(3, 3, false, false), [0, 1, 2]);
    near(M.levelSupportHeights(3, 3, true, true), [0.14, 1.04, 2.04]);
    for (const b of [true, false]) for (const p of [true, false]) expect(M.levelSupportHeights(3, 3, b, p)).toHaveLength(3);
  });
  test('rack issues', () => {
    const rack = { center_spacing: 2.5, groups: 1, depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: false };
    expect(M.rackIssues(rack, { width: 1.1, depth: 1.2, height: 1.0 })).toEqual([{ code: 'level_too_low', level: 1 }, { code: 'level_too_low', level: 2 }]);
    expect(M.rackIssues(rack, { width: 1.1, depth: 1.2, height: 0.8 })).toEqual([]);
  });
  test('rejects invalid levels', () => {
    for (const levels of [0, 1.5, true, -1] as unknown as number[]) expect(() => M.levelSupportHeights(3, levels, false, false)).toThrow(RangeError);
  });
});

describe('ground grid, rotation, naming', () => {
  test('rotation matches navgrid', () => {
    near(M.toWorld(0, 0, 90, 1, 0), [0, 1]);
    near(M.toWorld(10, 5, 0, 2, 3), [12, 8]);
    near(M.toWorld(0, 0, -90, 1, 0), [0, -1]);
  });
  test('names', () => {
    expect(M.rackSlotName('N', 1, 2, 3)).toBe('N-01-02-3');
    expect(M.rackSlotName('A', 12, 105, 1)).toBe('A-12-105-1');
    expect(M.groundSlotName('F', 1, 2)).toBe('F-01-02');
    expect(() => M.rackSlotName('', 1, 1, 1)).toThrow(RangeError);
    expect(() => M.rackSlotName('N', 0, 1, 1)).toThrow(RangeError);
  });
});

describe('stop points and availability', () => {
  const rackA: P2[] = [[0, 0], [2.6, 0], [2.6, 1.2], [0, 1.2]];
  const vehicle = M.footprint(1.3, -0.6, 0, 2, 1, 0.1);
  test('touching is not overlap; 1 cm overlap detected', () => {
    expect(M.quadsOverlap(rackA, vehicle)).toBe(false);
    expect(M.quadsOverlap([[0, -2.39], [2.6, -2.39], [2.6, -1.19], [0, -1.19]], vehicle)).toBe(true);
  });
  test('concave bounds', () => {
    const L: P2[] = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];
    expect(M.polygonContains(L, [[7, 4], [4, 7], [3, 6], [6, 3]])).toBe(false);
    expect(M.polygonContains(L, [[1, 1], [4, 1], [4, 4], [1, 4]])).toBe(true);
  });
});

describe('timing', () => {
  test('conversions and handling time', () => {
    expect(M.toSeconds(5, 'min')).toBe(300);
    expect(M.toSeconds(2, 'h')).toBe(7200);
    expect(() => M.toSeconds(0, 's')).toThrow(RangeError);
    expect(() => M.toSeconds(1, 'day' as M.TimeUnit)).toThrow(RangeError);
    near(M.travelSeconds(10, 0.5), 20);
    near(M.handlingSeconds(15, 2, 0.2), 35);
    near(M.handlingSeconds(15, 2, null), 15);
    expect(() => M.handlingSeconds(15, 2, 0)).toThrow(RangeError);
  });
});

describe('expansion', () => {
  const group = { prefix: 'N', row: 1, origin: [5, 5] as P2, rotation: 0, center_spacing: 2.5, groups: 10,
    depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: true };
  test('ten rack groups', () => {
    const r = M.expandRackGroup(group, { width: 1, depth: 1, height: 0.8 });
    expect(r.slots).toHaveLength(60);
    expect(r.slots[0].name).toBe('N-01-01-1');
    expect(r.slots[59].name).toBe('N-01-20-3');
    const xs = r.outline.map(p => p[0]);
    near(Math.max(...xs) - Math.min(...xs), 25.1);
  });
  test('tight 10 × 10 ground grid leaves inner rows unreachable; aisle fixes it', () => {
    const bounds: P2[] = [[0, 0], [50, 0], [50, 50], [0, 50]];
    const batch = { prefix: 'F', origin: [5, 5] as P2, rotation: 0, width: 1.3, depth: 1.3, rows: 10, cols: 10 };
    const sides = (aisle: number) => {
      const r = M.expandGroundBatch({ ...batch, aisle }, { width: 1.1, depth: 1.1, height: 0.15 });
      return r.columns.map((c, i) => M.sideAvailability(c.footprints, [...r.cells.slice(0, i), ...r.cells.slice(i + 1)], bounds));
    };
    const tight = sides(0);
    tight.forEach((s, i) => {
      const row = Math.floor(i / 10);
      expect(s).toEqual(row === 0 ? { above: true, below: false } : row === 9 ? { above: false, below: true } : { above: false, below: false });
    });
    expect(sides(1.2).every(s => s.above || s.below)).toBe(true);
  });
  test('50k slots under budget', () => {
    const t = performance.now();
    const r = M.expandRackGroup({ ...group, groups: 834, levels: 15, height: 7.5 }, { width: 0.6, depth: 0.4, height: 0.3 });
    expect(r.slots.length >= 50_000).toBe(true);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
