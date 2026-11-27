/**
 * 工作台三维预览：全部使用实例化网格（立柱按世界坐标去重、横梁、层板、容器、地面格、设备、停靠车辆）。
 * 旋转约定与 modeling.ts 一致；Three.js 绕 Y 轴正向与之相反，因此使用 rotation.y = −θ。
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { ContainerTemplate, EquipmentCategory, LayoutRackGroup, WarehouseLayout } from '../layout/types';
import { BEAM_HEIGHT, BOARD_THICKNESS, POST_WIDTH, toWorld } from '../layout/modeling';
import { equipmentSize, type ExpandedFacility } from './facilities';

type Box = { p: [number, number, number]; s: [number, number, number]; r: number; c?: string };
const dummy = new THREE.Object3D();
const tint = new THREE.Color();
const rad = (deg: number) => (deg * Math.PI) / 180;

function Boxes({ items, color, opacity = 1, castShadow = false }: { items: Box[]; color: string; opacity?: number; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const invalidate = useThree(state => state.invalidate);
  const perColor = items.some(i => i.c);
  useLayoutEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    items.forEach((b, i) => {
      dummy.position.set(...b.p); dummy.scale.set(...b.s); dummy.rotation.set(0, -b.r, 0); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (perColor) mesh.setColorAt(i, tint.set(b.c ?? color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();   // frameloop="demand"：实例矩阵是手动写入的，需要主动请求重绘
  }, [items, color, perColor, invalidate]);
  if (!items.length) return null;
  return <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow={castShadow} receiveShadow frustumCulled={false}>
    <boxGeometry />
    <meshLambertMaterial color={perColor ? '#ffffff' : color} transparent={opacity < 1} opacity={opacity} />
  </instancedMesh>;
}

/** 选中对象变化时把镜头对准它（保持当前观察方向，距离约 10 米）。 */
function Focus({ point }: { point: [number, number, number] | null }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const key = point ? point.map(v => v.toFixed(2)).join(',') : '';
  useEffect(() => {
    if (!point || !controls) return;
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.set(...point);
    camera.position.set(point[0] + dir.x * 10, point[1] + Math.max(dir.y * 10, 4), point[2] + dir.z * 10);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, controls]);
  return null;
}

export interface StopGhost { position: [number, number]; heading: number; width: number; depth: number; ok: boolean }

function build(layout: WarehouseLayout, facilities: ExpandedFacility[], floor: number, catalog: Record<string, EquipmentCategory>, highlight: string | null) {
  const elev = layout.floors.find(f => f.id === floor)?.elevation ?? 0;
  const posts: Box[] = [], beams: Box[] = [], boards: Box[] = [], containers: Box[] = [], cells: Box[] = [], equipment: Box[] = [];
  const seen = new Set<string>();
  const t = POST_WIDTH;
  for (const f of facilities) {
    if (f.floor !== floor || f.error || !f.container) continue;
    const c: ContainerTemplate = f.container;
    const r = rad(f.rotation);
    if (f.kind === 'rack') {
      const g = f.item as LayoutRackGroup;
      const w = g.center_spacing, D = g.depth, H = g.height, s = H / g.levels;
      const at = (lx: number, lz: number) => toWorld(g.origin[0], g.origin[1], g.rotation, lx, lz);
      for (const [lx, lz] of [[t / 2, t / 2], [w + t / 2, t / 2], [t / 2, D - t / 2], [w + t / 2, D - t / 2]]) {
        const [x, z] = at(lx, lz), key = `${x.toFixed(3)},${z.toFixed(3)}`;
        if (seen.has(key)) continue; seen.add(key);
        posts.push({ p: [x, elev + H / 2, z], s: [t, H, t], r });
      }
      for (let j = g.has_bottom ? 0 : 1; j < g.levels; j++) {
        const top = j === 0 ? BEAM_HEIGHT : j * s;
        for (const lz of [0.04, D - 0.04]) { const [x, z] = at(t / 2 + w / 2, lz); beams.push({ p: [x, elev + top - BEAM_HEIGHT / 2, z], s: [w, BEAM_HEIGHT, 0.08], r }); }
        if (g.has_boards) { const [x, z] = at(t / 2 + w / 2, D / 2); boards.push({ p: [x, elev + top + BOARD_THICKNESS / 2, z], s: [w - t, BOARD_THICKNESS, D], r }); }
      }
    } else {
      const b = f.item as { width: number; depth: number };
      for (const cell of f.cells) {
        const cx = (cell[0][0] + cell[2][0]) / 2, cz = (cell[0][1] + cell[2][1]) / 2;
        cells.push({ p: [cx, elev + 0.005, cz], s: [b.width - 0.04, 0.01, b.depth - 0.04], r });
      }
    }
    const color = c.type === 'wood_pallet' ? '#b07a48' : c.color;
    const hl = f.id === highlight ? '#f59e0b' : undefined;
    for (const slot of f.slots) {
      const [x, y, z] = slot.center;
      if (c.type === 'plastic_box') { containers.push({ p: [x, y, z], s: [c.width * 0.98, c.height * 0.98, c.depth * 0.98], r, c: hl ?? color }); continue; }
      // 托盘：顶板 + 三条纵梁，便于和料箱区分
      const deck = c.height * 0.3, leg = c.height - deck, rw = Math.min(0.12, c.width * 0.12);
      containers.push({ p: [x, y + c.height / 2 - deck / 2, z], s: [c.width, deck, c.depth], r, c: hl ?? color });
      for (const lx of [-c.width / 2 + rw / 2, 0, c.width / 2 - rw / 2]) {
        const dx = lx * Math.cos(r), dz = lx * Math.sin(r);
        containers.push({ p: [x + dx, y - c.height / 2 + leg / 2, z + dz], s: [rw, leg, c.depth], r, c: hl ?? color });
      }
    }
  }
  const KIND_COLOR: Record<string, string> = { vehicle: '#f08c2b', lift: '#4a6fa5', conveyor: '#3d8c5a', station: '#6c7a89' };
  for (const e of layout.equipment ?? []) {
    if (e.floor !== floor) continue;
    const cat = catalog[e.category], s = equipmentSize(e, cat);
    equipment.push({ p: [e.position[0], elev + s.height / 2, e.position[1]], s: [s.width, s.height, s.depth], r: rad(e.rotation), c: KIND_COLOR[cat?.kind ?? 'station'] });
  }
  return { elev, posts, beams, boards, containers, cells, equipment };
}

export function Preview3D({ layout, facilities, floor, catalog, highlight, ghosts, focus }: {
  layout: WarehouseLayout; facilities: ExpandedFacility[]; floor: number; catalog: Record<string, EquipmentCategory>;
  highlight: string | null; ghosts: StopGhost[]; focus: [number, number, number] | null;
}) {
  const data = useMemo(() => build(layout, facilities, floor, catalog, highlight), [layout, facilities, floor, catalog, highlight]);
  const { width: W, depth: D } = layout.size;
  const ghostBoxes = useMemo(() => ghosts.map(g => ({ p: [g.position[0], data.elev + 0.6, g.position[1]] as [number, number, number],
    s: [g.width, 1.2, g.depth] as [number, number, number], r: rad(g.heading), c: g.ok ? '#22c55e' : '#ef4444' })), [ghosts, data.elev]);
  const span = Math.max(W, D);
  // 5 万存放位置时的性能：限制像素倍率、只在画面变化时重绘（frameloop="demand"）
  return <Canvas shadows={false} dpr={[1, 1.5]} frameloop="demand" camera={{ position: [W / 2 + span * 0.35, span * 0.75, D + span * 0.45], fov: 45, near: 0.1, far: span * 10 }}
    style={{ background: '#dfe7ea' }} aria-label="3D preview">
    <ambientLight intensity={0.7} />
    <directionalLight position={[W, span, D]} intensity={0.9} />
    <mesh rotation-x={-Math.PI / 2} position={[W / 2, data.elev - 0.01, D / 2]} receiveShadow>
      <planeGeometry args={[W, D]} /><meshStandardMaterial color="#f4f6f7" />
    </mesh>
    <gridHelper args={[Math.ceil(span), Math.ceil(span), '#b9c6cc', '#d6dee2']} position={[W / 2, data.elev, D / 2]} />
    <Boxes items={data.posts} color="#2f3a4a" />
    <Boxes items={data.beams} color="#e07a1f" />
    <Boxes items={data.boards} color="#c7ced4" />
    <Boxes items={data.cells} color="#9fb3bd" opacity={0.6} />
    <Boxes items={data.containers} color="#3a9d6e" />
    <Boxes items={data.equipment} color="#6c7a89" />
    <Boxes items={ghostBoxes} color="#22c55e" opacity={0.45} />
    <OrbitControls target={[W / 2, data.elev, D / 2]} makeDefault />
    <Focus point={focus} />
  </Canvas>;
}
