import { useI18n, type Message } from '../i18n';
import type { LayoutIssue } from '../services/workspace';

const TEXT: Record<string, Message> = {
  container_missing: 'The bound container template does not exist',
  no_capacity: 'The container is wider than the clear width; no container fits on a level',
  container_too_deep: 'The container is deeper than the rack',
  level_too_low: 'Level {0} is too low for the container and cargo',
  container_too_large: 'The container is larger than the location',
  facility_out_of_bounds: 'The facility lies outside the floor',
  facility_overlap: 'The facility overlaps another object',
  duplicate_slot_name: '{0} storage names are already used by another facility',
  slot_unreachable: '{0} storage positions have no reachable stop point',
  reference_vehicle_missing: 'No vehicle added yet; stop points use the default 2.0 × 1.0 m body',
  duplicate_equipment: 'Equipment category and number are used twice',
  equipment_number: 'Equipment number is required',
  invalid_timing: 'Running speed or production time is invalid',
  invalid_vehicle: 'Vehicle size, handling times, lift speed or battery threshold are invalid',
  unknown_category: 'Equipment category is not in the catalog',
  equipment_out_of_bounds: 'The equipment lies outside the floor',
  invalid_facility: 'Facility parameters are invalid',
};

/** 按 code 显示本地化说明；未知 code 回退为服务端 message。 */
export function issueText(tr: ReturnType<typeof useI18n>['tr'], label: ReturnType<typeof useI18n>['label'], issue: Pick<LayoutIssue, 'code' | 'message' | 'count' | 'level'>): string {
  const key = TEXT[issue.code];
  if (!key) return label(issue.message);
  return tr(key, issue.code === 'level_too_low' ? issue.level : issue.count);
}

export function IssueList({ issues, describe }: { issues: LayoutIssue[]; describe?: (issue: LayoutIssue) => string | null }) {
  const { tr, label } = useI18n();
  return <ul className="wt-issues">{issues.map((issue, index) => <li key={`${issue.path}-${issue.code}-${index}`} className={issue.severity === 'warning' ? 'warning' : 'error'}>
    <strong>{issue.severity === 'warning' ? tr("Warning") : tr("Error")}</strong>{' '}
    {describe?.(issue) && <em>{describe(issue)}：</em>}{issueText(tr, label, issue)}
    {issue.names && issue.names.length > 0 && <small> {issue.names.join('、')}{(issue.count ?? 0) > issue.names.length ? ' …' : ''}</small>}
  </li>)}</ul>;
}
