# Email (SMTP) in production

**Symptom:** *Requirements → Email to vendors* (and interview invites, and every other queued mail) works on a developer
machine but nothing leaves in production.

**Cause:** SMTP is read only from environment variables. They were set in the developer's local `server/.env`, and the
production container never received them: `docker-compose.yml` did not pass them through, so on the server they were
unset and every queued mail was marked `skipped` (this is the designed behaviour when SMTP is missing).

No credentials live in the repository. Set them on the host that runs Docker (the `.env` next to `docker-compose.yml`,
git-ignored) or, on Render, in the service's *Environment* tab. `docker-compose.yml` now passes the variables below into
the `server` container.

## Variables

Use **either** option A **or** option B (A wins if both are set).

| Variable | Meaning | Example |
|---|---|---|
| `NOTIFICATIONS_EMAIL_FROM` | From address of every mail (**required** in production) | `Delphic One <noreply.secure@delphic.in>` |
| **A** `NOTIFICATIONS_SMTP_URL` | One URL with host, port, TLS, user and password | `smtps://noreply.secure%40delphic.in:APP_PASSWORD@smtp.example.com:465` |
| **B** `NOTIFICATIONS_SMTP_HOST` | SMTP server | `smtp.example.com` |
| **B** `NOTIFICATIONS_SMTP_PORT` | Port (default `587`) | `465` or `587` |
| **B** `NOTIFICATIONS_SMTP_SECURE` | `true` = implicit TLS (port 465). `false` = start plain and upgrade with STARTTLS (587 / 25). Left empty it follows the port: 465 → `true`, anything else → `false` | `true` |
| **B** `NOTIFICATIONS_SMTP_USER` | Login (the mailbox) | `noreply.secure@delphic.in` |
| **B** `NOTIFICATIONS_SMTP_PASS` | Password / app password | *(secret)* |

* **Reference sender:** `noreply.secure@delphic.in`, the mailbox the Delphic Secure product already sends from. Reuse the
  same host, port, TLS mode and credentials that product uses (copy them from its configuration; this repository does not
  contain them). If you prefer a dedicated mailbox for Delphic One, use that mailbox's values instead.
* Option B is easier when the password contains characters such as `@`, `/`, `#` or `%` (in a URL they must be percent-encoded).
* Most providers need the `From` address to be the authenticated mailbox or an alias of it, otherwise they reject or rewrite the mail.
* After changing the `.env` on the box, recreate the server container so it picks the values up:
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d server` (a restart alone does not re-read `.env`).

## How it behaves

1. *Send* on Email to vendors queues one row per vendor in `email_outbox` and writes the log entry (who, subject, recipients,
   and the vendors skipped because they have no contact email). Nothing is sent inside the request.
2. A job drains the queue **every minute** (`jobs/emailOutbox.js`).
   * SMTP configured → status `sent` (with `sent_at`), or `failed` with `last_error` (retried up to 5 times).
   * SMTP **not** configured → status `skipped`, `last_error = smtp_not_configured`. The send history shows the recipient as
     skipped, so it is obvious nothing left the building.
3. The send history on the Email to vendors page shows the live status of each recipient (`queued`, `sent`, `failed`, `skipped`).

## Check it on the server

```sh
# 1. is SMTP configured inside the running container? (prints true / false, never the password)
docker compose exec server node -e "const e=require('./src/config/env');console.log('smtp configured:',Boolean(e.notifications.email.smtp),'from:',e.notifications.email.from)"

# 2. send one real vendor email from the UI, wait a minute, then look at the outbox
docker compose exec db psql -U postgres -d requirement_dashboard -c "select status,to_email,last_error,sent_at from email_outbox order by created_at desc limit 5;"
```

`sent` = delivered to the SMTP server. `failed` + `last_error` (e.g. `Invalid login`, `self signed certificate`, a wrong
port/TLS pairing) tells you what to fix; the row is retried automatically after you correct the variables and recreate the container.
`skipped` + `smtp_not_configured` = the variables did not reach the container.

Rows already marked `skipped` are **not** re-sent after SMTP is fixed; send those vendor emails again from the UI.
