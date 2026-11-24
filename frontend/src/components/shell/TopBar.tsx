import { LanguageSwitch, useI18n } from "../../i18n";
import { useStore, tickToClock } from "../../state/store";
import { simControl } from "../../simulation/runner";
import { Icon } from "../ui/primitives";

export function TopBar() {
  const { tr } = useI18n();
  const mode = useStore((s) => s.twin.sim.mode);
  const tick = useStore((s) => s.twin.sim.tick);
  const speed = useStore((s) => s.speed);
  const paused = useStore((s) => s.paused);
  const source = useStore((s) => s.source);
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const setModal = useStore((s) => s.setModal);
  const alerts = useStore((s) => s.twin.alerts);
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const unack = Object.values(alerts).filter((a) => !a.acknowledged).length;
  const simDate = "2026/05/20";
  return (
    <header className="topbar">
      <div className="brand"><span className="ai">Ware</span><span>Twin</span><span className="brand-sub">{tr("Powered by Next Robotics")}</span></div>
      <span className={"badge-live " + (paused ? "paused" : mode === "WHATIF" ? "whatif" : "live")}>
        <span className="dot" style={{ background: "currentColor", width: 6, height: 6 }} />{paused ? tr("PAUSED") : mode === "WHATIF" ? tr("SIMULATION") : tr("LIVE")}
      </span>
      <span className={"badge-src " + source} title={source === "online" ? tr("Connected to backend (FastAPI WebSocket)") : source === "local" ? tr("Backend unreachable — running local simulation engine") : tr("Connecting to backend…")}>
        <span className="dot" style={{ background: "currentColor", width: 6, height: 6 }} />{source === "online" ? tr("BACKEND") : source === "local" ? tr("LOCAL") : tr("CONNECTING")}
      </span>
      <div className="topbar-right">
        <div className="sim-controls" title={tr("Simulation controls")}>
          <button className={!paused ? "on" : ""} title={tr("Play")} onClick={() => simControl.play()}>{Icon.play}</button>
          <button className={paused ? "on" : ""} title={tr("Pause")} onClick={() => simControl.pause()}>{Icon.pause}</button>
          <button title={tr("Reset (same seed)")} onClick={() => simControl.reset()}>{Icon.reset}</button>
          {([1, 2, 5, 10] as const).map((x) => <button key={x} className={speed === x ? "on" : ""} onClick={() => simControl.play(x)}>{x}×</button>)}
        </div>
        <div className="clock" title={tr("Simulation time")}>
          <div className="t">{tickToClock(tick, 100, true)}</div>
          <div className="d">{simDate} · T{tick}</div>
        </div>
        <div className="vsep" />
        <button className={"tb-btn" + (drawer === "scenarios" ? " on" : "")} onClick={() => setDrawer("scenarios")} title={tr("Failure injection")}>{Icon.bolt}<span>{tr("Scenarios")}</span></button>
        <button className={"tb-btn" + (drawer === "ops" ? " on" : "")} onClick={() => setDrawer("ops")} title={tr("AI Operations: KPI + explainable decisions")}>{Icon.brain}<span>{tr("AI Ops")}</span></button>
        <button className={"tb-btn" + (drawer === "whatif" ? " on" : "")} onClick={() => setDrawer("whatif")} title={tr("What-if simulation: clone the twin, inject, compare KPI")}>{Icon.fork}<span>{tr("What-if")}</span></button>
        <button className={"tb-btn" + (drawer === "roi" ? " on" : "")} onClick={() => setDrawer("roi")} title={tr("ROI Calculator: project savings, payback, 3-year ROI")}>{Icon.chart}<span>ROI</span></button>
        <div className="vsep" />
        <button className="icon-btn" title={tr("Audit log")} onClick={() => setModal("audit")}>{Icon.bell}{unack > 0 && <span className="dot">{unack}</span>}</button>
        <button className="icon-btn" title={tr("Render quality: {0} (click to cycle)", tr(quality))} onClick={() => setQuality(quality === "low" ? "medium" : quality === "medium" ? "high" : "low")}>{Icon.gear}</button>
        <div className="vsep" />
        <LanguageSwitch />
        <div className="user"><span className="avatar">{Icon.user}</span><span>{tr("Admin")}</span>{Icon.chev}</div>
      </div>
    </header>
  );
}
