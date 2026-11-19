import { useState } from 'react';
import SectionHeading from './SectionHeading.jsx';

/**
 * Tab strip used by every hub page. The open tab is a soft oval, and a matching oval glides to the tab under the pointer
 * (or keyboard focus), the same look as the Finance / People / Payroll hub menus.
 *
 * A tab may carry `description`: the open tab then gets a heading + one-line description under the strip. Leave it off for a
 * tab whose page already draws its own heading.
 */
export default function SectionTabs({ tabs, value, onChange, className = '' }) {
  const [pill, setPill] = useState({ left: 0, top: 0, width: 0, height: 0, on: false });
  const move = (el) => setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight, on: true });
  const active = tabs.find((t) => t.key === value);

  return (
    <div className="min-w-0">
      <div
        className={`relative flex flex-wrap gap-1 border-b border-tertiary-200 pb-2 ${className}`}
        role="tablist"
        onMouseLeave={() => setPill((p) => ({ ...p, on: false }))}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-xl bg-primary-50 ring-1 ring-primary-100/70 transition-[left,top,width,height,opacity] duration-200 ease-out"
          style={{ left: pill.left, top: pill.top, width: pill.width, height: pill.height, opacity: pill.on ? 1 : 0 }}
        />
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key)}
            onMouseEnter={(e) => move(e.currentTarget)}
            onFocus={(e) => move(e.currentTarget)}
            className={`relative z-10 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              value === key ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-100' : 'text-tertiary-500 hover:text-primary-700 focus-visible:text-primary-700'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {label}
          </button>
        ))}
      </div>
      {tabs.length > 1 && active?.description && <SectionHeading className="pt-4" icon={active.icon} title={active.heading || active.label} description={active.description} />}
    </div>
  );
}
