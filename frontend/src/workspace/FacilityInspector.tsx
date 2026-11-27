import { Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import type { ContainerTemplate, EquipmentCategory, LayoutGroundBatch, LayoutRackGroup, WarehouseLayout } from '../layout/types';
import { Check, Num, TimingEditor, VehicleEditor } from './fields';
import { issueText } from './IssueList';
import { kindLabel } from './FacilityDialogs';
import {
  columnAvailability, containerTypeLabel, equipmentLabel, groundPreview, handlingFor, rackPreview, rotateRow,
  type ExpandedFacility, type ReferenceVehicle,
} from './facilities';

export type Selection =
  | { kind: 'legacy' | 'rack' | 'ground' | 'equipment'; id: string }
  | { kind: 'slot'; id: string; column: number; level: number }
  | null;

const fmt = (v: number | null | undefined, digits = 3) => typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '—';
const fin = (v: number) => Number.isFinite(v);

interface Props {
  layout: WarehouseLayout; sel: Selection; setSel: (s: Selection) => void; facilities: ExpandedFacility[];
  containers: Record<string, ContainerTemplate>; templates: ContainerTemplate[]; catalog: Record<string, EquipmentCategory>;
  vehicle: ReferenceVehicle; readOnly: boolean; edit: (fn: (d: WarehouseLayout) => void) => void;
}

function ContainerField({ value, templates, containers, disabled, onChange }: { value: string; templates: ContainerTemplate[]; containers: Record<string, ContainerTemplate>; disabled: boolean; onChange: (id: string) => void }) {
  const { tr } = useI18n();
  const known = templates.some(t => t.id === value);
  return <label>{tr("Container")}<select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    {!known && <option value={value}>{containers[value]?.name ?? tr("Missing template")}</option>}
    {templates.map(t => <option key={t.id} value={t.id}>{t.name} · {tr(containerTypeLabel(t.type))}</option>)}
  </select></label>;
}

export function FacilityInspector({ layout, sel, setSel, facilities, containers, templates, catalog, vehicle, readOnly, edit }: Props) {
  const { tr, label } = useI18n();
  if (!sel || sel.kind === 'legacy') return null;

  if (sel.kind === 'rack') {
    const g = layout.rack_groups?.find(x => x.id === sel.id); if (!g) return <p>{tr("No selection")}</p>;
    const row = (layout.rack_groups ?? []).filter(x => x.row_key === g.row_key);
    const patch = (p: Partial<LayoutRackGroup>) => edit(d => { const t = d.rack_groups?.find(x => x.id === g.id); if (t) Object.assign(t, p); });
    const num = (key: keyof LayoutRackGroup, positive = true, integer = false) => (v: number) => {
      if (!fin(v) || (positive && v <= 0) || (integer && !Number.isInteger(v))) return; patch({ [key]: v } as Partial<LayoutRackGroup>);
    };
    const p = rackPreview({ ...g, groups: 1 }, containers[g.container_id]);
    return <>
      <h3>{tr("Rack group")} {g.prefix}-{String(g.row).padStart(2, '0')} · {tr("group {0} of {1}", row.indexOf(g) + 1, row.length)}</h3>
      <small>{g.id}</small>
      <div className="wt-inline">
        <label>{tr("Name prefix")}<input value={g.prefix} disabled={readOnly} onChange={e => e.target.value.trim() && patch({ prefix: e.target.value.trim() })} /></label>
        <Num label={tr("Row number")} value={g.row} step={1} min={1} disabled={readOnly} onChange={num('row', true, true)} />
        <Num label={tr("First column")} value={g.column_start} step={1} min={1} disabled={readOnly} onChange={num('column_start', true, true)} />
      </div>
      <div className="wt-inline">
        <Num label={tr("X (m)")} value={g.origin[0]} disabled={readOnly} onChange={v => fin(v) && patch({ origin: [v, g.origin[1]] })} />
        <Num label={tr("Z (m)")} value={g.origin[1]} disabled={readOnly} onChange={v => fin(v) && patch({ origin: [g.origin[0], v] })} />
        <Num label={tr("Rotation of whole row (°)")} value={g.rotation} step={15} disabled={readOnly}
          onChange={v => fin(v) && edit(d => { if (d.rack_groups) rotateRow(d.rack_groups, g.row_key, v); })} />
      </div>
      <div className="wt-inline">
        <Num label={tr("Width (post centre spacing, m)")} value={g.center_spacing} disabled={readOnly} onChange={num('center_spacing')} />
        <Num label={tr("Depth (m)")} value={g.depth} disabled={readOnly} onChange={num('depth')} />
        <Num label={tr("Height (m)")} value={g.height} disabled={readOnly} onChange={num('height')} />
      </div>
      <div className="wt-inline">
        <Num label={tr("Storage levels")} value={g.levels} step={1} min={1} disabled={readOnly} onChange={num('levels', true, true)} />
        <Num label={tr("Cargo stack height (m)")} value={g.cargo_height ?? 0} min={0} disabled={readOnly} onChange={v => fin(v) && v >= 0 && patch({ cargo_height: v })} />
      </div>
      <Check label={tr("Shelf boards")} checked={g.has_boards} disabled={readOnly} onChange={v => patch({ has_boards: v })} />
      <Check label={tr("Bottom beam level")} checked={g.has_bottom} disabled={readOnly} onChange={v => patch({ has_bottom: v })} />
      <ContainerField value={g.container_id} templates={templates} containers={containers} disabled={readOnly} onChange={id => patch({ container_id: id })} />
      <dl className="wt-computed">
        <dt>{tr("Clear width")}</dt><dd>{fmt(p.widths?.clear)} m</dd>
        <dt>{tr("Group outer width")}</dt><dd>{fmt(p.widths?.group_outer)} m</dd>
        <dt>{tr("Containers per level")}</dt><dd>{p.per ?? '—'}</dd>
      </dl>
      {p.issues.length > 0 && <ul className="wt-issues">{p.issues.map((i, k) => <li key={k} className="error">{issueText(tr, label, { code: i.code, message: i.code, level: 'level' in i ? i.level : undefined })}</li>)}</ul>}
      <div className="wt-actions">
        <button title={tr("Delete this group")} disabled={readOnly} onClick={() => { edit(d => { d.rack_groups = d.rack_groups?.filter(x => x.id !== g.id); }); setSel(null); }}><Trash2 size={16} /> {tr("Delete group")}</button>
        {row.length > 1 && <button title={tr("Delete the whole row")} disabled={readOnly} onClick={() => { edit(d => { d.rack_groups = d.rack_groups?.filter(x => x.row_key !== g.row_key); }); setSel(null); }}><Trash2 size={16} /> {tr("Delete row")}</button>}
      </div>
      <p className="wt-note">{tr("Double-click a container in the plan to inspect a storage position.")}</p>
    </>;
  }

  if (sel.kind === 'ground') {
    const b = layout.ground_batches?.find(x => x.id === sel.id); if (!b) return <p>{tr("No selection")}</p>;
    const patch = (p: Partial<LayoutGroundBatch>) => edit(d => { const t = d.ground_batches?.find(x => x.id === b.id); if (t) Object.assign(t, p); });
    const pos = (key: 'width' | 'depth') => (v: number) => fin(v) && v > 0 && patch({ [key]: v });
    const int = (key: 'rows' | 'cols') => (v: number) => Number.isInteger(v) && v > 0 && v <= 1000 && patch({ [key]: v });
    const p = groundPreview(b, containers[b.container_id]);
    return <>
      <h3>{tr("Ground locations")} {b.prefix} · {p.total}</h3><small>{b.id}</small>
      <div className="wt-inline">
        <label>{tr("Name prefix")}<input value={b.prefix} disabled={readOnly} onChange={e => e.target.value.trim() && patch({ prefix: e.target.value.trim() })} /></label>
        <Num label={tr("Rows")} value={b.rows} step={1} disabled={readOnly} onChange={int('rows')} />
        <Num label={tr("Columns")} value={b.cols} step={1} disabled={readOnly} onChange={int('cols')} />
      </div>
      <div className="wt-inline">
        <Num label={tr("X (m)")} value={b.origin[0]} disabled={readOnly} onChange={v => fin(v) && patch({ origin: [v, b.origin[1]] })} />
        <Num label={tr("Z (m)")} value={b.origin[1]} disabled={readOnly} onChange={v => fin(v) && patch({ origin: [b.origin[0], v] })} />
        <Num label={tr("Rotation (°)")} value={b.rotation} step={15} disabled={readOnly} onChange={v => fin(v) && patch({ rotation: v })} />
      </div>
      <div className="wt-inline">
        <Num label={tr("Location width (m)")} value={b.width} disabled={readOnly} onChange={pos('width')} />
        <Num label={tr("Location depth (m)")} value={b.depth} disabled={readOnly} onChange={pos('depth')} />
        <Num label={tr("Aisle between rows (m)")} value={b.aisle} min={0} disabled={readOnly} onChange={v => fin(v) && v >= 0 && patch({ aisle: v })} />
      </div>
      <Num label={tr("Cargo stack height (m)")} value={b.cargo_height ?? 0} min={0} disabled={readOnly} onChange={v => fin(v) && v >= 0 && patch({ cargo_height: v })} />
      <ContainerField value={b.container_id} templates={templates} containers={containers} disabled={readOnly} onChange={id => patch({ container_id: id })} />
      {p.issues.length > 0 && <ul className="wt-issues">{p.issues.map((i, k) => <li key={k} className="error">{issueText(tr, label, { code: i.code, message: i.code })}</li>)}</ul>}
      <div className="wt-actions"><button disabled={readOnly} onClick={() => { edit(d => { d.ground_batches = d.ground_batches?.filter(x => x.id !== b.id); }); setSel(null); }}><Trash2 size={16} /> {tr("Delete batch")}</button></div>
      <p className="wt-note">{tr("Double-click a container in the plan to inspect a storage position.")}</p>
    </>;
  }

  if (sel.kind === 'equipment') {
    const e = layout.equipment?.find(x => x.id === sel.id); if (!e) return <p>{tr("No selection")}</p>;
    const cat = catalog[e.category];
    const patch = (fn: (t: NonNullable<WarehouseLayout['equipment']>[number]) => void) => edit(d => { const t = d.equipment?.find(x => x.id === e.id); if (t) fn(t); });
    const dup = (layout.equipment ?? []).some(x => x.id !== e.id && x.category === e.category && x.number === e.number);
    return <>
      <h3>{equipmentLabel(e)}</h3><small>{cat ? `${cat.name} · ${tr(kindLabel(cat.kind))}` : e.category}</small>
      <div className="wt-inline">
        <label>{tr("Equipment number")}<input value={e.number} disabled={readOnly} onChange={ev => patch(t => { t.number = ev.target.value; })} />
          {dup && <small className="wt-inline-error">{tr("{0} is already used", `${e.category}-${e.number}`)}</small>}</label>
        <label>{tr("Display name")}<input value={e.name ?? ''} disabled={readOnly} placeholder={`${e.category}-${e.number}`} onChange={ev => patch(t => { t.name = ev.target.value || undefined; })} /></label>
      </div>
      <div className="wt-inline">
        <Num label={cat?.kind === 'vehicle' ? tr("Idle parking X (m)") : tr("Installation X (m)")} value={e.position[0]} disabled={readOnly} onChange={v => fin(v) && patch(t => { t.position = [v, t.position[1]]; })} />
        <Num label={cat?.kind === 'vehicle' ? tr("Idle parking Z (m)") : tr("Installation Z (m)")} value={e.position[1]} disabled={readOnly} onChange={v => fin(v) && patch(t => { t.position = [t.position[0], v]; })} />
        <Num label={tr("Rotation (°)")} value={e.rotation} step={15} disabled={readOnly} onChange={v => fin(v) && patch(t => { t.rotation = v; })} />
      </div>
      <TimingEditor timing={e.timing} disabled={readOnly} onChange={timing => patch(t => { t.timing = timing; })} />
      {e.vehicle && <VehicleEditor vehicle={e.vehicle} disabled={readOnly} onChange={v => fin(v.width) && v.width > 0 && fin(v.depth) && v.depth > 0 && patch(t => { t.vehicle = v; })} />}
      <div className="wt-actions"><button disabled={readOnly} onClick={() => { edit(d => { d.equipment = d.equipment?.filter(x => x.id !== e.id); }); setSel(null); }}><Trash2 size={16} /> {tr("Delete equipment")}</button></div>
    </>;
  }

  // 存放位置
  if (sel.kind !== 'slot') return null;
  const f = facilities.find(x => x.id === sel.id);
  if (!f || f.error) return <p>{tr("No selection")}</p>;
  const levels = f.levels;
  const slot = f.slots[sel.column * levels + (sel.level - 1)];
  if (!slot) return <p>{tr("No selection")}</p>;
  const sides = columnAvailability(layout, facilities, f, sel.column, catalog);
  const times = handlingFor(vehicle.vehicle, slot.support_height);
  const side = (ok: boolean) => ok ? tr("available") : tr("blocked");
  return <>
    <h3>{tr("Storage position")} {slot.name}</h3>
    <button className="wt-link" onClick={() => setSel({ kind: f.kind, id: f.id })}>{f.kind === 'rack' ? tr("Edit rack group") : tr("Edit ground location batch")}</button>
    {f.kind === 'rack' && <label>{tr("Level")}<select value={sel.level} onChange={e => setSel({ ...sel, level: Number(e.target.value) })}>
      {Array.from({ length: levels }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>}
    <dl className="wt-computed">
      <dt>{tr("Container centre")}</dt><dd>{fmt(slot.center[0], 2)}, {fmt(slot.center[1], 2)}, {fmt(slot.center[2], 2)} m</dd>
      <dt>{tr("Support height")}</dt><dd>{fmt(slot.support_height)} m</dd>
      <dt>{tr("Container")}</dt><dd>{f.container?.name ?? '—'}</dd>
      <dt>{tr("Stop above")}</dt><dd className={sides.above ? 'ok' : 'bad'}>{side(sides.above)}</dd>
      <dt>{tr("Stop below")}</dt><dd className={sides.below ? 'ok' : 'bad'}>{side(sides.below)}</dd>
      <dt>{tr("Reference vehicle")}</dt><dd>{vehicle.vehicle ? equipmentLabel(vehicle.vehicle) : tr("default")} · {fmt(vehicle.width, 2)} × {fmt(vehicle.depth, 2)} m</dd>
      <dt>{tr("Pick time")}</dt><dd>{times ? `${fmt(times.pick, 1)} s` : '—'}</dd>
      <dt>{tr("Drop time")}</dt><dd>{times ? `${fmt(times.drop, 1)} s` : '—'}</dd>
    </dl>
    {!sides.above && !sides.below && <p className="wt-inline-error">{tr("This storage position is unreachable: both stop points are blocked.")}</p>}
    {vehicle.missing && <p className="wt-note">{tr("No vehicle added yet; stop points use the default 2.0 × 1.0 m body")}</p>}
  </>;
}
