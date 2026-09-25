// Business categories for a project / people requirement. Recruitment exists
// but is not switched on yet: it stays visible-but-disabled in pickers (never
// silently missing) and the API refuses it for new projects.
export const PROJECT_CATEGORIES = [
  { value: 'managed_services', label: 'Manage Services' },
  { value: 'project', label: 'Projects' },
  { value: 'recruitment', label: 'Recruitment (coming soon)', disabled: true },
];

export function categoryLabel(value) {
  return PROJECT_CATEGORIES.find((c) => c.value === value)?.label.replace(' (coming soon)', '') || '—';
}
