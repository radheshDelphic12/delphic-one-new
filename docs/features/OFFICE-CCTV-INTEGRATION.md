# Office CCTV (live cameras on Offices) - exploration, not built

Explored 2026-11-02 at the owner's request: "integrate live cameras from the office (EzyKam web playback, https://web.ezykam.com/playback)
under Offices (one.delphic.in/offices)". **Nothing is implemented.** This records what was found and the options.

## What exists today
- `client/src/pages/offices/OfficesPage.jsx`: one card per office (`Location`: name, city, country, address, is_default) with a headcount and
  a **CCTV row** ("n cameras connected" / "Not connected") and a biometric row. Both are placeholders: the server hardcodes
  `cctv: { status: 'not_connected', cameras: 0 }` in `server/src/modules/orgs/orgs.service.js` (office overview).
- The Offices page is visible only to group super admins (`navItems.js`: `groupSuperadminOnly`). Locations are managed in Settings
  (`/orgs/locations`, permission `hr_settings.update` to write, `basic.offices` to read).
- No camera table or field exists. `OfficeGeofence` / `LocationCheckinSetting` belong to the location check-in feature, not CCTV.

## What is known about EzyKam (unverified)
- EzyKam / EzyKam+ is a **CP PLUS** app (Aditya Infotech). App-store text: live preview, push video, PTZ, remote configuration,
  multi-stream, two-way talk, playback.
- The portal page `web.ezykam.com/playback` **could not be read** from this environment (DNS failure from the fetch tool, and web search found
  no documentation). So whether it needs a login, allows iframe embedding, or has an API / share links is **unknown**.
- RTSP / ONVIF support depends on the camera model (many CP PLUS models support ONVIF, URLs are model-specific); nothing confirms it for
  EzyKam cloud cameras.

## Options (simplest first)
1. **Link-out** - per office: camera name(s) + a "Watch live" button that opens the EzyKam web portal in a new tab; staff use their own
   EzyKam login. ~half a day. Credentials stay in EzyKam. No video inside Delphic One.
2. **Iframe embed** of the portal in the card. Only if EzyKam allows framing (many portals send `X-Frame-Options` / `frame-ancestors`);
   viewers would probably still need an EzyKam login. Needs a quick test.
3. **Official API / share links** from CP PLUS: list cameras per office and show streams or snapshots inside Delphic One, with offline
   status on the card. Blocked on a written answer from CP PLUS / Aditya support.
4. **Direct stream (RTSP / ONVIF)** through a small gateway (go2rtc / MediaMTX) on a server in the office network or the VPS, shown in the
   browser (WebRTC / HLS). Most work; needs camera support and network access.

Recommendation: ship option 1 first, upgrade to 3 or 4 once the answers below are in.

## Needed before building
1. Are the cameras cloud cameras (EzyKam app / portal only) or on an NVR / DVR at each office? Camera / NVR model names.
2. Written answer from CP PLUS / Aditya support: API, share links, embedding, RTSP / ONVIF for these models.
3. Who may watch (suggest group super admins + named admins), a view log (who / when / which camera), and the employee notice where
   cameras record (privacy).

## Design notes for when it is built
- Table `office_cameras` (org_id, location_id, name, provider, view_url, sort_order, is_active, created_by) - admin-editable (see
  ADMIN-EDITABILITY checklist); replace the hardcoded `cctv` object with the real count; permission-gated and audited.
- Never store camera logins in plain text (encrypt, or keep them only in EzyKam).
- Optional later: online / offline status and an alert on the card.
