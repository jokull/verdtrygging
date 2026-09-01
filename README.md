# Verðtrygging — eigið fé reiknivél

A client-side Vite + React SPA for tracking how your **equity** in an
index-linked (verðtryggt) mortgage develops over time. Extracted from the
`home` monorepo calculator and made standalone + anonymized.

## Stack

- **Vite 7 + React 19 + TypeScript** (strict)
- **Tailwind CSS v4** (`@tailwindcss/vite`)
- **TanStack Charts** (`@tanstack/charts` + `@tanstack/react-charts`) for the
  debt/equity area chart
- **SheetJS (`xlsx`)** — parses the uploaded Arion "LoanPayments" export
  entirely in the browser
- **d3-scale** — time/linear scales for the chart

No backend, no server, no telemetry. The workbook never leaves the browser.

## How it works

1. **Blank until upload.** The chart section shows a prompt ("Want to view how
   your equity has developed? Upload payment history — no data is shared or
   uploaded, it stays in your browser") until the user uploads an `.xlsx`.
2. **Uploads stack by loan.** Every distinct `Lánsnúmer` (loanId) across all
   uploaded files becomes its own loan series. Re-uploading the same rows does
   not double-count (dedupe by date + principal + indexation).
3. **Debt is reconstructed backward.** For each loan series the user enters its
   current balance ("staða í dag"); the monthly debt curve is walked backward
   from there using each month's höfuðstóll (principal) and verðbætur
   (indexation) — `balance_before = balance_after − indexation + principal`.
4. **Property grows from a purchase price** at a user-set annual rate; equity =
   property − total debt.
5. **`today` is the real current date** — the "today" marker, the chart's right
   edge, and the loan defaults (startMonth, base-rate years) all derive from
   `new Date()`, not a baked-in snapshot.

### Data privacy

- No personal data is committed. The repo ships only anonymized default loans
  (68.25M / 9.4M) — "like my loan but not exactly like it."
- The chart has **no baked-in data**: everything it plots comes from the
  uploaded workbook + user inputs.
- Historical CPI lives in `src/cpi.ts` (public Hagstofa data), used only for the
  optional "raunvirði" (real-terms) deflation toggle.

## Development

```sh
bun install
bun run dev       # http://localhost:5173
bun run build     # tsc -b && vite build → dist/
bun run preview   # serve the production build
```

## Deploy

Static SPA — `dist/` is a self-contained bundle. Deploy by copying the build
output to any static host:

```sh
bun run build
# copy dist/ to a static server / CDN / wrangler pages
```

The original `home` deployment serves `calculator/dist` behind Caddy on the
mac-mini (`lanareiknivel.solberg.club`). This repo is standalone; point it at
whatever static host you like and serve `dist/` as the root.
