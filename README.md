# LendLoop

A neighborhood tool-lending board. Neighbors list tools, request to borrow them for a date range, and get automated notifications and overdue reminders through n8n.

**Stack:** Next.js (App Router, TypeScript) · Clerk (auth) · Convex (data + backend logic) · n8n (workflow automation, Docker).

## Architecture

```
Browser (Next.js) --Clerk JWT--> Convex functions (queries / mutations)
                                     |  signed POST (HMAC)            ^ signed GET/POST (HMAC)
                                     v                                |
                                  n8n: Request notification     n8n: Overdue reminders (daily)
                                  n8n: Error workflow
```

- **Public page** shows tool name + category only (`tools.listPublic`, no auth, no owner data).
- **Signed-in users** list tools, request dates, approve/decline requests on their own tools, and mark loans returned. Views: All tools (filter by category), My listings, My requests, Incoming requests.
- **Admins** can remove any listing, view all loans and mark a lender "Trusted Lender".

## Setup

1. `npm install`
2. Create a Clerk app, activate its **Convex** integration, and add `email` and `name` claims to the session token (Sessions > Customize session token).
3. `npx convex dev`, then set in the Convex dashboard: `CLERK_JWT_ISSUER_DOMAIN`, `ADMIN_EMAILS`, `LENDLOOP_WEBHOOK_SECRET`, `N8N_WEBHOOK_URL`.
4. Put the Convex URL and Clerk keys in `.env.local` (see `.env.example`).
5. `npm run dev:web` and open http://localhost:3000.
6. n8n: copy `.env.n8n.example` to `.env.n8n`, fill it in, run `docker compose up -d`, open http://localhost:5678, and import the three files in `n8n/`. Set the error workflow in the settings of the other two, then activate them. Convex (cloud) must reach n8n, so expose it with a tunnel (e.g. ngrok) and use `https://<tunnel>/webhook/lendloop-request` as `N8N_WEBHOOK_URL`.

## Security decisions

- **Authorization is enforced in Convex functions**, not only the UI. Every function derives the caller from the verified Clerk token; no function takes a user id or role from the client.
- **Roles are server-decided.** A user's role is set on first sign-in from the `ADMIN_EMAILS` env var and cannot be changed by clients.
- **Ownership checks:** edit/delete a listing and approve/decline/return a loan require being that tool's owner (admins may remove listings and mark returns).
- **Input validation:** length limits on listing fields, strict date validation, no self-borrowing, no overlap with approved loans.
- **Webhooks signed in both directions** with HMAC-SHA256 over `timestamp.method.path.body`. Signatures are compared in constant time and requests older than 5 minutes are rejected (replay protection).
- **Secrets** live in Convex env vars, `.env.local` and `.env.n8n`; all are gitignored. Workflow JSON contains no secrets (they are read from `$env`).
- **Idempotent write-backs:** reminder results are keyed `reminder:<loan>:<date>`; retries cannot create duplicates or double-count reminders.
- **Failures are visible:** Convex retries notifications with backoff and records a `failed` event; n8n HTTP nodes retry and an error workflow logs failures.

## Data minimization

- The public page exposes tool name and category only.
- n8n receives only event, tool name, dates, status and the recipient's name and email: no ids of other users, no descriptions, no owner details beyond the recipient.
- The overdue endpoint returns only what a reminder needs.

## n8n workflows (`n8n/`)

- `request-notification.json`: Convex calls this webhook when a request is created or changes status; it verifies the signature, then notifies the right person (a logged mock notification; swap in an Email/Slack node).
- `overdue-reminders.json`: runs daily, fetches overdue loans, sends reminders and writes status back.
- `error-workflow.json`: logs any failed run.

## What I would change for production

- Verify signatures on the **raw** request body (the webhook currently re-serializes the parsed JSON, which is fine for these flat payloads but fragile).
- Real delivery channel (email/SMS), unsubscribe handling, and rate limiting on mutations.
- Pin the n8n image, run it behind HTTPS with auth, and keep workflow JSON in CI.
- Rotate the webhook secret on a schedule and store it in a secrets manager; add audit logging and alerts on failed automations.
- Add automated tests for the authorization rules and the overdue/idempotency logic.
