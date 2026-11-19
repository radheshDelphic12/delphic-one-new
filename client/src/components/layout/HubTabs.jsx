import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** True on a device with no hover (phone / tablet): there a tap opens the sub-menu instead of going straight to the tab. */
const noHover = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;

/** Rough width (rem) of the open card, used only to keep it inside the screen. */
const cardRem = (n) => Math.min(46, 4 + n * 8.5);

/**
 * The tab bar of a hub page (People, Finance, Payroll ...). `modern` is the refreshed look (a rounded card with a soft
 * highlight on the open tab); without it the original underline bar is drawn, so the group superadmin keeps the old look.
 *
 * A tab may carry `children: [{ key, label, description?, icon?, badge? }]` (its sub-pages) and an optional `blurb`.
 * Hovering (or keyboard-focusing) such a tab opens a slim card with those sub-pages as a row of tabs and a one-line
 * description of the one under the pointer; picking one calls `onSelectChild(tabKey, childKey)`. `activeChild` marks the
 * sub-page that is open. Clicking the tab itself behaves as before (on a touch device the first tap opens the card).
 */
export default function HubTabs({ tabs, value, onSelect, onSelectChild, activeChild, modern = false }) {
  const [openKey, setOpenKeyState] = useState(null);
  const openRef = useRef(null);
  const setOpenKey = (k) => { openRef.current = k; setOpenKeyState(k); };
  // the sub-page under the pointer / keyboard focus (its description is shown under the row)
  const [hintKey, setHintKey] = useState(null);
  // where the open card sits: under the tab, flush left or right, or (small screens) the full width of the screen
  const [place, setPlace] = useState({ mode: 'left', top: 0 });
  // the soft highlight that glides between sub-page tabs under the pointer
  const [pill, setPill] = useState({ left: 0, width: 0, on: false });
  // the same highlight for the main tabs (hover and keyboard focus)
  const [topPill, setTopPill] = useState({ left: 0, top: 0, width: 0, height: 0, on: false });
  const moveTop = (el) => setTopPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight, on: true });
  const closeTimer = useRef(null);

  const movePill = (el) => setPill({ left: el.offsetLeft, width: el.offsetWidth, on: true });
  // Left / Right / Home / End move between the sub-pages; Down from the tab itself enters the row
  const rowKeys = (e) => {
    const items = [...e.currentTarget.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowRight') next = items[(at + 1) % items.length];
    else if (e.key === 'ArrowLeft') next = items[(at - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    if (next) { e.preventDefault(); next.focus(); }
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const open = (key, el, rem) => {
    clearTimeout(closeTimer.current);
    // already open (hover / focus events bubbling from inside the card): nothing to reset
    if (openRef.current === key) return;
    if (el && typeof window !== 'undefined') {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      setPlace(vw < 720 ? { mode: 'narrow', top: r.bottom + 8 } : { mode: r.left + rem * 16 > vw - 16 ? 'right' : 'left', top: 0 });
    }
    setHintKey(null);
    setPill((p) => ({ ...p, on: false }));
    setOpenKey(key);
    // rest the highlight on the sub-page that is open, once the card has been laid out
    if (el && typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const cur = el.querySelector('[role="menuitem"][aria-current="page"]');
        if (cur && openRef.current === key) movePill(cur);
      });
    }
  };
  const closeSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpenKey(null), 160); };

  // a single tab (an employee's Finance or Payroll) needs no tab bar in the refreshed look
  if (modern && tabs.length < 2) return <div aria-hidden="true" className="h-2" />;
  return (
    <div
      className={modern ? 'relative flex flex-wrap gap-1 rounded-2xl border border-tertiary-100 bg-white p-1.5 shadow-card' : 'relative flex flex-wrap gap-1 border-b border-tertiary-200 pb-2'}
      role="tablist"
      onMouseLeave={() => setTopPill((p) => ({ ...p, on: false }))}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-xl bg-primary-50 ring-1 ring-primary-100/70 transition-[left,top,width,height,opacity] duration-200 ease-out"
        style={{ left: topPill.left, top: topPill.top, width: topPill.width, height: topPill.height, opacity: topPill.on ? 1 : 0 }}
      />
      {tabs.map(({ key, label, icon: Icon, children, blurb }) => {
        const hasChildren = Array.isArray(children) && children.length > 1 && typeof onSelectChild === 'function';
        const isOpen = hasChildren && openKey === key;
        const shownKey = hintKey || (value === key && activeChild) || children?.[0]?.key;
        const shown = hasChildren ? children.find((c) => c.key === shownKey) : null;
        return (
          <div
            key={key}
            className={`relative ${isOpen ? 'z-30' : 'z-10'}`}
            onMouseEnter={(e) => { moveTop(e.currentTarget); if (hasChildren) open(key, e.currentTarget, cardRem(children.length)); }}
            onMouseLeave={hasChildren ? closeSoon : undefined}
            onFocus={(e) => { moveTop(e.currentTarget); if (hasChildren) open(key, e.currentTarget, cardRem(children.length)); }}
            onBlur={hasChildren ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) closeSoon(); } : undefined}
            onKeyDown={hasChildren ? (e) => {
              if (e.key === 'Escape') setOpenKey(null);
              if (e.key === 'ArrowDown' && e.target.getAttribute('role') === 'tab') {
                const first = e.currentTarget.querySelector('[role="menuitem"]');
                if (first) { e.preventDefault(); open(key, e.currentTarget, cardRem(children.length)); first.focus(); }
              }
            } : undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={value === key}
              aria-haspopup={hasChildren ? 'menu' : undefined}
              aria-expanded={hasChildren ? isOpen : undefined}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${value === key ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-100' : 'text-tertiary-500 hover:text-primary-700 focus-visible:text-primary-700'}`}
              onClick={(e) => {
                if (hasChildren && noHover() && !isOpen) { open(key, e.currentTarget.parentElement, cardRem(children.length)); return; }
                setOpenKey(null);
                onSelect(key);
              }}
            >
              {Icon && <Icon className="h-4 w-4" />}
              {label}
              {hasChildren && <ChevronDown className={`h-3 w-3 opacity-60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden />}
            </button>
            {hasChildren && (
              <div
                role="menu"
                aria-label={`${label} pages`}
                style={place.mode === 'narrow' ? { top: place.top, left: 16, right: 16 } : { maxWidth: 'calc(100vw - 2rem)' }}
                className={`z-30 w-max origin-top overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-soft transition-[opacity,transform,visibility] duration-200 ease-out ${place.mode === 'narrow' ? 'fixed w-auto' : `absolute top-full mt-2 ${place.mode === 'right' ? 'right-0' : 'left-0'}`} ${isOpen ? 'visible translate-y-0 opacity-100' : 'invisible pointer-events-none -translate-y-1.5 opacity-0'}`}
              >
                <div className="relative flex flex-wrap items-center gap-0.5 px-2 pt-2" onKeyDown={rowKeys} onMouseLeave={() => { setHintKey(null); setPill((p) => ({ ...p, on: false })); }}>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-2 h-9 rounded-lg bg-primary-50 ring-1 ring-primary-100/70 transition-[left,width,opacity] duration-200 ease-out"
                    style={{ left: pill.left, width: pill.width, opacity: pill.on ? 1 : 0 }}
                  />
                  {children.map((child) => {
                    const ChildIcon = child.icon;
                    const current = value === key && activeChild === child.key;
                    return (
                      <button
                        key={child.key}
                        type="button"
                        role="menuitem"
                        tabIndex={isOpen ? 0 : -1}
                        aria-current={current ? 'page' : undefined}
                        onMouseEnter={(e) => { setHintKey(child.key); movePill(e.currentTarget); }}
                        onFocus={(e) => { setHintKey(child.key); movePill(e.currentTarget); }}
                        className={`relative z-10 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-none ${current ? 'text-primary-700' : 'text-tertiary-600 hover:text-primary-700 focus-visible:text-primary-700'}`}
                        onClick={() => { setOpenKey(null); onSelectChild(key, child.key); }}
                      >
                        {ChildIcon && <ChildIcon className="h-4 w-4 opacity-80" aria-hidden />}
                        {child.label}
                        {child.badge ? <span className="rounded-full bg-primary-100 px-1.5 text-[11px] font-semibold text-primary-700">{child.badge}</span> : null}
                        <span className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary-600 transition-opacity ${current ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 flex items-center gap-2 border-t border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5 text-xs text-tertiary-500">
                  <span className="font-semibold text-tertiary-700">{shown?.label || label}</span>
                  <span aria-hidden className="text-tertiary-300">·</span>
                  <span className="min-w-0 truncate">{shown?.description || blurb}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
