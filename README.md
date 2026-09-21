# RaktSetu

A live blood-donor network that connects willing blood donors with urgent blood requests.

**Core principle:** the person who actually needs the blood never has to operate the application. Friends, family, volunteers, and hospital staff do the work — the patient just receives help.

## Tech stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Supabase (authentication + PostgreSQL with Row Level Security)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run lint` — lint

## Project structure

```
src/
  app/            # App Router routes
  components/     # Reusable UI (buttons, cards, forms, states, layout)
  lib/            # Supabase clients, validation, utilities
  types/          # Shared TypeScript types
```

## Security notes

- Only Supabase **anon** keys are used in the frontend; the service-role key never appears in this codebase.
- Environment variables are validated at startup via `src/lib/env.ts`.
- All Supabase tables will be protected by Row Level Security policies.
- RaktSetu never makes medical eligibility decisions — final donor screening always rests with authorized blood bank / medical professionals.
