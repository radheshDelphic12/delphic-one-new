# Careers page on delphic.in (rewrite to Delphic One)

For: the website team (delphic.in). Decision (Paras, Mamoon, 14-15 Oct 2026): candidates must see **delphic.in/career/...**, and
every application must reach Delphic One. Both are satisfied by a **rewrite (a proxy)**, not a redirect.

## What Delphic One provides

The careers pages are plain HTML served by the Delphic One API. Every link, stylesheet, script and the apply form target in them
is **relative**, so they work under any prefix.

| What | On Delphic One (works today) | On the website (after the rewrite) |
|---|---|---|
| Job list | `https://one.delphic.in/delphic/career/` | `https://delphic.in/career/` |
| One job + apply form | `https://one.delphic.in/delphic/career/<job-name>?src=linkedin` | `https://delphic.in/career/<job-name>?src=linkedin` |
| Apply form posts to | `.../delphic/career/<job-name>/apply` | `.../career/<job-name>/apply` |
| Stylesheet, script, logo | `.../delphic/career/assets/<file>` | `.../career/assets/<file>` |

The mapping is exactly: `delphic.in/career` + `X`  <->  `one.delphic.in/delphic/career` + `X` (the path after `/career`, and the
query string, are passed through unchanged).

## What the website must do

1. **Rewrite, do not redirect.** `/career` and `/career/*` must be served by fetching the same path from
   `https://one.delphic.in/delphic/career/...` and returning it with status 200. A 301/302 redirect would put
   `one.delphic.in` in the address bar, which is what we want to avoid.
2. Pass the **path after /career**, the **query string** and the **request method and body** unchanged. The apply form sends a POST as
   `multipart/form-data` and can carry a CV file of up to 1.5 MB, so the rewrite must allow request bodies of **at least 2 MB**
   (nginx: `client_max_body_size 2m;`) and must not buffer-limit or rewrite the body.
3. Send the visitor's address in `X-Forwarded-For` (the client IP first). Delphic One limits applications per visitor
   (20 per hour); without this header every candidate would look like the website server and would share one limit.
4. Do not cache the HTML (jobs open and close). The stylesheet / script / logo may be cached for a few minutes.
5. Remove the website's own `/career` page and its application form, and turn off the old career Apps Script form. After
   this nothing on the website accepts applications by itself.

Do **not** rewrite `/career` pages for anything else (blog, etc.): only `/career` and `/career/*`.

## Examples (use the one that matches the hosting)

nginx:
```
location = /career { return 301 /career/; }   # keep the trailing-slash rule on the website side too
location /career/ {
    proxy_pass https://one.delphic.in/delphic/career/;
    proxy_set_header Host one.delphic.in;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_ssl_server_name on;
    client_max_body_size 2m;   # CV attachment (up to 1.5 MB)
}
```
(Delphic One also redirects `/career` to `career/` by itself, so the first line is optional.)

Netlify (`_redirects`, status 200 makes it a rewrite):
```
/career        https://one.delphic.in/delphic/career/        200
/career/*      https://one.delphic.in/delphic/career/:splat  200
```
Netlify adds `X-Forwarded-For` automatically.

Vercel (`vercel.json`):
```
{ "rewrites": [
  { "source": "/career",       "destination": "https://one.delphic.in/delphic/career/" },
  { "source": "/career/:path*", "destination": "https://one.delphic.in/delphic/career/:path*" }
] }
```

Cloudflare: a Transform / Origin rule or Worker that fetches `https://one.delphic.in/delphic/career` + the path after `/career`.

## Checks after it is live

1. `https://delphic.in/career` shows the job list and the address bar stays on delphic.in/career/.
2. Click a job: address is `https://delphic.in/career/<job-name>`, the page is styled, the logo shows.
3. Submit a test application: the thank-you message shows, the address never contains `one.delphic.in` or `/delphic/`.
4. In Delphic One: Pipeline > Applicants shows the candidate with the screening answers and the source.

## Switching the "Copy link" button to the website address (Delphic One side)

Only after the checks above pass, set `PUBLIC_CAREERS_BASE=https://delphic.in/career` in the server environment
(`/opt/delphic/.env` on the production host, then `./start-delphic.sh --prod`). From then on "Copy link" in
Pipeline > In-progress jobs gives `https://delphic.in/career/<job-name>?src=linkedin`, and the pages carry a
`rel="canonical"` link to the website address. Until it is set, links use the Delphic One address and everything keeps working.

## Rollback

Remove the rewrite on the website. Delphic One keeps working on its own address. Unset `PUBLIC_CAREERS_BASE` to go back to
Delphic One links.
