# Seeding the Gulati Industries admin login (staging / production)

`server/prisma/gulati/seed-admin.js` is **non-destructive**: it creates only what is missing (the `gulati` org with its own holding group, one admin login, the org membership and the default Gulati settings). It never deletes or overwrites anything and loads no demo data. It stops before creating anything if the Gulati tables are not on the database yet (run `prisma migrate deploy` first). The admin creates the other users, roles and masters from the app. Local demo data is a different script (`npm run gulati:seed`, which refuses non-local databases on purpose).

Default login: `admin@gulatiindustries.in` / `Gulati@2026!` (change it after the first sign-in). Override with `GULATI_ADMIN_EMAIL`, `GULATI_ADMIN_PASSWORD`, `GULATI_ADMIN_NAME`; an existing user keeps their password unless `GULATI_ADMIN_RESET_PASSWORD=1`.

## Where the app runs

- **Render staging:** run the script from a machine that has the Neon `DATABASE_URL` (`cd server`, set `DATABASE_URL`, `node prisma/gulati/seed-admin.js`). Treat the URL as a secret; never write it into a file.
- **Production Docker host:** the app lives only inside the `delphic-server-1` container (`/app/server`), so there is no node on the host.

```bash
sudo -i
C=delphic-server-1
docker exec -w /app/server $C npx prisma migrate status   # must say "up to date"
# copy server/prisma/gulati/seed-admin.js to /root/gulati-admin-tmp.js, then:
docker cp /root/gulati-admin-tmp.js $C:/app/server/gulati-admin-tmp.js
docker exec -w /app/server $C node gulati-admin-tmp.js    # + org, + admin user, + membership, DONE
docker exec $C rm /app/server/gulati-admin-tmp.js && rm /root/gulati-admin-tmp.js
curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@gulatiindustries.in","password":"<password>"}' | head -c 120   # "success":true
```

If the script prints "Gulati tables missing", the container image is older than the Gulati migrations: rebuild the server image from `main` and run `prisma migrate deploy`, then run the script again.
