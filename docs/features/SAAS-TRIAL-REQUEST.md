# Website "Request a trial" -> lead in Delphic One

Part of the SaaS launch (phase 3). Branch `saas-launch-platform`, nothing deployed.

## What it does

A visitor fills a short form on the public website. A lead appears in **Delphic One > Leads** (source "website", stage "new", unassigned) with a note. Sales calls the visitor, moves the lead along, and uses **Convert to customer** and then **Create workspace** (trial of 15 days, 2 users, see `SAAS-LAUNCH-BUILD-PLAN.md`).

## Endpoint (public, no login)

`POST /api/v1/public/trial-request` (JSON)

| Field | Required | Notes |
|-------|----------|-------|
| `company_name` | yes | up to 150 characters |
| `contact_name` | yes | |
| `email` | yes | lower-cased; the same email asking again within 30 days adds a note to the open lead |
| `phone` | no | |
| `users_expected` | no | whole number |
| `message` | no | up to 1500 characters |
| `website` | no | honeypot. Keep it hidden on the page; a real visitor never fills it. A bot that does gets a success answer and no lead |

Answers: `201 { received: true }`, `404` when the form is closed, `422` for a bad field. Limited to 10 requests an hour per address outside tests.

## Closed by default

The form is shut until a platform admin opens it: **/platform > Settings > `trial_form_open`** (1 = open, 0 = closed). Every change is in the audit trail.

## The website side (stub, needs the website owner)

The public website is a separate project, so only the server side is built here. A minimal page snippet:

```html
<form id="trial">
  <input name="company_name" required placeholder="Company">
  <input name="contact_name" required placeholder="Your name">
  <input name="email" type="email" required placeholder="Work email">
  <input name="phone" placeholder="Phone">
  <input name="users_expected" type="number" min="1" placeholder="How many users?">
  <textarea name="message" placeholder="Anything we should know?"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button>Request a trial</button>
</form>
<script>
document.getElementById('trial').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const r = await fetch('https://one.delphic.in/api/v1/public/trial-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  alert(r.ok ? 'Thank you, we will contact you shortly.' : 'Sorry, requests are not open right now.');
});
</script>
```

Needs from the website owner: place the form, and the site's address must be allowed in the server's `CORS_ORIGIN` setting (a deploy setting, not changed here).
