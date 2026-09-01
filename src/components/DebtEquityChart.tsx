/**
 * Debt & equity over time — a derived view over the calculator's loans.
 *
 * Each loan is modelled from its manual terms (balance, apr, remainingMonths,
 * method — the same fields the Schedule table uses) and projected forward with
 * `computeLoanSchedule`. If a loan also carries an uploaded Arion payment
 * history (`loan.history`), the real past is overlaid: the debt curve is
 * reconstructed backward from the loan's balance, and real prepayments /
 * séreignarsparnaður show as dots. The two join at the real current date.
 *
 * Property value is indexed by a real HMS series (buyer picks property type +
 * region), anchored so purchasePrice is the value at the chart's first month.
 * The "today" marker and loan defaults derive from `new Date()`.
 */
import { useMemo, useState } from "react";
import { defineChart, areaY, ruleX, dot, lineY, type ChartCurve } from "@tanstack/charts";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleTime } from "d3-scale";
import { Chart } from "@tanstack/react-charts/tooltip";
import { computeLoanSchedule } from "../calc";
import { buildCPISeries } from "../cpi";
import type { LoanInput, Assumptions, UploadedRow } from "../types";
import {
  HMS_OPTIONS,
  hmsIndexForMonth,
  hmsAgeMonths,
  hmsSeries,
} from "../data/hms";
import { reconstructDebtMap, monthKey, monthDiff, addMonthKey } from "../utils/payment-history";

interface Row {
  month: Date;
  debt: number;
  equity: number;
  property: number;
  historic: boolean; // true = backed by a real uploaded payment ledger
}

interface ExtraDot {
  date: Date;
  y: number;
  kind: "prepayment" | "pension";
  amount: number;
  loanId: number;
}

// The CPI path for projection (4.3 → 2.5%), anchored to the current year.
const CPI_SCENARIO = (() => {
  const y = new Date().getFullYear();
  return {
    label: "Grunn",
    rateBrackets: [
      { startYear: y, years: 2, rate: 4.3 },
      { startYear: y + 2, years: 23, rate: 2.5 },
    ],
  };
})();

const fmtM = (v: number) => `${Math.round(v / 1e6)}M`;

function fmtISK(v: number): string {
  return `${Math.round(v).toLocaleString("is-IS")} kr.`;
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let m = from;
  let guard = 0;
  while (m <= to && guard < 600) {
    out.push(m);
    m = addMonthKey(m, 1);
    guard++;
  }
  return out;
}

/** Classify a payment row as an extra (dot) vs a scheduled installment. */
function isExtra(action: string): "pension" | "prepayment" | null {
  const a = action.toLowerCase();
  if (a.includes("séreign") || a.includes("eignar")) return "pension";
  if (a.includes("innborgun") || a.includes("auka") || a.includes("frjáls")) return "prepayment";
  return null;
}

/**
 * Step-after curve: the balance holds its value until the payment month, then
 * jumps — principal installments render as right-angle dents, not slopes.
 */
const stepCurve: ChartCurve = {
  line: (pts) => {
    if (pts.length === 0) return "";
    let d = `M${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 1; i < pts.length; i++) d += `H${pts[i]![0]}V${pts[i]![1]}`;
    return d;
  },
  area: (top, bottom) => {
    if (top.length === 0) return "";
    let d = `M${top[0]![0]},${top[0]![1]}`;
    for (let i = 1; i < top.length; i++) d += `H${top[i]![0]}V${top[i]![1]}`;
    d += `L${bottom[bottom.length - 1]![0]},${bottom[bottom.length - 1]![1]}`;
    for (let i = bottom.length - 2; i >= 0; i--) d += `H${bottom[i]![0]}V${bottom[i]![1]}`;
    return `${d}Z`;
  },
};

interface Props {
  loans: LoanInput[];
  assumptions: Assumptions;
  /** Re-parse an uploaded workbook into a loan's history (from the loan card). */
  onAttachHistory?: (loanId: string, rows: UploadedRow[]) => void;
}

export function DebtEquityChart({ loans, assumptions }: Props) {
  // Anonymized default — high enough that equity (property − debt) is positive
  // with the ~77M anonymized loan totals.
  const [purchasePrice, setPurchasePrice] = useState(125_000_000);
  const [hmsKey, setHmsKey] = useState("fjolbyliCap");
  const [real, setReal] = useState(false);
  const [showPension, setShowPension] = useState(false);

  const today = new Date();
  const todayKey = monthKey(today);

  // Build the monthly rows: past from each loan's history (if any), future from
  // each loan's terms, joined at the real current date.
  const { rows, debtByMonth } = useMemo(() => {
    if (loans.length === 0) {
      return {
        rows: [] as Row[],
        debtByMonth: new Map<string, number>(),
      };
    }

    // Determine the span: earliest history start (or purchase) → today → horizon.
    const historyStarts = loans
      .filter((l) => l.history && l.history.length > 0)
      .map((l) => l.history!.map((r) => r.date).sort()[0]!);
    const earliestHistory = historyStarts.length ? historyStarts.sort()[0]! : todayKey;

    // Projection: the base ("Grunn") scenario, matching the Schedule table.
    const numMonths = Math.ceil(
      Math.max(...loans.map((l) => l.remainingMonths)) * 1.5
    );
    const startMonth = assumptions.startMonth;
    const cpiSeries = buildCPISeries(startMonth, numMonths, CPI_SCENARIO);

    const futureMonths = monthRange(startMonth, addMonthKey(startMonth, numMonths - 1));
    const months = monthRange(earliestHistory, addMonthKey(startMonth, numMonths - 1));

    const debtBy = new Map<string, number>();
    const historicSet = new Set<string>();
    // History (optional): reconstruct backward from the loan's balance over
    // the months it has a real payment ledger for.
    for (const loan of loans) {
      if (!loan.history || loan.history.length === 0) continue;
      const rebuilt = reconstructDebtMap(loan.history, loan.balance);
      let last: number | null = null;
      for (const m of months) {
        const v = rebuilt.get(m);
        if (v != null) last = v;
        if (last != null) {
          debtBy.set(m, (debtBy.get(m) ?? 0) + last);
          historicSet.add(m);
        }
      }
    }
    // Future: project each loan from its balance over the remaining months.
    for (const loan of loans) {
      const schedule = computeLoanSchedule(
        loan,
        startMonth,
        cpiSeries
      );
      for (const r of schedule) {
        const m = r.month;
        if (!futureMonths.includes(m)) continue;
        debtBy.set(m, (debtBy.get(m) ?? 0) + r.balance);
      }
    }

    // Carry the latest known debt into months with no data (within the span).
    const rows: Row[] = months.map((m) => {
      const debt = debtBy.get(m) ?? 0;
      const property = Math.round(
        purchasePrice * (hmsIndexForMonth(hmsKey, m) / hmsIndexForMonth(hmsKey, earliestHistory))
      );
      return {
        month: new Date(`${m}-01T00:00:00Z`),
        debt,
        property,
        equity: property - debt,
        historic: historicSet.has(m),
      };
    });
    return { rows, debtByMonth: debtBy };
  }, [loans, assumptions, purchasePrice, hmsKey, todayKey]);

  // One continuous CPI series from the first month to now — for deflation.
  const fullCpi = useMemo(
    () => (rows.length ? buildCPISeries(monthKey(rows[0]!.month), rows.length, CPI_SCENARIO) : []),
    [rows]
  );
  const nowCpiIdx = rows.length ? fullCpi.length - 1 : 0;

  const displayRows = useMemo(() => {
    if (!real || rows.length === 0) return rows;
    const now = fullCpi[nowCpiIdx]!;
    return rows.map((r, i) => {
      const f = now / fullCpi[i]!;
      return {
        ...r,
        debt: r.debt * f,
        equity: r.equity * f,
        property: r.property * f,
      };
    });
  }, [rows, real, fullCpi, nowCpiIdx]);

  const displayRowsByMonth = useMemo(
    () => new Map(displayRows.map((r) => [monthKey(r.month), r])),
    [displayRows]
  );

  const deflateFor = (month: string): number => {
    if (!real || fullCpi.length === 0) return 1;
    const offset = Math.max(0, monthDiff(monthKey(rows[0]!.month), month));
    return fullCpi[nowCpiIdx]! / (fullCpi[offset] ?? fullCpi[nowCpiIdx]!);
  };

  // Extra-principal payments from real uploaded histories as dots.
  const extraDots = useMemo<ExtraDot[]>(
    () =>
      loans.flatMap((loan) =>
        (loan.history ?? []).flatMap((r) => {
          const kind = isExtra(r.action);
          if (!kind) return [];
          if (kind === "pension" && !showPension) return [];
          const debt = debtByMonth.get(r.date);
          if (debt == null) return [];
          return [
            {
              date: new Date(`${r.date}-01T00:00:00Z`),
              y: debt,
              kind,
              amount: r.principal,
              loanId: r.loanId,
            },
          ];
        })
      ),
    [loans, showPension, debtByMonth]
  );

  const definition = useMemo(
    () =>
      defineChart(
        {
          marks: [
            areaY(displayRows, {
              x: (d) => d.month,
              y1: 0,
              y: (d) => d.property,
              fill: "#10b981",
              fillOpacity: 0.4,
              stroke: "#059669",
              strokeWidth: 1,
              curve: stepCurve,
            }),
            areaY(displayRows, {
              x: (d) => d.month,
              y1: 0,
              y: (d) => d.debt,
              fill: "#f59e0b",
              fillOpacity: 0.75,
              stroke: "#d97706",
              strokeWidth: 1,
              curve: stepCurve,
            }),
            lineY(displayRows, {
              x: (d) => d.month,
              y: (d) => d.equity,
              stroke: "#047857",
              strokeWidth: 2.5,
              strokeDasharray: "4 4",
              curve: stepCurve,
            }),
            ruleX([{ t: today }], {
              x: (d) => d.t,
              stroke: "#0f172a",
              strokeWidth: 1,
              strokeDasharray: "4 4",
            }),
            dot(
              extraDots.filter((d) => d.kind === "prepayment"),
              {
                x: (d) => d.date,
                y: (d) => d.y,
                r: 3.5,
                fill: "#7c3aed",
                stroke: "#fff",
                strokeWidth: 1,
              }
            ),
            dot(
              extraDots.filter((d) => d.kind === "pension"),
              {
                x: (d) => d.date,
                y: (d) => d.y,
                r: 2.5,
                fill: "#60a5fa",
                stroke: "#fff",
                strokeWidth: 0.5,
              }
            ),
          ],
          scales: {
            x: {
              scale: scaleTime,
              grid: true,
              axis: { label: "Tími" },
            },
            y: {
              scale: () => scaleLinear(),
              nice: true,
              grid: true,
              axis: {
                label: real ? "ISK (raunvirði)" : "ISK",
                ticks: { format: (v) => fmtM(Number(v)) },
              },
            },
          },
        },
        { tooltip }
      ),
    [displayRows, today, extraDots, real]
  );

  const lastRow = displayRows[displayRows.length - 1];

  if (loans.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-bold">Skuld og eigið fé</h2>
        <div className="border border-neutral-200 rounded p-8 text-center space-y-3">
          <p className="text-neutral-600 text-sm">
            Want to view how your equity has developed? Add a loan above, then
            (optionally) upload its payment history — no data is shared or
            uploaded, it stays in your browser.
          </p>
          <p className="text-neutral-400 text-xs">
            Bættu við láni hér að ofan. Ef þú hleður inn Arion greiðslusögu
            (.xlsx) sýnir grafið raunverulega sögu skuldarinnar.
          </p>
        </div>
      </section>
    );
  }

  const withHistory = loans.filter((l) => l.history && l.history.length > 0).length;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold">Skuld og eigið fé</h2>

      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
        <label className="flex items-center gap-1">
          Kaupverð (kr.):
          <input
            type="number"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(Number(e.target.value))}
            step={1_000_000}
            min={0}
            className="w-24 border border-neutral-300 px-1 py-0.5 text-right text-xs"
          />
        </label>
        <label className="flex items-center gap-1">
          Vísitala (eignategund):
          <select
            value={hmsKey}
            onChange={(e) => setHmsKey(e.target.value)}
            className="border border-neutral-300 px-1 py-0.5 text-xs"
          >
            {HMS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1 text-neutral-500">
          {(() => {
            const s = hmsSeries(hmsKey);
            const last = s.points[s.points.length - 1]!;
            const age = hmsAgeMonths(hmsKey, todayKey);
            const stamp = new Date(s.publishedAt)
              .toLocaleDateString("is-IS", { month: "short", year: "numeric" });
            return (
              <span className={age > 3 ? "text-amber-600" : ""}>
                HMS {last.index.toFixed(1)} (mán.{" "}
                {new Date(`${last.month}-01T00:00:00Z`).toLocaleDateString("is-IS", {
                  month: "short",
                  year: "numeric",
                })}
                {age > 0 ? `, ${age} mán. gömul` : ", nýjust"} · birt {stamp})
              </span>
            );
          })()}
        </span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={real}
            onChange={(e) => setReal(e.target.checked)}
            className="accent-emerald-600"
          />
          Raunvirði (leiðrétt fyrir verðbólgu)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showPension}
            onChange={(e) => setShowPension(e.target.checked)}
            className="accent-blue-500"
          />
          Sýna séreignarsparnað (bláir punktar)
        </label>
        {lastRow ? (
          <span className="ml-auto text-neutral-500">
            {today.toLocaleDateString("is-IS", { month: "short", year: "numeric" })}
            {" — "}skuld {fmtM(lastRow.debt)} · eigið fé {fmtM(lastRow.equity)}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-neutral-500">
        {withHistory > 0
          ? `✓ ${withHistory} lán með raunverulegri greiðslusögu. Unnið alfarið í vafranum — ekkert sent á netþjón.`
          : "Framspá byggð á forsendum reiknivélar. Hlaðiðu inn Arion greiðslusögu (.xlsx) til að sjá raunverulega sögu skuldarinnar."}
      </p>

      <div className="border border-neutral-200 rounded p-2">
        <Chart
          definition={definition}
          aspectRatio={21 / 9}
          initialWidth={1200}
          ariaLabel="Eignir, skuld og eigið fé þróun"
          ariaDescription="Græna svæðið er fasteignavirði (eignir); appelsínugula svæðið neðst er skuldin; punktalínan er eigið fé (eignir mínus skuldir)."
          renderTooltipBody={({ points }) => {
            const datums = points.map((p) => p.datum);
            let d = datums.find(
              (x): x is Row => !!x && typeof x === "object" && "month" in x
            );
            if (!d) {
              const dotD = datums.find(
                (x): x is ExtraDot =>
                  !!x && typeof x === "object" && "date" in x && "kind" in x
              );
              if (dotD) d = displayRowsByMonth.get(monthKey(dotD.date));
            }
            if (!d) return null;
            const month = monthKey(d.month);
            const extras = extraDots.filter((x) => monthKey(x.date) === month);
            return (
              <div className="text-xs">
                <div className="font-bold">
                  {d.month.toLocaleDateString("is-IS", { month: "short", year: "numeric" })}
                  {real ? " (raunvirði)" : ""}
                </div>
                <div>Skuld: {fmtISK(d.debt)}</div>
                <div>Eigið fé: {fmtISK(d.equity)}</div>
                <div>Fasteign: {fmtISK(d.property)}</div>
                {d.historic ? (
                  <div className="text-neutral-500">Sögulegt (raunveruleg greiðslusaga)</div>
                ) : null}
                {extras.map((x) => (
                  <div key={`${x.kind}-${x.loanId}-${x.amount}`} className="text-violet-700">
                    {x.kind === "prepayment" ? "Innborgun" : "Séreignarsparnaður"}:{" "}
                    {fmtISK(real ? x.amount * deflateFor(month) : x.amount)} (lán {x.loanId})
                  </div>
                ))}
              </div>
            );
          }}
        />
      </div>

      <p className="text-xs text-neutral-400">
        {withHistory > 0
          ? "Saga: upphlaðin Arion greiðslusaga (höfuðstóll + verðbætur), staðan í dag er akkerið. Framspá: lánaáætlun reiknivélar (CPI 4.3→2.5%) út frá forsendum. "
          : "Framspá: lánaáætlun reiknivélar (CPI 4.3→2.5%) út frá forsendum. "}
        Fasteignavirði er leiðrétt með HMS vísitölu (valin eignategund) — kaupverðið
        gildir fyrir fyrsta mánuð grafarinnar. Raunvirði leiðréttir öll gildi með
        vísitölu neysluverðs (CPI_now/CPI_month). Bláir punktar (valfrjálsir) =
        séreignarsparnaður.
      </p>
    </section>
  );
}
