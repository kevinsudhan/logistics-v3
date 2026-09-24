> **Stale, kept for history.** Written 28 August, when v2 ran on an in-memory mock.
> v2 now has its own Supabase project and backend. Read `HANDOFF.md` instead.

# v2 workspace

A clone of the production CRM, for redesigning it without touching the one in use.

## The rule

**v1 (`../araxys-crm`) is the working system. v2 must never affect it.**

v1 shares a Supabase project and a SnapServe account with the live voice agents.
A record promoted, a container restowed, or space booked against a real sailing
changes what Priya tells a real caller on the next call. So v2 has no backend.

## How that is enforced

`src/services/backend.ts` routes every request to the in-memory mock in
`src/services/mockBackend.ts`. The default is mock; reaching a real API takes a
deliberate act — `VITE_MOCK_BACKEND=off` *and* a `VITE_API_BASE`.

The default runs that way round on purpose. Real-unless-told-otherwise would
mean one missing env file silently writes to production, which is the exact
accident this workspace exists to prevent.

There is also no `snapserve-setup/.env` here, so the scripts that PATCH live
agent prompts cannot run from this folder even by accident.

## Running both at once

    v1   cd ../araxys-crm     && npm run dev    # :5173, live Supabase
    v2   npm run dev                            # :5174, in-memory

Different ports, so both stay up side by side.

## The mock

Answers all nine endpoints and mutates on write, so the UI behaves like the real
thing: book space and the container fills, restow and the plan moves, promote a
record and it changes stage. It rejects the same things the real backend rejects
— overlapping stows, cargo that will not fit, promoting without a sailing date.

State lives for the life of the page. Reload to reset to the seed.

The seed numbers are internally consistent: floor lengths agree with the
placements, remaining space agrees with what is loaded, weights agree with piece
counts. Change one, change the others.

## Branch

Work happens on `v2`. `main` is v1's branch — do not merge into it without
deciding what should happen to the mock, which must not reach production.
