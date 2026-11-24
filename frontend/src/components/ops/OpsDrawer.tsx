import { useI18n } from "../../i18n";
/**
 * AI Operations 抽屜（Phase 4：可解釋決策 + KPI；Phase 5 在上方加 Copilot 對話）
 * 規格 2️⃣5️⃣：不只說「選 R04」，要列出 ✓ 理由與被拒絕者的原因。
 */
import { useEffect } from "react";
import { useFocusTrap } from "../ui/useFocusTrap";
import { useStore, tickToClock } from "../../state/store";
import { Copilot } from "./Copilot";

export function OpsDrawer() {
  const { tr, label } = useI18n();
  const open = useStore((s) => s.drawer === "ops");
  const setDrawer = useStore((s) => s.setDrawer);
  const decisions = useStore((s) => s.twin.recent_decisions);
  const kpi = useStore((s) => s.twin.kpi);
  const select = useStore((s) => s.select);
  const trap = useFocusTrap<HTMLElement>(open);
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(null); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open, setDrawer]);
  if (!open) return null;
  const e = kpi.efficiency, o = kpi.operation;
  return (
    <aside className="drawer wide" role="dialog" aria-label={tr("AI Operations")} ref={trap} tabIndex={-1}>
      <header className="drawer-h"><span>{tr("AI Operations")}</span><button className="icon-btn" aria-label={tr("Close")} onClick={() => setDrawer(null)}>✕</button></header>
      <div className="drawer-b">
        <h4 className="drawer-sub" style={{ marginTop: 0 }}>KPI</h4>
        <div className="kpi-grid">
          <Tile k={tr("Throughput")} v={`${o.throughput_per_min}`} u={tr("tasks/min")} />
          <Tile k={tr("Utilization")} v={`${Math.round(o.avg_utilization * 100)}%`} />
          <Tile k={tr("On-time")} v={`${Math.round(o.on_time_rate * 100)}%`} />
          <Tile k={tr("Avg task")} v={`${Math.round(o.avg_task_time_s)}`} u={tr("s")} />
          <Tile k={tr("Avg travel")} v={`${e.avg_travel_distance_m}`} u={tr("m/task")} />
          <Tile k={tr("Avg wait")} v={`${e.avg_wait_time_s}`} u={tr("s/robot")} />
          <Tile k={tr("Congestion")} v={`${Math.round(e.congestion_index * 100)}%`} />
          <Tile k={tr("Energy")} v={`${e.energy_kwh.toFixed(2)}`} u={tr("kWh")} />
          <Tile k={tr("Lift trips")} v={`${kpi.lifts?.trips ?? 0}`} />
          <Tile k={tr("Lift wait")} v={`${kpi.lifts?.avg_wait_s ?? 0}`} u={tr("s avg")} />
          <Tile k={tr("Lift util")} v={`${Math.round((kpi.lifts?.utilization ?? 0) * 100)}%`} />
        </div>
        <h4 className="drawer-sub">{tr("Operations Copilot")}</h4>
        <Copilot />
        <h4 className="drawer-sub">{tr("Fleet Manager Decisions ({0})", decisions.length)}</h4>
        {decisions.length === 0 && <div className="hint">{tr("No decisions yet.")}</div>}
        {decisions.slice(0, 12).map((d) => {
          const sel = d.candidates.find((c) => c.robot_id === d.selected_robot);
          return (
            <div key={d.id} className="decision">
              <div className="dec-h">
                <span className="t">{tickToClock(d.tick, 100, true)}</span>
                <span>{label(d.kind, d.kind.replace("_", " "))} {tr("· Task #")}{d.task_id}</span>
                <button className="link" onClick={() => d.selected_robot && select(d.selected_robot)}>{tr("Selected")} {d.selected_robot}</button>
              </div>
              {sel && <ul className="reasons">{sel.reasons.map((r) => <li key={r}>✓ {r}</li>)}<li className="score">{tr("score")} {sel.score.toFixed(2)}</li></ul>}
              {d.candidates.filter((c) => c.robot_id !== d.selected_robot).length > 0 && (
                <div className="rejected">{tr("Rejected:")} {d.candidates.filter((c) => c.robot_id !== d.selected_robot).map((c) => `${c.robot_id} — ${c.rejected_reason} (${c.score.toFixed(2)})`).join(" · ")}</div>
              )}
              <div className="weights">{tr("weights:")} {Object.entries(d.weights).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Tile({ k, v, u }: { k: string; v: string; u?: string }) {
  return <div className="tile"><div className="k">{k}</div><div className="v">{v}{u && <span className="u"> {u}</span>}</div></div>;
}
