/** 任務地點規則（與 backend/app/sim/rules.py 相同）：存在、非充電樁、不相同、符合 TaskType。 */
import { translate, type Translate } from "../i18n/locale";
import type { LayoutLocation } from "../layout/types";

export const TASK_RULES: Record<string, [Set<string>, Set<string>]> = {
  PICK: [new Set(["SHELF"]), new Set(["PACKING", "SORTING", "OUTBOUND"])],
  REPLENISH: [new Set(["INBOUND"]), new Set(["SHELF"])],
  TRANSPORT: [new Set(["PACKING", "SORTING", "INBOUND", "OUTBOUND"]), new Set(["PACKING", "SORTING", "INBOUND", "OUTBOUND"])],
  RETURN: [new Set(["PACKING", "SORTING", "OUTBOUND"]), new Set(["SHELF"])],
};

/** 回傳錯誤訊息；null = 合法 */
export function taskError(
  loc: Record<string, LayoutLocation>,
  type: string,
  source: string,
  destination: string,
  tr: Translate = (message, ...values) => translate("en", message, ...values),
  label: (value: string) => string = (value) => value,
): string | null {
  const rule = TASK_RULES[type];
  if (!rule) return tr("unknown task type {0}", type);
  const s = loc[source], d = loc[destination];
  if (!s) return tr("unknown source location {0}", source);
  if (!d) return tr("unknown destination location {0}", destination);
  if (source === destination) return tr("source and destination must differ");
  if (s.kind === "CHARGING" || d.kind === "CHARGING") return tr("charging stations cannot be task locations");
  if (!rule[0].has(s.kind)) return tr("{0} source must be one of {1}, got {2}", label(type), [...rule[0]].sort().map((kind) => label(kind)).join(", "), label(s.kind));
  if (!rule[1].has(d.kind)) return tr("{0} destination must be one of {1}, got {2}", label(type), [...rule[1]].sort().map((kind) => label(kind)).join(", "), label(d.kind));
  return null;
}
