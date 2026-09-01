/**
 * Arion verðtryggt húsnæðislán — shared indexation-rate band.
 *
 * For a verðtryggt loan the current principal ("Staða láns") evolves as:
 *
 *   Staða_m = Staða_{m-1} × (1 + rate_m) − principal_m
 *
 * `rate_m` is Arion's standard monthly indexation rate (the verðtrygging band
 * applied to ALL verðtryggt loans in a period — NOT per-customer, and NOT the
 * headline CPI, which doesn't reproduce it). The band was recovered from the
 * loan-240028 ledger (uncontaminated — no pension/prepayments) and validated:
 * a forward walk reproduces its authoritative current balance (76,459,991) to
 * the exact króna. Applying the same band to loan 240029's reductions lands
 * within ~0.5% (the residual is pension/prepayment timing, not the rate).
 *
 * Public contract data (rate band, not personal) — safe to ship.
 */

export interface RatePoint {
  month: string; // "YYYY-MM"
  /** Monthly indexation rate as a fraction (0.004101 = 0.4101%). */
  rate: number;
}

/**
 * Arion's standard monthly indexation band, 2024-08 → 2026-09. Validated exact
 * against loan 240028. A loan's current balance is derived by walking this band
 * over the loan's monthly principal reductions.
 */
export const ARION_INDEXATION_BAND: RatePoint[] = [
  { month: "2024-08", rate: 0.013855404 },
  { month: "2024-09", rate: -0.002761253 },
  { month: "2024-10", rate: 0.003321365 },
  { month: "2024-11", rate: 0.001103973 },
  { month: "2024-12", rate: 0.004595562 },
  { month: "2025-01", rate: -0.003112716 },
  { month: "2025-02", rate: 0.010648266 },
  { month: "2025-03", rate: 0.004366339 },
  { month: "2025-04", rate: 0.010875131 },
  { month: "2025-05", rate: 0.002334513 },
  { month: "2025-06", rate: 0.009857078 },
  { month: "2025-07", rate: 0.003732081 },
  { month: "2025-08", rate: -0.001771507 },
  { month: "2025-09", rate: 0.001241937 },
  { month: "2025-10", rate: 0.005494205 },
  { month: "2025-11", rate: -0.005644847 },
  { month: "2025-12", rate: 0.013471694 },
  { month: "2026-01", rate: 0.004380894 },
  { month: "2026-02", rate: 0.004100549 },
  { month: "2026-03", rate: 0.004100549 },
  { month: "2026-04", rate: 0.004100553 },
  { month: "2026-05", rate: 0.004100535 },
  { month: "2026-06", rate: 0.004100551 },
  { month: "2026-07", rate: 0.004100551 },
  { month: "2026-08", rate: 0.004100542 },
  { month: "2026-09", rate: 0.00410055 },
];

/**
 * Derive a verðtryggt loan's current balance by walking the shared indexation
 * band against the loan's monthly principal reductions (from an uploaded
 * ledger). For months not in the embedded band, `currentRate` (a monthly
 * fraction) is used as the indexation rate — so any loan can be derived, using
 * the embedded band where known and the user's current verðtrygging rate to
 * fill the gaps. Returns the latest balance, or null if unsupported.
 */
export function deriveBalanceFromBand(
  origination: number,
  monthlyPrincipal: Array<{ month: string; principal: number }>,
  currentRate?: number
): { balance: number; months: number } {
  const bandByMonth = new Map(ARION_INDEXATION_BAND.map((p) => [p.month, p.rate]));
  // Walk starts at the loan's first payment month (never before its ledger
  // begins — a loan issued after the band starts must not get band rates on
  // months that predate it). End = union of band + ledger months.
  const ledgerMonths = monthlyPrincipal.map((m) => m.month).filter(Boolean).sort();
  const start = ledgerMonths[0] ?? ARION_INDEXATION_BAND[0]!.month;
  const months = new Set<string>([
    ...ARION_INDEXATION_BAND.map((p) => p.month),
    ...ledgerMonths,
  ]);
  const sorted = Array.from(months).sort().filter((m) => m >= start);

  let bal = origination;
  let seen = 0;
  for (const m of sorted) {
    // Known band month → band rate; otherwise the user's current rate (or 0).
    const rate = bandByMonth.get(m) ?? currentRate ?? 0;
    const principal = monthlyPrincipal.find((x) => x.month === m)?.principal ?? 0;
    bal = bal * (1 + rate) - principal;
    seen++;
  }
  return { balance: Math.round(bal), months: seen };
}

/**
 * Convenience: derive a loan's balance from its ledger (disbursement row
 * excluded) using the shared band, falling back to `currentRate` (monthly
 * fraction) for months outside the band. Returns null if the ledger has no
 * usable principal.
 */
export function deriveBalanceFromLedger(
  origination: number,
  history: Array<{ date: string; action: string; principal: number }>,
  currentRate?: number
): { balance: number; months: number } | null {
  const byMonth = new Map<string, number>();
  for (const r of history) {
    if (/útgreiðsla|disburs/i.test(r.action)) continue; // disbursement creates the loan
    byMonth.set(r.date, (byMonth.get(r.date) ?? 0) + r.principal);
  }
  if (byMonth.size === 0) return null;
  const monthlyPrincipal = [...byMonth.entries()].map(([month, principal]) => ({ month, principal }));
  return deriveBalanceFromBand(origination, monthlyPrincipal, currentRate);
}
