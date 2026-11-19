import SectionHeading from '../ui/SectionHeading.jsx';

/**
 * Heading + one-line description under a hub's tab bar, for the open tab.
 * `help` maps a tab key to its description; tabs in `skip` already draw their own heading, so they get none from here.
 * Nothing is drawn when the hub has a single tab (the page title already says it) or the tab has no description.
 */
export default function HubHeading({ tabs, section, help, skip, className = '' }) {
  const active = tabs.find((t) => t.key === section);
  if (tabs.length < 2 || !active || !help[section] || (skip && skip.has(section))) return null;
  return <SectionHeading className={className} icon={active.icon} title={active.label} description={help[section]} />;
}
