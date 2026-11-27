import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n, type Message } from '../i18n';
import type { ContainerTemplate, ContainerType, EquipmentCategory, LayoutEquipment, LayoutGroundBatch, LayoutRackGroup, P2, WarehouseLayout } from '../layout/types';
import type { ContainerInput } from '../services/workspace';
import { Check, Num, TimingEditor, VehicleEditor, timingValid, vehicleValid } from './fields';
import { issueText } from './IssueList';
import {
  containerTypeLabel, createEquipment, createGroundBatch, createRackRow, groundPreview, nextEquipmentNumber, nextRowNumber, rackPreview,
  type RackRowInput,
} from './facilities';

const fmt = (v: number | null | undefined, digits = 3) => typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '—';
const TYPES: ContainerType[] = ['plastic_pallet', 'wood_pallet', 'plastic_box'];
const WOOD = '#b07a48';

function Dialog({ title, children, onSubmit, onClose, submitLabel, canSubmit = true, wide = false }: {
  title: string; children: React.ReactNode; onSubmit?: () => void; onClose: () => void; submitLabel?: string; canSubmit?: boolean; wide?: boolean;
}) {
  const { tr } = useI18n();
  return <div className="wt-modal" role="dialog" aria-modal="true" aria-label={title}>
    <form className={wide ? 'wt-wide' : undefined} onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit?.(); }}>
      <h2>{title}</h2>{children}
      <div className="wt-actions"><button type="button" onClick={onClose}>{onSubmit ? tr("Cancel") : tr("Close")}</button>
        {onSubmit && <button type="submit" disabled={!canSubmit}>{submitLabel}</button>}</div>
    </form>
  </div>;
}

function ContainerSelect({ templates, value, onChange }: { templates: ContainerTemplate[]; value: string; onChange: (id: string) => void }) {
  const { tr } = useI18n();
  return <label>{tr("Container")}<select value={value} onChange={e => onChange(e.target.value)} required>
    <option value="" disabled>{tr("Select container template")}</option>
    {templates.map(t => <option key={t.id} value={t.id}>{t.name} · {tr(containerTypeLabel(t.type))} · {fmt(t.width)}×{fmt(t.depth)}×{fmt(t.height)} m</option>)}
  </select></label>;
}

// ── 容器模板 ───────────────────────────────────────────────
export function ContainerManager({ templates, usedIds, onSave, onDelete, onClose, error }: {
  templates: ContainerTemplate[]; usedIds: Set<string>; error: string;
  onSave: (input: ContainerInput, id?: string) => Promise<boolean>; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const { tr, label } = useI18n();
  const blank: ContainerInput = { name: '', type: 'plastic_pallet', color: '#2f6fb3', width: 1.2, depth: 1.0, height: 0.15 };
  const [form, setForm] = useState<ContainerInput & { id?: string }>(blank);
  const valid = form.name.trim() && [form.width, form.depth, form.height].every(v => v > 0 && v <= 10);
  return <Dialog title={tr("Container templates")} onClose={onClose} wide>
    <p className="wt-note">{tr("Templates are shared by all warehouses of your organization. Containers have no position; racks and ground locations bind them.")}</p>
    <table className="wt-table"><thead><tr><th>{tr("Name")}</th><th>{tr("Type")}</th><th>{tr("Size (m)")}</th><th /></tr></thead><tbody>
      {templates.length === 0 && <tr><td colSpan={4}>{tr("No container templates yet")}</td></tr>}
      {templates.map(t => <tr key={t.id}><td><span className="wt-swatch" style={{ background: t.color }} />{t.name}</td><td>{tr(containerTypeLabel(t.type))}</td>
        <td>{fmt(t.width)} × {fmt(t.depth)} × {fmt(t.height)}</td>
        <td className="wt-row-actions"><button type="button" title={tr("Edit")} aria-label={tr("Edit")} onClick={() => setForm({ ...t })}><Pencil size={16} /></button>
          <button type="button" title={usedIds.has(t.id) ? tr("Used by this layout") : tr("Delete")} aria-label={tr("Delete")} disabled={usedIds.has(t.id)}
            onClick={() => { if (window.confirm(tr("Delete container template {0}?", t.name))) void onDelete(t.id); }}><Trash2 size={16} /></button></td></tr>)}
    </tbody></table>
    <h3>{form.id ? tr("Edit container template") : tr("New container template")}</h3>
    <div className="wt-inline">
      <label>{tr("Name")}<input value={form.name} maxLength={80} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={tr("e.g. Plastic pallet 1100")} /></label>
      <label>{tr("Type")}<select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ContainerType }))}>
        {TYPES.map(t => <option key={t} value={t}>{tr(containerTypeLabel(t))}</option>)}</select></label>
      <label>{tr("Color")}{form.type === 'wood_pallet'
        ? <><input type="color" value={WOOD} disabled /><small>{tr("Wood pallets use a fixed wood color")}</small></>
        : <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />}</label>
    </div>
    <div className="wt-inline">
      <Num label={tr("Width (m)")} value={form.width} min={0} step={0.01} onChange={v => setForm(f => ({ ...f, width: v }))} />
      <Num label={tr("Depth (m)")} value={form.depth} min={0} step={0.01} onChange={v => setForm(f => ({ ...f, depth: v }))} />
      <Num label={tr("Height (m)")} value={form.height} min={0} step={0.01} onChange={v => setForm(f => ({ ...f, height: v }))}
        hint={tr("Container body only, not the cargo")} />
    </div>
    {error && <p role="alert" className="wt-inline-error">{label(error)}</p>}
    <div className="wt-actions">
      {form.id && <button type="button" onClick={() => setForm(blank)}>{tr("Cancel edit")}</button>}
      <button type="button" disabled={!valid} onClick={() => void onSave({ name: form.name.trim(), type: form.type, color: form.type === 'wood_pallet' ? WOOD : form.color,
        width: form.width, depth: form.depth, height: form.height }, form.id).then(ok => { if (ok) setForm(blank); })}>
        {form.id ? <><Pencil size={16} /> {tr("Save template")}</> : <><Plus size={16} /> {tr("Add template")}</>}</button>
    </div>
  </Dialog>;
}

// ── 货架 ──────────────────────────────────────────────────
export function RackDialog({ layout, floor, templates, onCreate, onClose }: {
  layout: WarehouseLayout; floor: number; templates: ContainerTemplate[]; onCreate: (groups: LayoutRackGroup[]) => void; onClose: () => void;
}) {
  const { tr, label } = useI18n();
  const [f, setF] = useState<RackRowInput>(() => ({ prefix: 'N', row: nextRowNumber(layout, 'N'), floor, origin: [2, 2] as P2, rotation: 0,
    center_spacing: 2.5, depth: 1.2, height: 3, levels: 3, has_bottom: false, has_boards: true, groups: 1, container_id: templates[0]?.id ?? '', cargo_height: 0 }));
  const set = (patch: Partial<RackRowInput>) => setF(v => ({ ...v, ...patch }));
  const container = templates.find(t => t.id === f.container_id);
  const p = useMemo(() => rackPreview(f, container), [f, container]);
  const intOk = Number.isInteger(f.levels) && f.levels > 0 && Number.isInteger(f.groups) && f.groups > 0 && Number.isInteger(f.row) && f.row > 0;
  const ok = !!container && !p.error && p.issues.length === 0 && intOk && f.prefix.trim() !== '' && Number.isFinite(f.origin[0]) && Number.isFinite(f.origin[1])
    && Number.isFinite(f.rotation) && f.depth > 0 && f.height > 0;
  return <Dialog title={tr("Add rack")} wide onClose={onClose} submitLabel={tr("Create {0} rack groups", Number.isInteger(f.groups) ? f.groups : '—')} canSubmit={ok}
    onSubmit={() => container && onCreate(createRackRow({ ...f, prefix: f.prefix.trim() }, container))}>
    <div className="wt-inline">
      <label>{tr("Name prefix")}<input value={f.prefix} maxLength={12} onChange={e => set({ prefix: e.target.value })} /></label>
      <Num label={tr("Row number")} value={f.row} min={1} step={1} onChange={v => set({ row: v })} />
      <Num label={tr("Groups in row")} value={f.groups} min={1} step={1} onChange={v => set({ groups: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("X (m)")} value={f.origin[0]} onChange={v => set({ origin: [v, f.origin[1]] })} hint={tr("Grid outer corner of the row")} />
      <Num label={tr("Z (m)")} value={f.origin[1]} onChange={v => set({ origin: [f.origin[0], v] })} />
      <Num label={tr("Rotation (°)")} value={f.rotation} step={15} onChange={v => set({ rotation: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("Width (post centre spacing, m)")} value={f.center_spacing} min={0} onChange={v => set({ center_spacing: v })} />
      <Num label={tr("Depth (m)")} value={f.depth} min={0} onChange={v => set({ depth: v })} />
      <Num label={tr("Height (m)")} value={f.height} min={0} onChange={v => set({ height: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("Storage levels")} value={f.levels} min={1} step={1} onChange={v => set({ levels: v })} />
      <Num label={tr("Cargo stack height (m)")} value={f.cargo_height} min={0} onChange={v => set({ cargo_height: v })} />
    </div>
    <div className="wt-inline">
      <Check label={tr("Shelf boards")} checked={f.has_boards} onChange={v => set({ has_boards: v })} />
      <Check label={tr("Bottom beam level")} checked={f.has_bottom} onChange={v => set({ has_bottom: v })} />
    </div>
    <ContainerSelect templates={templates} value={f.container_id} onChange={id => set({ container_id: id })} />
    <dl className="wt-computed">
      <dt>{tr("Clear width")}</dt><dd>{fmt(p.widths?.clear)} m</dd>
      <dt>{tr("Group outer width")}</dt><dd>{fmt(p.widths?.group_outer)} m</dd>
      <dt>{tr("Row outer width")}</dt><dd>{fmt(p.widths?.row_outer)} m</dd>
      <dt>{tr("Containers per level")}</dt><dd>{p.per ?? '—'}</dd>
      <dt>{tr("Storage positions")}</dt><dd>{p.total ?? '—'}</dd>
    </dl>
    {p.error && <p className="wt-inline-error">{label(p.error)}</p>}
    {p.issues.length > 0 && <ul className="wt-issues">{p.issues.map((i, k) => <li key={k} className="error">{issueText(tr, label, { code: i.code, message: i.code, level: 'level' in i ? i.level : undefined })}</li>)}</ul>}
  </Dialog>;
}

// ── 地面库位 ───────────────────────────────────────────────
export function GroundDialog({ floor, templates, onCreate, onClose }: {
  floor: number; templates: ContainerTemplate[]; onCreate: (batch: LayoutGroundBatch) => void; onClose: () => void;
}) {
  const { tr, label } = useI18n();
  const [f, setF] = useState<Omit<LayoutGroundBatch, 'id'>>(() => ({ prefix: 'F', floor, origin: [2, 2] as P2, rotation: 0, width: 1.3, depth: 1.3,
    rows: 10, cols: 10, aisle: 0, container_id: templates[0]?.id ?? '', cargo_height: 0 }));
  const set = (patch: Partial<typeof f>) => setF(v => ({ ...v, ...patch }));
  const container = templates.find(t => t.id === f.container_id);
  const p = useMemo(() => groundPreview(f, container), [f, container]);
  const ok = !!container && !p.error && p.issues.length === 0 && f.prefix.trim() !== '' && f.width > 0 && f.depth > 0
    && Number.isFinite(f.origin[0]) && Number.isFinite(f.origin[1]) && Number.isFinite(f.rotation);
  return <Dialog title={tr("Add ground locations")} wide onClose={onClose} submitLabel={tr("Create {0} locations", p.total || '—')} canSubmit={ok}
    onSubmit={() => onCreate(createGroundBatch({ ...f, prefix: f.prefix.trim() }))}>
    <p className="wt-note">{tr("Storage positions placed directly on the floor without racks.")}</p>
    <div className="wt-inline">
      <label>{tr("Name prefix")}<input value={f.prefix} maxLength={12} onChange={e => set({ prefix: e.target.value })} /></label>
      <Num label={tr("Rows")} value={f.rows} min={1} step={1} onChange={v => set({ rows: v })} />
      <Num label={tr("Columns")} value={f.cols} min={1} step={1} onChange={v => set({ cols: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("X (m)")} value={f.origin[0]} onChange={v => set({ origin: [v, f.origin[1]] })} hint={tr("Grid outer corner of the batch")} />
      <Num label={tr("Z (m)")} value={f.origin[1]} onChange={v => set({ origin: [f.origin[0], v] })} />
      <Num label={tr("Rotation (°)")} value={f.rotation} step={15} onChange={v => set({ rotation: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("Location width (m)")} value={f.width} min={0} onChange={v => set({ width: v })} />
      <Num label={tr("Location depth (m)")} value={f.depth} min={0} onChange={v => set({ depth: v })} />
      <Num label={tr("Aisle between rows (m)")} value={f.aisle} min={0} onChange={v => set({ aisle: v })} hint={tr("0 = rows packed tightly; inner rows become unreachable")} />
    </div>
    <div className="wt-inline">
      <Num label={tr("Cargo stack height (m)")} value={f.cargo_height} min={0} onChange={v => set({ cargo_height: v })} />
    </div>
    <ContainerSelect templates={templates} value={f.container_id} onChange={id => set({ container_id: id })} />
    <dl className="wt-computed">
      <dt>{tr("Storage positions")}</dt><dd>{p.total || '—'}</dd>
      <dt>{tr("Batch outer size")}</dt><dd>{fmt(p.outerWidth)} × {fmt(p.outerDepth)} m</dd>
    </dl>
    {p.error && <p className="wt-inline-error">{label(p.error)}</p>}
    {p.issues.length > 0 && <ul className="wt-issues">{p.issues.map((i, k) => <li key={k} className="error">{issueText(tr, label, { code: i.code, message: i.code })}</li>)}</ul>}
  </Dialog>;
}

// ── 设备 ──────────────────────────────────────────────────
const KIND: Record<EquipmentCategory['kind'], Message> = { vehicle: 'Vehicle', lift: 'Lift', conveyor: 'Conveyor', station: 'Work station' };
export const kindLabel = (k: EquipmentCategory['kind']) => KIND[k];

export function EquipmentDialog({ layout, floor, catalog, onCreate, onClose }: {
  layout: WarehouseLayout; floor: number; catalog: EquipmentCategory[]; onCreate: (item: LayoutEquipment) => void; onClose: () => void;
}) {
  const { tr } = useI18n();
  const [item, setItem] = useState<LayoutEquipment>(() => createEquipment(catalog[0], nextEquipmentNumber(layout, catalog[0].code), floor, [3, 3]));
  const category = catalog.find(c => c.code === item.category)!;
  const duplicate = (layout.equipment ?? []).some(e => e.category === item.category && e.number.trim() === item.number.trim());
  const ok = item.number.trim() !== '' && !duplicate && timingValid(item.timing) && (!item.vehicle || vehicleValid(item.vehicle))
    && Number.isFinite(item.position[0]) && Number.isFinite(item.position[1]) && Number.isFinite(item.rotation);
  return <Dialog title={tr("Add equipment")} wide onClose={onClose} submitLabel={tr("Add equipment")} canSubmit={ok} onSubmit={() => onCreate({ ...item, number: item.number.trim() })}>
    <div className="wt-inline">
      <label>{tr("Equipment category")}<select value={item.category} onChange={e => {
        const c = catalog.find(x => x.code === e.target.value)!;
        setItem(createEquipment(c, nextEquipmentNumber(layout, c.code), floor, item.position, item.rotation));
      }}>{catalog.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code}) · {tr(KIND[c.kind])}</option>)}</select></label>
      <label>{tr("Equipment number")}<input value={item.number} maxLength={40} onChange={e => setItem(v => ({ ...v, number: e.target.value }))} required />
        {duplicate && <small className="wt-inline-error">{tr("{0} is already used", `${item.category}-${item.number}`)}</small>}</label>
      <label>{tr("Display name")}<input value={item.name ?? ''} placeholder={`${item.category}-${item.number}`} maxLength={80} onChange={e => setItem(v => ({ ...v, name: e.target.value || undefined }))} /></label>
    </div>
    <div className="wt-inline">
      <Num label={category.kind === 'vehicle' ? tr("Idle parking X (m)") : tr("Installation X (m)")} value={item.position[0]} onChange={v => setItem(i => ({ ...i, position: [v, i.position[1]] }))} />
      <Num label={category.kind === 'vehicle' ? tr("Idle parking Z (m)") : tr("Installation Z (m)")} value={item.position[1]} onChange={v => setItem(i => ({ ...i, position: [i.position[0], v] }))} />
      <Num label={tr("Rotation (°)")} value={item.rotation} step={15} onChange={v => setItem(i => ({ ...i, rotation: v }))} />
    </div>
    <TimingEditor timing={item.timing} onChange={timing => setItem(i => ({ ...i, timing }))} />
    {item.vehicle && <VehicleEditor vehicle={item.vehicle} onChange={vehicle => setItem(i => ({ ...i, vehicle }))} />}
    {category.work_points?.length ? <p className="wt-note">{tr("Work points")}: {category.work_points.map(w => w.label).join('、')}</p> : null}
  </Dialog>;
}
