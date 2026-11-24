import { useI18n } from "../../i18n";
/**
 * 故障注入抽屜（規格 1️⃣3️⃣）：Robot Failure / Conveyor Failure / Sensor(Camera) Failure / Human Intrusion / Traffic Congestion / Task Burst
 * 下方列出「目前生效中」的注入（從 TwinState 推導，不另存狀態），可一鍵解除。
 */
import { useState, useEffect } from "react";
import { useFocusTrap } from "../ui/useFocusTrap";
import { layout, useStore } from "../../state/store";
import { simControl } from "../../simulation/runner";
import type { ScenarioInjection } from "../../schema/twin_state";

export function ScenariosDrawer() {
  const { tr, label } = useI18n();
  const open = useStore((s) => s.drawer === "scenarios");
  const setDrawer = useStore((s) => s.setDrawer);
  const twin = useStore((s) => s.twin);
  const [robot, setRobot] = useState("R07");
  const [conveyor, setConveyor] = useState("CV03");
  const [camera, setCamera] = useState("CAM-B03");
  const [lift, setLift] = useState("LIFT-1");
  const [zone, setZone] = useState("B");
  const [duration, setDuration] = useState(60);
  const [level, setLevel] = useState(0.8);
  const [burst, setBurst] = useState(8);
  const trap = useFocusTrap<HTMLElement>(open);
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(null); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open, setDrawer]);
  if (!open) return null;

  const fire = (inj: ScenarioInjection) => simControl.inject(inj);
  const robots = Object.values(twin.robots);
  // 生效中的注入（由 state 推導）
  const active: Array<{ kind: ScenarioInjection["kind"]; target: string; label: string }> = [
    ...robots.filter((r) => r.status === "OFFLINE").map((r) => ({ kind: "ROBOT_FAILURE" as const, target: r.id, label: tr("{0} offline", r.id) })),
    ...Object.values(twin.conveyors).filter((c) => c.status === "ERROR").map((c) => ({ kind: "CONVEYOR_FAILURE" as const, target: c.id, label: tr("{0} error", c.id) })),
    ...Object.values(twin.cameras).filter((c) => c.status === "OFFLINE").map((c) => ({ kind: "CAMERA_OFFLINE" as const, target: c.id, label: tr("{0} offline", c.id) })),
    ...[...new Set(Object.values(twin.people).map((p) => p.zone).filter(Boolean))].map((z) => ({ kind: "HUMAN_INTRUSION" as const, target: z!, label: tr("Human in Zone {0}", z) })),
    ...Object.values(twin.alerts).filter((a) => a.id.startsWith("traffic-")).map((a) => ({ kind: "TRAFFIC_CONGESTION" as const, target: a.zone_id!, label: tr("Traffic Zone {0}", a.zone_id) })),
    ...Object.values(twin.lifts ?? {}).filter((l) => l.fault).map((l) => ({ kind: "LIFT_FAULT" as const, target: l.id, label: tr("{0} fault", l.id) })),
  ];

  return (
    <aside className="drawer" role="dialog" aria-label={tr("Scenario Injection")} ref={trap} tabIndex={-1}>
      <header className="drawer-h"><span>{tr("Scenario Injection")}</span><button className="icon-btn" aria-label={tr("Close")} onClick={() => setDrawer(null)}>✕</button></header>
      <div className="drawer-b">
        <p className="hint">{tr("Inject failures into the LIVE simulation and watch the Fleet Manager, A* planner and KPIs react. Each row maps to a demo scenario.")}</p>

        <Row title={tr("Robot Failure")} demo="05" desc={tr("Robot goes offline; its task is re-queued to another robot")}>
          <select value={robot} onChange={(e) => setRobot(e.target.value)}>{robots.map((r) => <option key={r.id} value={r.id}>{r.id} · {label(r.status, r.status.toLowerCase())} · {Math.round(r.battery)}%</option>)}</select>
          <button className="btn danger" onClick={() => fire({ kind: "ROBOT_FAILURE", robot_id: robot })}>{tr("Fail")}</button>
        </Row>
        <Row title={tr("Low Battery")} demo="02" desc={tr("Set battery to 8% — watch task hand-off and charger scheduling")}>
          <select value={robot} onChange={(e) => setRobot(e.target.value)}>{robots.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select>
          <button className="btn warn" onClick={() => fire({ kind: "ROBOT_BATTERY_SET", robot_id: robot, battery: 8 })}>{tr("Set 8%")}</button>
        </Row>
        <Row title={tr("Conveyor Failure")} demo="04" desc={tr("Conveyor stops; unloading at the station it feeds takes 4× longer → bottleneck")}>
          <select value={conveyor} onChange={(e) => setConveyor(e.target.value)}>{layout.conveyors.map((c) => <option key={c.id} value={c.id}>{c.name} → {c.feeds}</option>)}</select>
          <button className="btn danger" onClick={() => fire({ kind: "CONVEYOR_FAILURE", conveyor_id: conveyor })}>{tr("Stop")}</button>
        </Row>
        <Row title={tr("Human Intrusion")} demo="03" desc={tr("A worker enters the zone → zone blocked → robots re-plan")}>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>{layout.zones.map((z) => <option key={z.id} value={z.id}>{tr("Zone {0}", z.id)}</option>)}</select>
          <input type="number" min={10} max={600} value={duration} onChange={(e) => setDuration(+e.target.value)} title={tr("Seconds")} /><span className="unit">{tr("s")}</span>
          <button className="btn warn" onClick={() => fire({ kind: "HUMAN_INTRUSION", zone_id: zone, duration_ticks: duration * 10 })}>{tr("Inject")}</button>
        </Row>
        <Row title={tr("Traffic Congestion")} demo="06" desc={tr("Speed limit + higher path cost inside the zone → dynamic re-routing")}>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>{layout.zones.map((z) => <option key={z.id} value={z.id}>{tr("Zone {0}", z.id)}</option>)}</select>
          <input type="range" min={0.2} max={1} step={0.1} value={level} onChange={(e) => setLevel(+e.target.value)} title={tr("level")} /><span className="unit">{Math.round(level * 100)}%</span>
          <button className="btn warn" onClick={() => fire({ kind: "TRAFFIC_CONGESTION", zone_id: zone, level, duration_ticks: duration * 10 })}>{tr("Inject")}</button>
        </Row>
        <Row title={tr("Camera Failure")} demo="07" desc={tr("Camera goes offline; CCTV subsystem degraded")}>
          <select value={camera} onChange={(e) => setCamera(e.target.value)}>{layout.cameras.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}</select>
          <button className="btn" onClick={() => fire({ kind: "CAMERA_OFFLINE", camera_id: camera })}>{tr("Offline")}</button>
        </Row>
        <Row title={tr("Lift Fault")} demo="12" desc={tr("Freight lift out of service — waiting robots reroute to the other lift; a rider stays aboard until recovery")}>
          <select value={lift} onChange={(e) => setLift(e.target.value)}>{layout.lifts.map((l) => <option key={l.id} value={l.id}>{l.id}</option>)}</select>
          <button className="btn danger" onClick={() => fire({ kind: "LIFT_FAULT", lift_id: lift })}>{tr("Fault")}</button>
        </Row>
        <Row title={tr("Task Burst")} demo="—" desc={tr("Release many tasks at once — watch scheduling and congestion")}>
          <input type="number" min={1} max={30} value={burst} onChange={(e) => setBurst(+e.target.value)} /><span className="unit">{tr("tasks")}</span>
          <button className="btn" onClick={() => fire({ kind: "TASK_BURST", count: burst, priority: "HIGH" })}>{tr("Inject")}</button>
        </Row>
        <Row title={tr("Demo 10 · Compound")} demo="10" desc={tr("All at once: R07 low battery + human in Zone B + Conveyor #03 failure")}>
          <button className="btn danger" onClick={() => { fire({ kind: "ROBOT_BATTERY_SET", robot_id: "R07", battery: 8 }); fire({ kind: "HUMAN_INTRUSION", zone_id: "B", duration_ticks: 600 }); fire({ kind: "CONVEYOR_FAILURE", conveyor_id: "CV03" }); }}>{tr("Run all three")}</button>
        </Row>

        <h4 className="drawer-sub">{tr("Active ({0})", active.length)}</h4>
        {active.length === 0 && <div className="hint">{tr("None — everything nominal.")}</div>}
        {active.map((a) => (
          <div key={a.kind + a.target} className="active-row">
            <span className="dot" style={{ background: "var(--red)" }} /><span>{a.label}</span>
            <button className="link" onClick={() => simControl.clearInjection(a.kind, a.target)}>{tr("Clear")}</button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Row({ title, demo, desc, children }: { title: string; demo: string; desc: string; children: React.ReactNode }) {
  const { tr, label } = useI18n();
  return (
    <div className="inj-row">
      <div className="inj-head"><b>{label(title)}</b><span className="demo">{tr("Demo")} {demo}</span></div>
      <div className="inj-desc">{label(desc)}</div>
      <div className="inj-ctl">{children}</div>
    </div>
  );
}
