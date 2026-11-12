# Per-tab company session (super admin, different company in each tab)

Built 2026-10-30. Live on staging and production. Client only: no server change, no migration.

## Problem
The login tokens (`access_token`, `refresh_token`, `active_org_id`) lived in `localStorage`, shared by every tab. A company switch writes
new company-bound tokens, so the last switch won in every tab; a stale token / refresh in the other tab then showed the wrong company or
logged the tab out ("session expired").

## Design
- `client/src/lib/sessionStore.js`: tokens + active company live in **`sessionStorage`** (per tab). `localStorage` keeps a **shared copy**
  only to start a new tab (the tab adopts it when it has no session of its own) and to sign every tab out together.
- `getSessionItem` / `setSessionItem` / `clearSession` / `onSessionCleared`; falls back to `localStorage` if `sessionStorage` is blocked.
- `authContext.jsx` and `apiClient.js` read and write only through this module. A `storage` event listener signs a tab out when another tab
  signs out.
- Server: tokens were already per company (`switch-org` issues them) and the refresh token is a stateless JWT (no rotation), so tabs can
  refresh independently.

## Behaviour
- A new tab opens already signed in, in the company of the latest session (the shared copy), and a switch there does not touch other tabs.
- Reload keeps the tab's own company. Sign out in one tab signs out all tabs. Closing the browser clears `sessionStorage`; the shared copy
  restores the session on the next open.

## Verified
Playwright on staging (`pw/verify-tabs.js`): two tabs on Delphic Global and Gulati Industries, independent refresh / reload, UI shows each
tab's company, sign-out syncs. All pass. (The switch there was simulated by writing the tokens, the same values the app's switch writes.)

## Known limits
- A new tab starts in whichever company was switched most recently.
- Other `localStorage` keys (sidebar state, calendar view, etc.) are still shared by design.
