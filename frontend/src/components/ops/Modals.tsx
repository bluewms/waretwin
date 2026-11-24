import { useI18n } from "../../i18n";
/**
 * Phase 4 Modals：
 *  - AuditLog：完整事件紀錄。online 從後端 SQLite (/api/events) 抓 500 筆並可篩選；local 用本地 ring。可匯出 CSV / JSON。
 *  - TaskTable：全部任務 + 建立任務表單（source/destination 選項來自 layout.locations）。
 *  - RobotDetail：規格 3️⃣ 的完整欄位 + 累計統計 + 該機器人最近事件 + 故障/復原按鈕。
 */
import { useEffect, useMemo, useState } from "react";
import { STATUS_COLOR, layout, tickToClock, useStore } from "../../state/store";
import { simControl } from "../../simulation/runner";
import { API_URL } from "../../services/ws";
import type { TwinEvent, TaskPriority, TaskType } from "../../schema/twin_state";
import { Dot } from "../ui/primitives";
import { useFocusTrap } from "../ui/useFocusTrap";
import { percText } from "../panels/RightPanels";
import { taskError } from "../../simulation/rules";

export function Modals() {
  const { tr } = useI18n();
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && setModal(null); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [setModal]);
  const trap = useFocusTrap<HTMLDivElement>(!!modal);
  if (!modal) return null;
  const titles = { audit: "Audit / Event Log", tasks: "Tasks", robot: "Robot details", fleet: "Robot fleet" } as const;
  return (
    <div className="modal-bg" onClick={() => setModal(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr(titles[modal])} tabIndex={-1} ref={trap} onClick={(e) => e.stopPropagation()}>
        {modal === "audit" && <AuditLog />}
        {modal === "tasks" && <TaskTable />}
        {modal === "robot" && <RobotDetail />}
        {modal === "fleet" && <FleetList />}
      </div>
    </div>
  );
}

function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  const { tr } = useI18n();
  const setModal = useStore((s) => s.setModal);
  return <header className="modal-h"><span>{title}</span><span className="spacer" />{children}<button className="icon-btn" aria-label={tr("Close")} onClick={() => setModal(null)}>✕</button></header>;
}

// ─────────────────────────────────────────────────────────────
function AuditLog() {
  const { tr, label } = useI18n();
  const source = useStore((s) => s.source);
  const local = useStore((s) => s.twin.recent_events);
  const select = useStore((s) => s.select);
  const setModal = useStore((s) => s.setModal);
  const [remote, setRemote] = useState<TwinEvent[] | null>(null);
  const [sev, setSev] = useState(""); const [src, setSrc] = useState(""); const [q, setQ] = useState("");
  useEffect(() => {
    if (source !== "online") { setRemote(null); return; }
    let alive = true;
    fetch(`${API_URL}/api/events?limit=500`).then((r) => r.json()).then((d: TwinEvent[]) => alive && setRemote(d)).catch(() => alive && setRemote(null));
    return () => { alive = false; };
  }, [source]);
  const events = remote ?? local;
  const rows = useMemo(() => events.filter((e) => (!sev || e.severity === sev) && (!src || e.source === src) && (!q || `${e.message} ${e.robot_id ?? ""} ${e.zone_id ?? ""} ${e.type}`.toLowerCase().includes(q.toLowerCase()))), [events, sev, src, q]);
  const exportFile = (kind: "json" | "csv") => {
    const body = kind === "json" ? JSON.stringify(rows, null, 2) : ["id,tick,time,type,source,severity,robot,task,zone,message", ...rows.map((e) => [e.id, e.tick, tickToClock(e.tick, 100, true), e.type, e.source, e.severity, e.robot_id ?? "", e.task_id ?? "", e.zone_id ?? "", `"${e.message.replace(/"/g, '""')}"`].join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: kind === "json" ? "application/json" : "text/csv" })); a.download = `audit_log.${kind}`; a.click();
  };
  return (
    <>
      <Head title={tr("Audit / Event Log")}><span className="hint" style={{ margin: 0 }}>{remote ? tr("backend SQLite") : tr("local ring buffer")}</span><button className="btn" onClick={() => exportFile("csv")}>{tr("Export CSV")}</button><button className="btn" onClick={() => exportFile("json")}>{tr("Export JSON")}</button></Head>
      <div className="modal-b">
        <div className="filters">
          <select value={sev} onChange={(e) => setSev(e.target.value)}><option value="">{tr("All severities")}</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <select value={src} onChange={(e) => setSrc(e.target.value)}><option value="">{tr("All sources")}</option>{["ROBOT", "FLEET_MANAGER", "PLANNER", "SIMULATION", "CONVEYOR", "CAMERA", "VLM", "LIFT", "USER", "AI_AGENT"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <input placeholder={tr("search message / robot / zone…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <span className="count">{rows.length} / {events.length}</span>
        </div>
        <table className="dt full">
          <thead><tr><th>{tr("Time")}</th><th>{tr("Tick")}</th><th>{tr("Severity")}</th><th>{tr("Source")}</th><th>{tr("Type")}</th><th>{tr("Message")}</th><th>{tr("Robot")}</th><th>{tr("Zone")}</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} onClick={() => { if (e.robot_id) { select(e.robot_id); setModal(null); } }}>
                <td>{tickToClock(e.tick, 100, true)}</td><td>{e.tick}</td><td className={"sev-" + e.severity}>{label(e.severity)}</td><td>{label(e.source)}</td><td>{label(e.type)}</td><td style={{ fontFamily: "var(--font)" }}>{e.message}</td><td>{e.robot_id ?? ""}</td><td>{e.zone_id ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
function TaskTable() {
  const { tr, label } = useI18n();
  const tasks = useStore((s) => s.twin.tasks);
  const locs = useStore((s) => s.locations);
  const select = useStore((s) => s.select);
  const setModal = useStore((s) => s.setModal);
  const [type, setType] = useState<TaskType>("PICK");
  const [priority, setPriority] = useState<TaskPriority>("HIGH");
  const [source, setSource] = useState("SHELF-A12");
  const [dest, setDest] = useState("PACK-01");
  const [status, setStatus] = useState("");
  const order: Record<string, number> = { IN_PROGRESS: 0, ASSIGNED: 1, WAITING: 2, TRANSFERRED: 3, COMPLETED: 4, FAILED: 5, CANCELLED: 6 };
  const rows = Object.values(tasks).filter((t) => !status || t.status === status).sort((a, b) => order[a.status] - order[b.status] || b.created_tick - a.created_tick);
  const pretty = (id: string) => { const l = locs[id]; if (!l) return id; return l.kind === "SHELF" ? tr("Shelf {0}", id.replace("SHELF-", "")) : id.replace("-", " "); };
  const opts = layout.locations.filter((l) => l.kind !== "CHARGING");
  const err = taskError(locs, type, source, dest, tr, label);
  return (
    <>
      <Head title={tr("Tasks")} />
      <div className="modal-b">
        <form className="form" onSubmit={(e) => { e.preventDefault(); if (!err) simControl.createTask({ type, priority, source, destination: dest }); }}>
          <label>{tr("Type")}<select value={type} onChange={(e) => setType(e.target.value as TaskType)}>{["PICK", "TRANSPORT", "REPLENISH", "RETURN"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
          <label>{tr("Priority")}<select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>{["LOW", "NORMAL", "HIGH", "CRITICAL"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
          <label>{tr("Source")}<select value={source} onChange={(e) => setSource(e.target.value)}>{opts.map((l) => <option key={l.id} value={l.id}>{pretty(l.id)}</option>)}</select></label>
          <label>{tr("Destination")}<select value={dest} onChange={(e) => setDest(e.target.value)}>{opts.map((l) => <option key={l.id} value={l.id}>{pretty(l.id)}</option>)}</select></label>
          <label>{tr("Filter")}<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{tr("All")}</option>{Object.keys(order).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <button className="btn primary" type="submit" disabled={!!err} title={err ? label(err) : tr("Create task")}>{tr("+ Create task")}</button>
          {err && <span className="form-err">{label(err)}</span>}
        </form>
        <table className="dt full">
          <thead><tr><th>{tr("Task")}</th><th>{tr("Type")}</th><th>{tr("Priority")}</th><th>{tr("Status")}</th><th>{tr("From")}</th><th>{tr("To")}</th><th>{tr("Robot")}</th><th>{tr("Created")}</th><th>{tr("Assigned")}</th><th>{tr("Completed")}</th><th>{tr("Duration")}</th><th>{tr("Parent")}</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} onClick={() => { if (t.assigned_robot) { select(t.assigned_robot); setModal(null); } }}>
                <td>#{t.id}</td><td>{label(t.type)}</td><td>{label(t.priority)}</td>
                <td className={t.status === "IN_PROGRESS" || t.status === "ASSIGNED" ? "st-inprog" : t.status === "WAITING" ? "st-wait" : t.status === "COMPLETED" ? "" : "st-fail"}>{label(t.status)}</td>
                <td>{pretty(t.source)}</td><td>{pretty(t.destination)}</td><td>{t.assigned_robot ?? "—"}</td>
                <td>{tickToClock(t.created_tick, 100, true)}</td><td>{t.assigned_tick !== null ? tickToClock(t.assigned_tick, 100, true) : "—"}</td><td>{t.completed_tick !== null ? tickToClock(t.completed_tick, 100, true) : "—"}</td>
                <td>{t.completed_tick !== null ? tr("{0}s", ((t.completed_tick - t.created_tick) / 10).toFixed(0)) : "—"}</td><td>{t.parent_task_id ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
/** 機器人清單：點任一列 → 選取該機器人（3D 鏡頭自動聚焦）並關閉；可依狀態篩選、欄位排序 */
function FleetList() {
  const { tr, label } = useI18n();
  const robots = useStore((s) => s.twin.robots);
  const tasks = useStore((s) => s.twin.tasks);
  const select = useStore((s) => s.select);
  const setModal = useStore((s) => s.setModal);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"id" | "battery" | "status" | "tasks" | "distance">("id");
  const rows = useMemo(() => {
    const list = Object.values(robots).filter((r) => !status || r.status === status);
    const key = (r: typeof list[number]) => sort === "battery" ? r.battery : sort === "tasks" ? -r.stats.tasks_completed : sort === "distance" ? -r.stats.distance_m : sort === "status" ? r.status : r.id;
    return list.sort((a, b) => { const ka = key(a), kb = key(b); return ka < kb ? -1 : ka > kb ? 1 : a.id.localeCompare(b.id); });
  }, [robots, status, sort]);
  const counts = useMemo(() => Object.values(robots).reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {}), [robots]);
  const Th = ({ k, children }: { k: typeof sort; children: React.ReactNode }) => <th onClick={() => setSort(k)} style={{ cursor: "pointer", color: sort === k ? "var(--accent)" : undefined }}>{children}{sort === k ? " ↓" : ""}</th>;
  return (
    <>
      <Head title={tr("Robot Fleet · {0} AMRs", Object.keys(robots).length)}><span className="hint" style={{ margin: 0 }}>{tr("click a row to select & focus the camera")}</span></Head>
      <div className="modal-b">
        <div className="filters">
          {["", "ACTIVE", "IDLE", "CHARGING", "WARNING", "ERROR", "OFFLINE"].map((st) => (
            <button key={st} className={"chip" + (status === st ? " on" : "")} onClick={() => setStatus(st)} style={st ? { color: STATUS_COLOR[st as keyof typeof STATUS_COLOR] } : undefined}>{st ? label(st) : tr("All")}{st ? ` ${counts[st] ?? 0}` : ` ${Object.keys(robots).length}`}</button>
          ))}
        </div>
        <table className="dt full">
          <thead><tr><Th k="id">{tr("Robot")}</Th><th>{tr("Floor")}</th><Th k="status">{tr("Status")}</Th><th>{tr("State")}</th><Th k="battery">{tr("Battery")}</Th><th>{tr("Task")}</th><th>{tr("Zone")}</th><th>{tr("Speed")}</th><th>{tr("Perception")}</th><Th k="tasks">{tr("Done")}</Th><Th k="distance">{tr("Distance")}</Th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const t = r.current_task_id ? tasks[r.current_task_id] : null;
              const col = STATUS_COLOR[r.status];
              return (
                <tr key={r.id} onClick={() => { select(r.id); setModal(null); }} style={{ cursor: "pointer" }}>
                  <td style={{ fontWeight: 700 }}>{r.id}</td>
                  <td style={{ color: r.floor > 1 || r.lift_id ? "#a78bfa" : undefined }}>{r.lift_id ? `🛗 ${r.lift_id}` : `F${r.floor}`}</td>
                  <td style={{ color: col }}><Dot color={col} />{label(r.status, r.status[0] + r.status.slice(1).toLowerCase())}</td>
                  <td>{label(r.fsm)}</td>
                  <td style={{ color: r.battery < 10 ? "#ef4444" : r.battery < 20 ? "#f97316" : undefined }}>{r.battery.toFixed(0)}%</td>
                  <td>{t ? `#${t.id} ${label(t.type, t.type[0] + t.type.slice(1).toLowerCase())}` : "—"}</td>
                  <td>{r.zone ? tr("Zone {0}", r.zone) : "—"}</td>
                  <td>{r.velocity > 0.05 ? tr("{0} m/s", r.velocity.toFixed(2)) : "—"}</td>
                  <td style={{ color: r.perception?.state === "STOPPED" ? "#ef4444" : r.perception?.state === "SLOWING" ? "#f59e0b" : undefined }}>{percText(r, tr, label)}</td>
                  <td>{r.stats.tasks_completed}</td>
                  <td>{r.stats.distance_m >= 1000 ? tr("{0} km", (r.stats.distance_m / 1000).toFixed(2)) : tr("{0} m", r.stats.distance_m.toFixed(0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
function RobotDetail() {
  const { tr, label } = useI18n();
  const id = useStore((s) => s.selectedRobot);
  const r = useStore((s) => (id ? s.twin.robots[id] : undefined));
  const task = useStore((s) => (r?.current_task_id ? s.twin.tasks[r.current_task_id] : undefined));
  const events = useStore((s) => s.twin.recent_events);
  const locs = useStore((s) => s.locations);
  if (!r) return <><Head title={tr("Robot")} /><div className="modal-b hint">{tr("No robot selected.")}</div></>;
  const col = STATUS_COLOR[r.status];
  const pretty = (x: string | null) => { if (!x) return "—"; const l = locs[x]; return l ? (l.kind === "SHELF" ? tr("Shelf {0}", x.replace("SHELF-", "")) : x.replace("-", " ")) : x; };
  const mine = events.filter((e) => e.robot_id === r.id).slice(0, 40);
  const KV = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="kv"><span className="k">{label(k)}</span><span className="v">{v}</span></div>;
  return (
    <>
      <Head title={tr("Robot {0}", r.id)}>
        <span className="status-text" style={{ color: col }}><Dot color={col} />{label(r.status)}</span>
        {r.status === "OFFLINE" ? <button className="btn" onClick={() => simControl.clearInjection("ROBOT_FAILURE", r.id)}>{tr("Restore")}</button> : <button className="btn danger" onClick={() => simControl.inject({ kind: "ROBOT_FAILURE", robot_id: r.id })}>{tr("Fail robot")}</button>}
        <button className="btn warn" onClick={() => simControl.inject({ kind: "ROBOT_BATTERY_SET", robot_id: r.id, battery: 8 })}>{tr("Battery → 8%")}</button>
      </Head>
      <div className="modal-b">
        <div className="kv-grid">
          <div><KV k={tr("Status")} v={label(r.status)} /><KV k={tr("FSM")} v={label(r.fsm)} /><KV k={tr("Battery")} v={`${r.battery.toFixed(1)}%`} /><KV k={tr("Speed")} v={tr("{0} m/s (max {1})", r.velocity.toFixed(2), r.max_speed)} /><KV k={tr("Health")} v={`${r.health}%`} /><KV k={tr("Zone")} v={r.zone ?? "—"} /></div>
          <div><KV k={tr("Current Task")} v={task ? `#${task.id} ${label(task.type)} (${label(task.priority)})` : "—"} /><KV k={tr("From")} v={pretty(task?.source ?? null)} /><KV k={tr("Destination")} v={pretty(task?.destination ?? r.destination)} /><KV k={tr("Load")} v={`${r.load.current} / ${r.load.capacity}`} /><KV k={tr("ETA")} v={r.eta_s !== null ? tr("{0} s", r.eta_s) : "—"} /><KV k={tr("Path")} v={tr("{0} cells left", r.path.length - r.path_index)} /></div>
          <div><KV k={tr("Tasks completed")} v={r.stats.tasks_completed} /><KV k={tr("Distance")} v={tr("{0} m", r.stats.distance_m.toFixed(0))} /><KV k={tr("Energy")} v={tr("{0} Wh", r.stats.energy_wh.toFixed(0))} /><KV k={tr("Busy")} v={tr("{0} s", (r.stats.busy_ticks / 10).toFixed(0))} /><KV k={tr("Waiting")} v={tr("{0} s", (r.stats.wait_ticks / 10).toFixed(0))} /><KV k={tr("Position")} v={`${r.position[0].toFixed(1)}, ${r.position[2].toFixed(1)}`} /></div>
        </div>
        <h4 className="drawer-sub">{tr("Recent events")}</h4>
        <table className="dt full"><tbody>{mine.map((e) => <tr key={e.id}><td>{tickToClock(e.tick, 100, true)}</td><td className={"sev-" + e.severity}>{label(e.severity)}</td><td style={{ fontFamily: "var(--font)" }}>{e.message}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
