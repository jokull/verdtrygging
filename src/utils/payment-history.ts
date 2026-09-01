/**
 * Shared Arion "LoanPayments" .xlsx parser + loan-history helpers.
 *
 * A full export is a complete ledger from the loan's disbursement (a
 * `Útgreiðsla` row carrying the origination principal) through the present.
 * Used by both the loan-card attach flow and the chart's history rendering.
 */
import * as XLSX from "xlsx";
import type { UploadedRow } from "../types";

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}

function addMonthKey(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface ParsedHistory {
  loanId: number; // Lánsnúmer
  rows: UploadedRow[]; // all payment events (incl. the Útgreiðsla disbursement)
  originationPrincipal: number; // abs of the Útgreiðsla höfuðstóll
  originationMonth: string; // "YYYY-MM" of the disbursement row
}

/** Parse one LoanPayments .xlsx (a buffer) into a normalized history. */
export async function parseLoanPayments(file: File): Promise<ParsedHistory> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[];
  const rows = raw
    .slice(1)
    .map((r) => r as Array<string | number | Date | null>)
    .filter((r) => r && r[0] != null && r[2] instanceof Date)
    .map((r) => ({
      loanId: Number(r[0]),
      action: String(r[1] ?? ""),
      date: monthKey(r[2] as Date),
      principal: Number(r[4] ?? 0),
      indexation: Number(r[6] ?? 0),
      total: Number(r[12] ?? 0),
    }));

  const loanId = rows.length ? rows[0]!.loanId : 0;
  const disb = rows.find((r) => /útgreiðsla|disburs/i.test(r.action));
  const originationPrincipal = disb ? Math.abs(disb.principal) : 0;
  const originationMonth = disb ? disb.date : rows.length ? rows[0]!.date : "";

  return { loanId, rows, originationPrincipal, originationMonth };
}

/**
 * Aggregate principal + indexation per month, EXCLUDING the Útgreiðsla
 * (disbursement) row — it carries negative principal (the payout) and creates
 * the loan rather than repaying it. Counting it as a payment would collapse the
 * reconstructed balance.
 */
export function aggregateByMonth(rows: UploadedRow[]): Map<string, { principal: number; indexation: number }> {
  const byMonth = new Map<string, { principal: number; indexation: number }>();
  for (const r of rows) {
    if (/útgreiðsla|disburs/i.test(r.action)) continue;
    const cur = byMonth.get(r.date) ?? { principal: 0, indexation: 0 };
    cur.principal += r.principal;
    cur.indexation += r.indexation;
    byMonth.set(r.date, cur);
  }
  return byMonth;
}

/**
 * Reconstruct a loan's debt-over-time going backward from `currentBalance`.
 * balance_before = balance_after − indexation + principal, with
 * balance_after[last] = currentBalance as the anchor.
 */
export function reconstructDebtMap(rows: UploadedRow[], currentBalance: number): Map<string, number> {
  const byMonth = aggregateByMonth(rows);
  const months = [...byMonth.keys()].sort();
  const map = new Map<string, number>();
  if (months.length === 0) return map;
  let after = currentBalance;
  for (let i = months.length - 1; i >= 0; i--) {
    const m = months[i]!;
    const { principal, indexation } = byMonth.get(m)!;
    map.set(m, after);
    after = after - indexation + principal;
  }
  return map;
}

/** Months between a month and the latest data month (for freshness hints). */
export function monthsSince(fromMonth: string, toMonth: string): number {
  return monthDiff(fromMonth, toMonth);
}

export { monthDiff, addMonthKey };
