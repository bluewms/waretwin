import { LanguageSwitch, useI18n } from "../i18n";
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, ClipboardCheck, Container, Copy, Download, Forklift, LayoutGrid, LogOut, Map as MapIcon, Package, Play, Plus, Redo2, Save, Send,
  Trash2, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { ContainerTemplate, EquipmentCategory, LayoutRack, P2, WarehouseLayout } from '../layout/types';
import { footprint } from '../layout/modeling';
import { setLayout } from '../state/store';
import { workspaceClient, WorkspaceError, type ContainerInput, type LayoutIssue, type LayoutRevision, type LayoutValidation, type Warehouse } from '../services/workspace';
import {
  addDisabledReason, columnAt, columnAvailability, containerMap, equipmentLabel, equipmentSize, expandFacilities, markSchema, normalizeLayout,
  referenceVehicle, type AddKind,
} from './facilities';
import { ContainerManager, EquipmentDialog, GroundDialog, RackDialog, kindLabel } from './FacilityDialogs';
import { FacilityInspector, type Selection } from './FacilityInspector';
import { IssueList } from './IssueList';
import { Preview3D, type StopGhost } from './Preview3D';
import './workspace.css';

type History = { past: WarehouseLayout[]; present: WarehouseLayout; future: WarehouseLayout[] };
type DragKind = 'legacy' | 'rack' | 'ground' | 'equipment';
const clone = <T,>(value: T): T => structuredClone(value);
const quadPath = (q: P2[]) => q.length ? `M${q.map(p => `${p[0]},${p[1]}`).join('L')}Z` : '';
const KIND_FILL: Record<string, string> = { vehicle: '#f6b26b', lift: '#9fb8dd', conveyor: '#9ccfae', station: '#c3ccd4' };

export function Workspace() {
  const { tr, label } = useI18n();
  const [access, setAccess] = useState('');
  const [token, setToken] = useState('');
  const api = useMemo(() => workspaceClient(token), [token]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [revision, setRevision] = useState<LayoutRevision | null>(null);
  const [revisions, setRevisions] = useState<Omit<LayoutRevision, 'document' | 'warehouse_id'>[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [floor, setFloor] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(0.5);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState<LayoutValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 60, depth: 40, height: 10 });
  const [templates, setTemplates] = useState<ContainerTemplate[]>([]);
  const [catalogList, setCatalogList] = useState<EquipmentCategory[]>([]);
  const [dialog, setDialog] = useState<AddKind | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: DragKind; id: string; x: number; z: number; before: WarehouseLayout } | null>(null);
  const layout = history?.present;
  const saved = useMemo(() => revision ? normalizeLayout(revision.document) : null, [revision]);
  const dirty = !!layout && JSON.stringify(layout) !== JSON.stringify(saved);
  const readOnly = revision?.state === 'published';
  const rack = sel?.kind === 'legacy' ? layout?.racks.find(item => item.id === sel.id) : undefined;
  const catalog = useMemo(() => Object.fromEntries(catalogList.map(c => [c.code, c])), [catalogList]);
  const containers = useMemo(() => layout ? containerMap(templates, layout, readOnly) : {}, [templates, layout, readOnly]);
  const vehicle = useMemo(() => layout ? referenceVehicle(layout, catalog) : null, [layout, catalog]);
  const facilities = useMemo(() => layout && vehicle ? expandFacilities(layout, containers, vehicle) : [], [layout, containers, vehicle]);
  const usedContainerIds = useMemo(() => new Set([...(layout?.rack_groups ?? []), ...(layout?.ground_batches ?? [])].map(x => x.container_id)), [layout]);

  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function refreshLibrary(client = api) {
    const [list, cat] = await Promise.all([client.containers(), client.equipmentCatalog()]);
    setTemplates(list); setCatalogList(cat.categories);
  }

  function load(next: LayoutRevision) {
    setValidation(null);
    setRevision(next); setHistory({ past: [], present: normalizeLayout(clone(next.document)), future: [] });
    setSel(null); setFloor(next.document.floors[0]?.id ?? 1); setZoom(1);
  }

  function edit(fn: (draft: WarehouseLayout) => void) {
    if (readOnly || busy) return;
    setHistory(current => {
      if (!current) return current;
      const next = clone(current.present); fn(next); markSchema(next);
      return { past: [...current.past.slice(-49), current.present], present: next, future: [] };
    });
  }

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  async function openWarehouse(id: string) {
    if (dirty && !window.confirm(tr("Discard unsaved changes?"))) return;
    await action(async () => {
      const rows = await api.revisions(id); setRevisions(rows);
      const preferred = rows.find(row => row.state === 'draft') ?? rows[0];
      if (preferred) load(await api.revision(id, preferred.id));
    });
  }

  function changeRack(key: 'x' | 'z' | 'width' | 'depth' | 'height' | 'rotation', value: number) {
    if (!Number.isFinite(value) || sel?.kind !== 'legacy') return;
    edit(draft => {
      const item = draft.racks.find(r => r.id === sel.id); if (!item) return;
      if (key === 'x') item.position[0] = value;
      else if (key === 'z') item.position[2] = value;
      else if (key === 'rotation') item.rotation = value;
      else item.size[key === 'width' ? 0 : key === 'height' ? 1 : 2] = Math.max(0.1, value);
    });
  }

  function pointer(event: React.PointerEvent | React.MouseEvent) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }

  function anchorOf(kind: DragKind, id: string, d: WarehouseLayout): P2 | null {
    if (kind === 'legacy') { const r = d.racks.find(x => x.id === id); return r ? [r.position[0], r.position[2]] : null; }
    if (kind === 'rack') return d.rack_groups?.find(x => x.id === id)?.origin ?? null;
    if (kind === 'ground') return d.ground_batches?.find(x => x.id === id)?.origin ?? null;
    return d.equipment?.find(x => x.id === id)?.position ?? null;
  }

  function moveTo(d: WarehouseLayout, kind: DragKind, id: string, p: P2) {
    if (kind === 'legacy') { const r = d.racks.find(x => x.id === id); if (r) { r.position[0] = p[0]; r.position[2] = p[1]; } }
    else if (kind === 'rack') { const g = d.rack_groups?.find(x => x.id === id); if (g) g.origin = p; }
    else if (kind === 'ground') { const b = d.ground_batches?.find(x => x.id === id); if (b) b.origin = p; }
    else { const e = d.equipment?.find(x => x.id === id); if (e) e.position = p; }
  }

  function startDrag(event: React.PointerEvent, kind: DragKind, id: string) {
    setSel({ kind, id });
    if (readOnly || busy || !layout || event.button !== 0) return;
    const point = pointer(event), anchor = anchorOf(kind, id, layout); if (!point || !anchor) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = { kind, id, x: point.x - anchor[0], z: point.y - anchor[1], before: clone(layout) };
  }

  function endDrag(cancel = false) {
    const active = drag.current; if (!active) return;
    setHistory(current => {
      if (!current) return current;
      if (cancel) return { ...current, present: active.before };
      const moved = JSON.stringify(anchorOf(active.kind, active.id, current.present)) !== JSON.stringify(anchorOf(active.kind, active.id, active.before));
      return moved ? { past: [...current.past.slice(-49), active.before], present: current.present, future: [] } : current;
    });
    drag.current = null;
  }

  function exportLayout() {
    if (!layout) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${layout.id}.json`; anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveTemplate(input: ContainerInput, id?: string): Promise<boolean> {
    setLibraryError('');
    try {
      if (id) await api.updateContainer(id, input); else await api.createContainer(input);
      setTemplates(await api.containers()); return true;
    } catch (err) { setLibraryError(err instanceof Error ? err.message : String(err)); return false; }
  }

  async function deleteTemplate(id: string) {
    setLibraryError('');
    try { await api.deleteContainer(id); setTemplates(await api.containers()); }
    catch (err) { setLibraryError(err instanceof Error ? err.message : String(err)); }
  }

  // ── 选中存放位置：停靠点、可用侧、车辆外形 ──
  const slotInfo = useMemo(() => {
    if (sel?.kind !== 'slot' || !layout || !vehicle) return null;
    const f = facilities.find(x => x.id === sel.id); const col = f?.columns[sel.column];
    if (!f || !col) return null;
    const sides = columnAvailability(layout, facilities, f, sel.column, catalog);
    const slot = f.slots[sel.column * f.levels + (sel.level - 1)];
    return { f, col, sides, slot };
  }, [sel, layout, facilities, vehicle, catalog]);
  const focus = useMemo((): [number, number, number] | null => {
    if (!layout || !sel) return null;
    if (sel.kind === 'slot' && slotInfo?.slot) return slotInfo.slot.center;
    const f = facilities.find(x => x.id === sel.id);
    if (f?.outline.length) {
      const xs = f.outline.map(p => p[0]), zs = f.outline.map(p => p[1]);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, 1, (Math.min(...zs) + Math.max(...zs)) / 2];
    }
    const e = sel.kind === 'equipment' ? layout.equipment?.find(x => x.id === sel.id) : undefined;
    return e ? [e.position[0], 1, e.position[1]] : null;
  }, [layout, sel, slotInfo, facilities]);
  const ghosts: StopGhost[] = slotInfo && vehicle ? (['above', 'below'] as const).map(side => ({
    position: slotInfo.col.stops[side].position, heading: slotInfo.col.stops[side].heading, width: vehicle.width, depth: vehicle.depth, ok: slotInfo.sides[side],
  })) : [];

  // ── 平面绘制（每个设施一条 path，避免为每个存放位置生成元素） ──
  const planShapes = useMemo(() => facilities.filter(f => f.floor === floor).map(f => {
    const c = f.container;
    const tops = c && !f.error ? f.slots.filter(s => s.level === 1).map(s => quadPath(footprint(s.center[0], s.center[2], f.rotation, c.width, c.depth))).join('') : '';
    return { f, outline: quadPath(f.outline), cells: f.cells.map(quadPath).join(''), tops, color: c?.color ?? '#999' };
  }), [facilities, floor]);

  const issueOwner = (issue: LayoutIssue) => {
    if (!layout || !issue.object_id) return null;
    const g = layout.rack_groups?.find(x => x.id === issue.object_id); if (g) return `${tr("Rack group")} ${g.prefix}-${String(g.row).padStart(2, '0')}`;
    const b = layout.ground_batches?.find(x => x.id === issue.object_id); if (b) return `${tr("Ground locations")} ${b.prefix}`;
    const e = layout.equipment?.find(x => x.id === issue.object_id); if (e) return equipmentLabel(e);
    return null;
  };

  if (!token) return <main className="wt-workspace wt-login">
    <form onSubmit={event => { event.preventDefault(); void action(async () => {
      const client = workspaceClient(access); await client.me(); setWarehouses(await client.warehouses());
      await refreshLibrary(client);
      setToken(access); setAccess('');
    }); }}>
      <LanguageSwitch />
      <h1>WareTwin</h1><h2>{tr("Customer workspace")}</h2>
      <label>{tr("Workspace access token")}<input type="password" autoComplete="off" value={access} onChange={e => setAccess(e.target.value)} required /></label>
      {error && <p role="alert">{label(error)}</p>}
      <button disabled={busy || !access} type="submit">{tr("Sign in")}</button>
      <a href="/">{tr("Open demo")}</a>
    </form>
  </main>;

  const addState = { hasLayout: !!layout, readOnly, busy, containerCount: templates.length, catalogLoaded: catalogList.length > 0 };
  const reasons = (['container', 'rack', 'ground', 'equipment'] as AddKind[]).map(k => addDisabledReason(k, addState));
  const firstReason = reasons.find(r => r) ?? null;
  const onFloor = <T extends { floor?: number }>(items: T[] | undefined) => (items ?? []).filter(x => (x.floor ?? 1) === floor);
  const rows = (() => {
    const map = new Map<string, { key: string; prefix: string; row: number; groups: string[] }>();
    for (const g of onFloor(layout?.rack_groups)) {
      const entry = map.get(g.row_key) ?? { key: g.row_key, prefix: g.prefix, row: g.row, groups: [] };
      entry.groups.push(g.id); map.set(g.row_key, entry);
    }
    return [...map.values()];
  })();

  return <main className="wt-workspace">
    <header className="wt-header"><h1>WareTwin <span>{tr("Layouts")}</span></h1><a href="/">{tr("Demo")}</a>
      <LanguageSwitch />
      <button title={tr("Sign out")} aria-label={tr("Sign out")} onClick={() => {
        if (dirty && !window.confirm(tr("Discard unsaved changes?"))) return;
        setToken(''); setRevision(null); setHistory(null); setWarehouses([]); setRevisions([]); setSel(null);
      }}><LogOut size={18} /></button>
    </header>
    {error && <div className="wt-error" role="alert">{label(error)}</div>}
    <div className="wt-toolbar">
      <select aria-label={tr("Warehouse")} disabled={busy} value={revision?.warehouse_id ?? ''} onChange={e => void openWarehouse(e.target.value)}>
        <option value="" disabled>{tr("Select warehouse")}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <button title={tr("New warehouse")} aria-label={tr("New warehouse")} disabled={busy} onClick={() => setCreateOpen(true)}><Plus size={18} /></button>
      {revision && <select aria-label={tr("Revision")} disabled={busy} value={revision.id} onChange={e => {
        const id = e.target.value;
        if (dirty && !window.confirm(tr("Discard unsaved changes?"))) return;
        void action(async () => load(await api.revision(revision.warehouse_id, id)));
      }}>{revisions.map(r => <option key={r.id} value={r.id}>{tr(r.state)} {r.id.slice(0, 6)} · v{r.version}</option>)}</select>}
      {readOnly && <span className="wt-badge">{tr("Read-only")}</span>}
      <span className="wt-grow" />
      <span role="status">{dirty ? tr("Unsaved changes") : revision ? tr("Saved") : ''}</span>
      <button title={tr("Undo")} aria-label={tr("Undo")} disabled={busy || readOnly || !history?.past.length} onClick={() => setHistory(h => !h?.past.length ? h : ({ past: h.past.slice(0, -1), present: h.past[h.past.length-1], future: [h.present, ...h.future] }))}><Undo2 size={18} /></button>
      <button title={tr("Redo")} aria-label={tr("Redo")} disabled={busy || readOnly || !history?.future.length} onClick={() => setHistory(h => !h?.future.length ? h : ({ past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }))}><Redo2 size={18} /></button>
      <button title={tr("Save draft")} aria-label={tr("Save draft")} disabled={busy || readOnly || !dirty} onClick={() => void action(async () => {
        if (!revision || !layout) return;
        const next = await api.save(revision, layout); setRevision(next);
        setRevisions(await api.revisions(next.warehouse_id));
      })}><Save size={18} /></button>
      <button title={tr("Create alternative draft")} aria-label={tr("Create alternative draft")} disabled={busy || dirty || !revision} onClick={() => void action(async () => {
        if (!revision) return;
        const alternative = await api.fork(revision); setRevisions(await api.revisions(alternative.warehouse_id)); load(alternative);
      })}><Copy size={18} /></button>
      <button title={tr("Check saved layout")} aria-label={tr("Check saved layout")} disabled={busy || dirty || !revision} onClick={() => void action(async () => {
        if (revision) setValidation(await api.validate(revision));
      })}><ClipboardCheck size={18} /></button>
      <button title={tr("Publish this draft")} aria-label={tr("Publish this draft")} disabled={busy || dirty || !revision || readOnly} onClick={() => {
        if (!revision || !window.confirm(tr("Publish this draft? Published versions are read-only."))) return;
        void action(async () => {
          try {
            const published = await api.publish(revision);
            setRevisions(await api.revisions(published.warehouse_id)); load(published);
          } catch (err) {
            if (err instanceof WorkspaceError && err.issues.length) { setValidation({ version: revision.version, valid: false, issues: err.issues }); return; }
            throw err;
          }
        });
      }}><Send size={18} /></button>
      <button title={tr("Export layout JSON")} aria-label={tr("Export layout JSON")} disabled={!layout} onClick={exportLayout}><Download size={18} /></button>
      <button title={tr("Open the published layout in the live demo simulation")} aria-label={tr("Open published layout in demo")}
        disabled={busy || revision?.state !== 'published'}
        onClick={() => void action(async () => {
          setLayout(revision!.document);
          location.href = "/";
        })}><Play size={18} /></button>
    </div>
    {validation && !dirty && validation.version === revision?.version && <section className="wt-validation" aria-label={tr("Layout validation")}>
      <h2>{validation.issues.length === 0 ? tr("All layout checks passed")
        : tr("{0} errors, {1} warnings", validation.issues.filter(i => i.severity !== 'warning').length, validation.issues.filter(i => i.severity === 'warning').length)}</h2>
      {validation.issues.length > 0 && <IssueList issues={validation.issues} describe={issueOwner} />}
    </section>}
    {createOpen && <div className="wt-modal" role="dialog" aria-modal="true" aria-label={tr("New warehouse")}><form onSubmit={e => { e.preventDefault();
      if (dirty && !window.confirm(tr("Discard unsaved changes?"))) return;
      void action(async () => {
        const created = await api.createEmpty(name ?? tr("New warehouse"), dimensions.width, dimensions.depth, dimensions.height);
        setWarehouses(await api.warehouses()); setRevisions(await api.revisions(created.warehouse_id)); load(created); setCreateOpen(false);
      });
    }}><h2>{tr("New warehouse")}</h2><label>{tr("Name")}<input value={name ?? tr("New warehouse")} onChange={e => setName(e.target.value)} required maxLength={160} /></label>
      {(['width','depth','height'] as const).map(key => <label key={key}>{tr("{0} (m)", tr(key))}<input type="number" min="1" max="1000" step="0.1" value={dimensions[key]} onChange={e => setDimensions(d => ({ ...d, [key]: e.target.valueAsNumber }))} required /></label>)}
      <div className="wt-actions"><button type="button" disabled={busy} onClick={() => setCreateOpen(false)}>{tr("Cancel")}</button><button disabled={busy}>{tr("Create warehouse")}</button></div>
    </form></div>}
    {dialog === 'container' && <ContainerManager templates={templates} usedIds={usedContainerIds} error={libraryError} onSave={saveTemplate} onDelete={deleteTemplate}
      onClose={() => { setDialog(null); setLibraryError(''); }} />}
    {dialog === 'rack' && layout && <RackDialog layout={layout} floor={floor} templates={templates} onClose={() => setDialog(null)}
      onCreate={groups => { edit(d => { d.rack_groups = [...(d.rack_groups ?? []), ...groups]; }); setSel({ kind: 'rack', id: groups[0].id }); setDialog(null); }} />}
    {dialog === 'ground' && layout && <GroundDialog floor={floor} templates={templates} onClose={() => setDialog(null)}
      onCreate={batch => { edit(d => { d.ground_batches = [...(d.ground_batches ?? []), batch]; }); setSel({ kind: 'ground', id: batch.id }); setDialog(null); }} />}
    {dialog === 'equipment' && layout && catalogList.length > 0 && <EquipmentDialog layout={layout} floor={floor} catalog={catalogList} onClose={() => setDialog(null)}
      onCreate={item => { edit(d => { d.equipment = [...(d.equipment ?? []), item]; }); setSel({ kind: 'equipment', id: item.id }); setDialog(null); }} />}
    {!layout ? <div className="wt-empty"><h2>{tr("Your warehouses")}</h2><button onClick={() => setCreateOpen(true)}><Plus size={18} /> {tr("New warehouse")}</button>
      <p className="wt-note">{tr("Container templates can be managed before opening a warehouse.")}</p>
      <button onClick={() => setDialog('container')}><Container size={18} /> {tr("Container templates")}</button></div> : <div className="wt-editor">
      <aside className="wt-properties"><h2>{tr("Building")}</h2>
        {(['width','depth','height'] as const).map(key => <label key={key}>{tr("{0} (m)", tr(key))}<input type="number" min="1" max="1000" step="0.1" disabled={busy || readOnly} value={layout.size[key]} onChange={e => {
          const value = e.target.valueAsNumber; if (!Number.isFinite(value) || value <= 0 || value > 1000) return;
          edit(d => { d.size[key] = value; d.grid.cols = Math.ceil(d.size.width / d.grid.cell_size); d.grid.rows = Math.ceil(d.size.depth / d.grid.cell_size); });
        }} /></label>)}
        <label>{tr("Floor")}<select value={floor} onChange={e => { setFloor(Number(e.target.value)); setSel(null); }}>{layout.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>{tr("Snap (m)")}<select value={snap} onChange={e => setSnap(Number(e.target.value))}><option value={0.1}>0.1</option><option value={0.5}>0.5</option><option value={1}>1</option></select></label>
        <h2>{tr("Facilities")}</h2>
        <div className="wt-add-grid">
          <button disabled={!!reasons[0]} title={reasons[0] ? tr(reasons[0]) : tr("Add container")} onClick={() => setDialog('container')}><Container size={16} /> {tr("Add container")}</button>
          <button disabled={!!reasons[1]} title={reasons[1] ? tr(reasons[1]) : tr("Add rack")} onClick={() => setDialog('rack')}><LayoutGrid size={16} /> {tr("Add rack")}</button>
          <button disabled={!!reasons[2]} title={reasons[2] ? tr(reasons[2]) : tr("Add location")} onClick={() => setDialog('ground')}><Package size={16} /> {tr("Add location")}</button>
          <button disabled={!!reasons[3]} title={reasons[3] ? tr(reasons[3]) : tr("Add equipment")} onClick={() => setDialog('equipment')}><Forklift size={16} /> {tr("Add equipment")}</button>
        </div>
        {firstReason && <p className="wt-note" role="note">{tr(firstReason)}</p>}
        <div className="wt-object-list">
          {rows.map(r => <button key={r.key} aria-pressed={sel?.kind === 'rack' && r.groups.includes(sel.id)} onClick={() => setSel({ kind: 'rack', id: r.groups[0] })}>
            {tr("Rack row {0}", `${r.prefix}-${String(r.row).padStart(2, '0')}`)} <small>{tr("{0} groups", r.groups.length)}</small></button>)}
          {onFloor(layout.ground_batches).map(b => <button key={b.id} aria-pressed={sel?.kind === 'ground' && sel.id === b.id} onClick={() => setSel({ kind: 'ground', id: b.id })}>
            {tr("Ground locations")} {b.prefix} <small>{b.rows}×{b.cols}</small></button>)}
          {onFloor(layout.equipment).map(e => <button key={e.id} aria-pressed={sel?.kind === 'equipment' && sel.id === e.id} onClick={() => setSel({ kind: 'equipment', id: e.id })}>
            {equipmentLabel(e)} <small>{catalog[e.category] ? tr(kindLabel(catalog[e.category].kind)) : ''}</small></button>)}
        </div>
        <h2>{tr("Legacy racks")}</h2><button disabled={busy || readOnly} onClick={() => { const id = crypto.randomUUID(); edit(d => d.racks.push({ id, zone: '', floor, position: [2,d.floors.find(f => f.id === floor)?.elevation ?? 0,2], size: [4,3,1.2], rotation: 0, levels: 3, model: 'standard', blocks_grid: true })); setSel({ kind: 'legacy', id }); }}><Plus size={18} /> {tr("Add legacy rack")}</button>
        <div className="wt-object-list">{layout.racks.filter(r => (r.floor ?? 1) === floor).map((r, index) => <button key={r.id} aria-pressed={sel?.kind === 'legacy' && r.id === sel.id} onClick={() => setSel({ kind: 'legacy', id: r.id })}>{tr("Rack {0}", index + 1)} <small>{r.id.slice(0,6)}</small></button>)}</div>
      </aside>
      <section className="wt-plan-area" aria-label={tr("Floor plan")}><div className="wt-plan-tools"><span>{layout.size.width} × {layout.size.depth} m</span>
        <button aria-pressed={view === '2d'} title={tr("Plan view")} onClick={() => setView('2d')}><MapIcon size={18} /> {tr("Plan")}</button>
        <button aria-pressed={view === '3d'} title={tr("3D preview")} onClick={() => setView('3d')}><Box size={18} /> 3D</button>
        {view === '2d' && <><button title={tr("Zoom out")} aria-label={tr("Zoom out")} onClick={() => setZoom(z => Math.max(0.5,z/1.25))}><ZoomOut size={18} /></button><button title={tr("Zoom in")} aria-label={tr("Zoom in")} onClick={() => setZoom(z => Math.min(8,z*1.25))}><ZoomIn size={18} /></button></>}</div>
        {view === '3d' ? <div className="wt-3d"><Preview3D layout={layout} facilities={facilities} floor={floor} catalog={catalog}
          highlight={sel && sel.kind !== 'legacy' && sel.kind !== 'equipment' ? sel.id : null} ghosts={ghosts} focus={focus} /></div> :
        <div className="wt-plan-scroll"><svg ref={svg} role="img" aria-label={tr("{0} floor plan", layout.name)} viewBox={`-2 -2 ${layout.size.width+4} ${layout.size.depth+4}`} style={{ width: `${zoom*100}%`, minWidth: 300 }} onPointerMove={e => {
          const active = drag.current; const point = pointer(e); if (!active || !point) return;
          const p: P2 = [Math.round((point.x - active.x) / snap) * snap, Math.round((point.y - active.z) / snap) * snap];
          setHistory(h => { if (!h) return h; const next = clone(h.present); moveTo(next, active.kind, active.id, p); return { ...h, present: next }; });
        }} onPointerUp={() => endDrag()} onPointerCancel={() => endDrag(true)}>
          <defs><pattern id="wt-grid" width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#dbe3e9" strokeWidth={0.025} /></pattern></defs>
          <rect width={layout.size.width} height={layout.size.depth} fill="url(#wt-grid)" stroke="#677e89" strokeWidth={0.15} />
          {layout.floors.find(f => f.id === floor)?.footprint && <polygon points={layout.floors.find(f => f.id === floor)!.footprint!.map(p => p.join(',')).join(' ')} fill="#edf4f680" stroke="#456775" strokeWidth={0.15} />}
          {layout.racks.filter(r => (r.floor ?? 1) === floor).map(r => <rect key={r.id} x={r.position[0]} y={r.position[2]} width={r.size[0]} height={r.size[2]} transform={`rotate(${r.rotation} ${r.position[0]} ${r.position[2]})`} fill={sel?.kind === 'legacy' && sel.id === r.id ? '#19a18c' : '#78a3b2'} stroke={sel?.kind === 'legacy' && sel.id === r.id ? '#00634f' : '#365c6b'} strokeWidth={0.12} onPointerDown={e => startDrag(e, 'legacy', r.id)}><title>{r.id}</title></rect>)}
          {planShapes.map(({ f, outline, cells, tops, color }) => {
            const selected = sel && sel.kind !== 'legacy' && sel.id === f.id;
            return <g key={f.id} className="wt-facility" onPointerDown={e => startDrag(e, f.kind, f.id)}
              onDoubleClick={e => { const p = pointer(e); if (!p || f.error) return; const column = columnAt(f, [p.x, p.y]); if (column >= 0) setSel({ kind: 'slot', id: f.id, column, level: 1 }); }}>
              {f.kind === 'rack' && <path d={outline} fill={selected ? '#d7efe8' : '#e3eaee'} stroke={f.error ? '#c2410c' : selected ? '#00634f' : '#5d7480'} strokeWidth={selected ? 0.12 : 0.06} />}
              {f.kind === 'ground' && <path d={cells} fill={selected ? '#e6f4ef' : '#f2f5f6'} stroke={f.error ? '#c2410c' : selected ? '#00634f' : '#8aa0aa'} strokeWidth={0.04} strokeDasharray="0.2 0.12" />}
              {tops && <path d={tops} fill={color} fillOpacity={0.85} stroke="#24343c" strokeWidth={0.02} />}
              <title>{f.slots[0]?.name ?? f.id}{f.error ? ` — ${f.error}` : ''}</title>
            </g>;
          })}
          {onFloor(layout.equipment).map(e => {
            const cat = catalog[e.category]; const s = equipmentSize(e, cat);
            const q = footprint(e.position[0], e.position[1], e.rotation, s.width, s.depth); const selected = sel?.kind === 'equipment' && sel.id === e.id;
            return <g key={e.id} onPointerDown={ev => startDrag(ev, 'equipment', e.id)}>
              <path d={quadPath(q)} fill={KIND_FILL[cat?.kind ?? 'station']} stroke={selected ? '#00634f' : '#41545e'} strokeWidth={selected ? 0.12 : 0.05} />
              <text x={e.position[0]} y={e.position[1]} fontSize={0.32} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{equipmentLabel(e)}</text>
            </g>;
          })}
          {slotInfo && vehicle && <g pointerEvents="none">
            {slotInfo.slot && slotInfo.f.container && <path d={quadPath(footprint(slotInfo.slot.center[0], slotInfo.slot.center[2], slotInfo.f.rotation, slotInfo.f.container.width, slotInfo.f.container.depth))} fill="#f59e0b" stroke="#b45309" strokeWidth={0.06} />}
            {(['above', 'below'] as const).map(side => <g key={side}>
              <path d={quadPath(slotInfo.col.footprints[side])} fill="none" stroke={slotInfo.sides[side] ? '#16a34a' : '#dc2626'} strokeWidth={0.05} strokeDasharray="0.25 0.15" />
              <path d={quadPath(footprint(slotInfo.col.stops[side].position[0], slotInfo.col.stops[side].position[1], slotInfo.col.stops[side].heading, vehicle.width, vehicle.depth))}
                fill={slotInfo.sides[side] ? '#22c55e' : '#ef4444'} fillOpacity={0.35} />
            </g>)}
          </g>}
        </svg></div>}
        <p className="wt-hint">{tr("Click to select and drag; double-click a container to inspect its storage position and stop points.")}</p>
      </section>
      <aside className="wt-properties"><h2>{tr("Selection")}</h2>{rack ? <>
        <small>{rack.id}</small>
        {([['x',rack.position[0]],['z',rack.position[2]],['width',rack.size[0]],['depth',rack.size[2]],['height',rack.size[1]],['rotation',rack.rotation]] as [Parameters<typeof changeRack>[0],number][]).map(([key,value]) => <label key={key}>{tr(key === 'rotation' ? "{0} (°)" : "{0} (m)", tr(key))}<input type="number" step={key === 'rotation' ? 15 : 0.1} value={value} disabled={busy || readOnly} onChange={e => changeRack(key,e.target.valueAsNumber)} /></label>)}
        <div className="wt-actions"><button title={tr("Duplicate rack")} aria-label={tr("Duplicate rack")} disabled={busy || readOnly} onClick={() => { const copy: LayoutRack = clone(rack); copy.id = crypto.randomUUID(); copy.position[0] += snap; copy.position[2] += snap; edit(d => d.racks.push(copy)); setSel({ kind: 'legacy', id: copy.id }); }}><Copy size={18} /></button>
          <button title={tr("Delete rack")} aria-label={tr("Delete rack")} disabled={busy || readOnly} onClick={() => { edit(d => { d.racks = d.racks.filter(r => r.id !== rack.id); }); setSel(null); }}><Trash2 size={18} /></button></div>
      </> : sel ? <FacilityInspector layout={layout} sel={sel} setSel={setSel} facilities={facilities} containers={containers} templates={templates}
          catalog={catalog} vehicle={vehicle!} readOnly={readOnly || busy} edit={edit} /> : <p>{tr("No selection")}</p>}</aside>
    </div>}
  </main>;
}
