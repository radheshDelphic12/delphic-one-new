# Delphic One as a SaaS product - launch plan

Status: PLAN ONLY (2026-11-09). Not started. Owner said it is not urgent; build properly for every customer when it is picked up.

## Vision
- Sell Delphic One to outside companies as a subscription product.
- Not all features to everyone: **bundles** priced per user per month (e.g. Project Management + Reports = one bundle).
- **Industry packs**: IT, Real Estate, Trading, Pharma, Mining, etc. - each gets the modules it needs.
- **Automated payroll** as a paid service: customer funds the payroll, Delphic pays salaries and charges a fee. Pitch: better than RazorpayX and others.
- **Add-ons**: door / access-card integration, camera integration with AI detection (threat, kiosk, intrusion).

## Open items from owner
- Point 3 of the add-on list was cut off in the first message - ask for it.

## Phases
0. **Security + tenant isolation audit** (before any outside customer)
   - Branch protection, 2FA, rotate secrets (see the 2026-10-21 / 2026-11-02 incidents).
   - Audit every query for cross-tenant leaks; add isolation tests; audit logs; backup/restore test; DPDP Act basics (privacy policy, consent, deletion).
1. **Tenant + bundles + billing**
   - Self-signup, onboarding wizard, per-tenant branding/domain. A customer company is a tenant (today "company" lives inside a group).
   - Tables: plans, bundles, modules, subscriptions. Every route and menu checks entitlement (extend the central route table in `routeRules.js`).
   - All of it admin-editable (bundle price, modules, trial).
   - Billing via Razorpay Subscriptions or Stripe, per active user, GST invoices.
   - Start with 2-3 bundles: Core HR + Attendance, Projects + Reports, Finance.
2. **Payroll as a service**
   - Money handling must go through a licensed partner (RazorpayX / Cashfree Payouts / bank API, virtual account per customer). Delphic must not pool customer funds without a PA licence - confirm with a CA/lawyer.
   - Automate PF, ESI, TDS, PT and challans. First ship calculation + bank file / partner payout, then the fee model.
3. **Industry packs** - preset module sets, terminology and templates per industry.
4. **Add-ons**
   - Access control: adapter pattern, start with one vendor (ZKTeco or eSSL), events feed attendance.
   - Cameras: per-site edge gateway (RTSP/ONVIF to cloud), live view + motion/person alerts first, AI detection later as a per-camera paid add-on. Target ONVIF cameras (EzyKam was unreadable in earlier exploration - see office-cctv exploration).
5. **Operations** - support/ticketing, status page, per-tenant backup, zero-downtime upgrades, customer docs, later ISO 27001 / SOC2.

## Biggest risks
- Cross-tenant data leaks (phase 0).
- RBI rules on holding payroll money (phase 2).
- Cost and hardware variety of camera AI (phase 4).
