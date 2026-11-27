import { useI18n, type Message } from '../i18n';
import type { EquipmentTiming, TimeUnit, VehicleParams } from '../layout/types';

/** 数字输入：允许暂时为空（NaN 交给调用方校验），不在输入过程中改写用户的值。 */
export function Num({ label, value, onChange, step = 0.1, min, max, disabled, hint }: {
  label: string; value: number | null | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; disabled?: boolean; hint?: string;
}) {
  return <label>{label}<input type="number" step={step} min={min} max={max} disabled={disabled}
    value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
    onChange={e => onChange(e.target.valueAsNumber)} />{hint && <small>{hint}</small>}</label>;
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className="wt-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />{label}</label>;
}

const UNITS: TimeUnit[] = ['s', 'min', 'h'];
const UNIT_LABEL: Record<TimeUnit, Message> = { s: 'seconds', min: 'minutes', h: 'hours' };

export function TimingEditor({ timing, onChange, disabled }: { timing: EquipmentTiming; onChange: (t: EquipmentTiming) => void; disabled?: boolean }) {
  const { tr } = useI18n();
  return <fieldset className="wt-fieldset" disabled={disabled}>
    <legend>{tr("Timing method")}</legend>
    <label className="wt-check"><input type="radio" checked={timing.mode === 'speed'} onChange={() => onChange({ mode: 'speed', speed_mps: timing.speed_mps ?? 1 })} />{tr("By running speed")}</label>
    <label className="wt-check"><input type="radio" checked={timing.mode === 'production'} onChange={() => onChange({ mode: 'production', production_value: timing.production_value ?? 5, production_unit: timing.production_unit ?? 'min' })} />{tr("By production time")}</label>
    {timing.mode === 'speed'
      ? <Num label={tr("Running speed (m/s)")} value={timing.speed_mps} min={0} step={0.1} onChange={v => onChange({ ...timing, speed_mps: v })} />
      : <div className="wt-inline">
        <Num label={tr("Production time")} value={timing.production_value} min={0} step={1} onChange={v => onChange({ ...timing, production_value: v })}
          hint={tr("Mandatory stay / work time after arrival")} />
        <label>{tr("Unit")}<select value={timing.production_unit ?? 'min'} onChange={e => onChange({ ...timing, production_unit: e.target.value as TimeUnit })}>
          {UNITS.map(u => <option key={u} value={u}>{tr(UNIT_LABEL[u])}</option>)}</select></label>
      </div>}
  </fieldset>;
}

export function timingValid(t: EquipmentTiming): boolean {
  return t.mode === 'speed' ? (t.speed_mps ?? 0) > 0 : (t.production_value ?? 0) > 0 && !!t.production_unit && UNITS.includes(t.production_unit);
}

export function VehicleEditor({ vehicle, onChange, disabled }: { vehicle: VehicleParams; onChange: (v: VehicleParams) => void; disabled?: boolean }) {
  const { tr } = useI18n();
  const set = (patch: Partial<VehicleParams>) => onChange({ ...vehicle, ...patch });
  return <fieldset className="wt-fieldset" disabled={disabled}>
    <legend>{tr("Vehicle")}</legend>
    <div className="wt-inline">
      <Num label={tr("Body width (m)")} value={vehicle.width} min={0} onChange={v => set({ width: v })} hint={tr("Length along travel")} />
      <Num label={tr("Body depth (m)")} value={vehicle.depth} min={0} onChange={v => set({ depth: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("Pick fixed time (s)")} value={vehicle.pick_s} min={0} step={1} onChange={v => set({ pick_s: v })} />
      <Num label={tr("Drop fixed time (s)")} value={vehicle.drop_s} min={0} step={1} onChange={v => set({ drop_s: v })} />
    </div>
    <div className="wt-inline">
      <Num label={tr("Fork lift speed (m/s)")} value={vehicle.lift_speed_mps} min={0} step={0.05}
        onChange={v => set({ lift_speed_mps: Number.isFinite(v) ? v : null })} hint={tr("Leave empty for vehicles without fork lift")} />
      <Num label={tr("Low battery threshold (%)")} value={vehicle.low_battery_pct} min={1} max={99} step={1} onChange={v => set({ low_battery_pct: v })} />
    </div>
  </fieldset>;
}

export function vehicleValid(v: VehicleParams): boolean {
  return v.width > 0 && v.depth > 0 && v.pick_s >= 0 && v.drop_s >= 0 && (v.lift_speed_mps === null || v.lift_speed_mps > 0)
    && v.low_battery_pct > 0 && v.low_battery_pct < 100;
}
