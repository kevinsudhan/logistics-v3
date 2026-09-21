# Local keys

Every script that reaches v2's Supabase project reads its credential from
`.keys.json` here. Nothing reads v1's environment file any more — see the
header of `supabase-v2/token.mjs` for why that mattered.

```json
{
  "access_token": "sbp_…",
  "service_role": "eyJ…",
  "anon": "eyJ…",
  "db_password": "…"
}
```

**`access_token`** is all you need for the documented path. `run-sql.mjs`,
`deploy-function.mjs` and `seed-showcase.mjs` go through the Management API and
read nothing else. Generate one at
<https://supabase.com/dashboard/account/tokens>. Note that it is issued against
your **account**, so it can reach v1 as well — what keeps it off v1 is the
`PROJECT` constant in `supabase-v2/token.mjs`.

**`service_role`, `anon`, `db_password`** are needed only by the older seeds —
`seed-sailings`, `seed-users`, `seed-partners`, `seed-demo-enquiry` and
`seed-kevin-enquiry` — which talk to the project's REST and Auth endpoints
directly. Both keys are on the Supabase dashboard under Project Settings → API
for project `izgbrdeybhbepftloxgk`.

The file is gitignored and must stay that way: `service_role` bypasses RLS
entirely.

`.project.json` holds only the project ref, which is not a secret — it is the
same value as `PROJECT` in `supabase-v2/token.mjs`.
