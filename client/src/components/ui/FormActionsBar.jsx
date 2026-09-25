import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { DrawerActionsContext } from './Drawer.jsx';

/**
 * The form's primary CTA(s). Inside a Drawer it portals into the header's action
 * slot so Save sits on the same line as the ✕ (which is the cancel action — no
 * separate Cancel button). Outside a Drawer it falls back to a sticky top bar.
 *
 * Pass the Save/submit button(s) as children. Because it may be portaled out of
 * the <form>, a submit button must be associated by `form="<form id>"`.
 */
export default function FormActionsBar({ children, className = '' }) {
  const slot = useContext(DrawerActionsContext);

  if (slot) {
    return createPortal(children, slot);
  }

  return (
    <div
      className={`sticky -top-4 z-20 -mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-end gap-2 border-b border-tertiary-100 bg-white/95 px-4 py-3 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}
