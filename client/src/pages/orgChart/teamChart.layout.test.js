import { describe, expect, test } from 'vitest';
import { layoutGroupChart } from './TeamChart.jsx';

const person = (id, name, extra = {}) => ({ id, person: { name }, role: 'employee', team_id: null, manager_id: null, direct_reports: [], ...extra });
const company = (name, roots, teams, adminId) => ({ org: { id: name, name, enabled_modules: [] }, headcount: roots.length, roots, teams, admins: [], company_admin_id: adminId });
const unitOf = (chart, id) => chart.units.find((u) => u.id === id);

describe('group org chart: company admin sits between the company and its teams', () => {
  test('a company with an admin outside any team: teams and people report to the admin, who hangs off the company', () => {
    const admin = person('a', 'Admin Z', { role: 'admin' });
    const sam = person('s', 'Sam', { team_id: 't1' });
    const lee = person('l', 'Lee');
    const chart = layoutGroupChart([company('Zephyr', [admin, sam, lee], [{ id: 't1', name: 'Sales', lead_membership_id: null, manager_membership_id: null, open_positions: 2, sort_order: 0 }], 'a')], 'Group Admin');
    const adminUnit = unitOf(chart, 'mgr:a');
    expect(adminUnit).toBeTruthy();                                     // the admin is drawn once, as a person
    const team = unitOf(chart, 'team:t1');
    expect(team.kind).toBe('team');                                      // the team is connected, not floating
    expect(team.managerId).toBe('a');
    expect(chart.floatBoxes.some((b) => b.id === 'team:t1')).toBe(false);
    expect(unitOf(chart, 'reports:a')?.members.map((m) => m.id)).toEqual(['l']); // a person with no manager reports to the admin
    expect(chart.extraSeats).toHaveLength(1);                            // the group admin is still drawn once, at the bottom
  });

  test('the team the admin leads hangs off the company; other teams hang off that team', () => {
    const admin = person('a', 'Paras (DG)', { role: 'admin', team_id: 'board' });
    const chart = layoutGroupChart([company('Delphic Global', [admin, person('b', 'Biswajit', { team_id: 'board' }), person('n', 'Nina', { team_id: 'ops' })], [
      { id: 'board', name: 'Board of Directors', lead_membership_id: 'a', manager_membership_id: null, open_positions: 0, sort_order: 0 },
      { id: 'ops', name: 'Ops', lead_membership_id: null, manager_membership_id: null, open_positions: 1, sort_order: 1 },
    ], 'a')], 'Group Admin');
    expect(unitOf(chart, 'team:board').kind).toBe('team');
    expect(unitOf(chart, 'team:ops').managerId).toBe('a');
    expect(chart.floatBoxes).toHaveLength(0);
  });

  test('a company without an admin is unchanged (teams without a manager still float)', () => {
    const chart = layoutGroupChart([company('Foundation', [person('s', 'Sam', { team_id: 't1' })], [{ id: 't1', name: 'Programs', lead_membership_id: null, manager_membership_id: null, open_positions: 0, sort_order: 0 }], null)], 'Group Admin');
    expect(chart.floatBoxes.some((b) => b.id === 'team:t1')).toBe(true);
  });
});
