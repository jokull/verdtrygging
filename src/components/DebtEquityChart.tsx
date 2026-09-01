/**
 * Debt & equity over time — built entirely from the user's uploaded Arion
 * "LoanPayments" export(s). Nothing is baked in: the chart is blank (a
 * "want to see your equity develop?" prompt) until a workbook is uploaded.
 *
 * Every distinct Lánsnúmer (loanId) across all uploaded files becomes its own
 * loan series (files stack). Each series' debt history is reconstructed
 * backward from an anchor balance the user supplies ("staða í dag"), using the
 * export's per-payment höfuðstóll (principal) and verðbætur (indexation).
 * Property value grows from a purchase price at a monthly rate; equity =
 * property − total debt. The "today" marker is the real current date.
 *
 * The workbook is parsed ENTIRELY in the browser (static site, no server).
 */
import { useMemo, useState } from "react";
import { defineChart, areaY, ruleX, dot, lineY, type ChartCurve } from "@tanstack/charts";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleTime } from "d3-scale";
import { Chart } from "@tanstack/react-charts/tooltip";
import * as XLSX from "xlsx";
import { buildCPISeries } from "../cpi";
import type { ScenarioConfig } from "../types";

interface Row {
  month: Date;
  debt: number;
  equity: number;
  property: number;
}

interface ExtraDot {
  date: Date;
  y: number;
  kind: "prepayment" | "pension";
  amount: number;
  loanId: number;
}

// One payment row from a LoanPayments export ("Lánsnúmer, Aðgerð, Greiðsludags.,
// Mynt, Höfuðstóll, Vextir, Verðbætur á höfuðstól, ..., Samtals").
interface UploadedRow {
  loanId: number;
  action: string;
  date: string; // "YYYY-MM"
  principal: number; // Höfuðstóll
  indexation: number; // Verðbætur á höfuðstól
  total: number; // Samtals
}

// A single loan, grouped by Lánsnúmer across all uploaded files.
interface LoanSeries {
  loanId: number;
  name: string;
  rows: UploadedRow[];
  currentBalance: number; // "staða í dag" — anchor for the backward walk
}

// The CPI path for deflation (4.3 → 2.5%), anchored to the current year.
const CPI_SCENARIO: ScenarioConfig = (() => {
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

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonthKey(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}

/** Contiguous "YYYY-MM" keys from `from` (inclusive) to `to` (inclusive). */
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

/**
 * Reconstruct a loan's debt-over-time going backward from `currentBalance`.
 * Rows are aggregated by month first (a month can carry several payments —
 * scheduled installment + pension + prepayment), then the balance is walked
 * back: balance_before = balance_after − indexation + principal, with
 * balance_after[last] = currentBalance as the anchor.
 */
function reconstructDebt(series: LoanSeries): Map<string, number> {
  // Aggregate principal + indexation per month.
  const byMonth = new Map<string, { principal: number; indexation: number }>();
  for (const r of series.rows) {
    const cur = byMonth.get(r.date) ?? { principal: 0, indexation: 0 };
    cur.principal += r.principal;
    cur.indexation += r.indexation;
    byMonth.set(r.date, cur);
  }
  const months = [...byMonth.keys()].sort();
  const map = new Map<string, number>();
  if (months.length === 0) return map;
  let after = series.currentBalance; // balance after the last payment
  for (let i = months.length - 1; i >= 0; i--) {
    const m = months[i]!;
    const { principal, indexation } = byMonth.get(m)!;
    map.set(m, after);
    // before = after − indexation + principal  (balance entering this month)
    after = after - indexation + principal;
  }
  return map;
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

export function DebtEquityChart() {
  const [series, setSeries] = useState<LoanSeries[]>([]);
  const [purchasePrice, setPurchasePrice] = useState(60_000_000); // anonymized default
  const [growthPct, setGrowthPct] = useState(4.5);
  const [real, setReal] = useState(false);
  const [showPension, setShowPension] = useState(false);

  const today = new Date();
  const todayKey = monthKey(today);

  // Parse one uploaded workbook, group rows by Lánsnúmer across files.
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const results = Array.from(files).map((file) =>
      file.arrayBuffer().then((buf) => {
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]!];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        return (rows as unknown[])
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
      })
    );
    Promise.all(results).then((grouped) => {
      const flat = grouped.flat();
      setSeries((prev) => {
        const acc = new Map<number, LoanSeries>();
        for (const s of prev) acc.set(s.loanId, s);
        for (const r of flat) {
          const existing = acc.get(r.loanId);
          if (existing) {
            // Merge rows (dedupe by date+principal+indexation so a re-upload of
            // the same file doesn't double-count, but distinct same-month
            // payments survive); keep the user's anchor balance.
            const byKey = new Map(
              existing.rows.map((x) => [
                `${x.date}|${x.principal}|${x.indexation}`,
                x,
              ])
            );
            byKey.set(`${r.date}|${r.principal}|${r.indexation}`, r);
            existing.rows = [...byKey.values()].sort((a, b) =>
              a.date.localeCompare(b.date)
            );
            acc.set(r.loanId, existing);
          } else {
            acc.set(r.loanId, {
              loanId: r.loanId,
              name: `Lán ${r.loanId}`,
              rows: [r],
              currentBalance: 10_000_000, // editable placeholder anchor
            });
          }
        }
        return [...acc.values()];
      });
    });
  }

  function uploadMore(e: React.ChangeEvent<HTMLInputElement>) {
    handleUpload(e);
    // Re-arm the input so the same file can be picked again after deletion.
    e.target.value = "";
  }

  function updateSeries(loanId: number, patch: Partial<LoanSeries>) {
    setSeries((prev) =>
      prev.map((s) => (s.loanId === loanId ? { ...s, ...patch } : s))
    );
  }

  function removeSeries(loanId: number) {
    setSeries((prev) => prev.filter((s) => s.loanId !== loanId));
  }

  // Build the monthly rows: total debt per month (sum across series), property
  // grown from purchasePrice, equity = property − debt.
  const { rows, debtByMonth } = useMemo(() => {
    if (series.length === 0) return { rows: [] as Row[], debtByMonth: new Map<string, number>() };
    const earliest = series
      .flatMap((s) => s.rows.map((r) => r.date))
      .sort()[0]!;
    const months = monthRange(earliest, todayKey);
    const debtBy = new Map<string, number>();
    for (const s of series) {
      const rebuilt = reconstructDebt(s);
      let last: number | null = null;
      for (const m of months) {
        const v = rebuilt.get(m);
        if (v != null) last = v;
        debtBy.set(m, (debtBy.get(m) ?? 0) + (last ?? 0));
      }
    }
    const rows: Row[] = months.map((m) => {
      const debt = debtBy.get(m) ?? 0;
      const property = Math.round(
        purchasePrice * Math.pow(1 + growthPct / 100, monthDiff(earliest, m) / 12)
      );
      return {
        month: new Date(`${m}-01T00:00:00Z`),
        debt,
        property,
        equity: property - debt,
      };
    });
    return { rows, debtByMonth: debtBy };
  }, [series, purchasePrice, growthPct, todayKey]);

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

  // Extra-principal payments (Innborgun / séreignarsparnaður) as dots on the
  // debt boundary; details surface in the hover card.
  const extraDots = useMemo<ExtraDot[]>(
    () =>
      series.flatMap((s) =>
        s.rows.flatMap((r) => {
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
    [series, showPension, debtByMonth]
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

  if (series.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-bold">Skuld og eigið fé</h2>
        <div className="border border-neutral-200 rounded p-8 text-center space-y-3">
          <p className="text-neutral-600 text-sm">
            Want to view how your equity has developed? Upload payment
            history — no data is shared or uploaded, it stays in your browser.
          </p>
          <p className="text-neutral-400 text-xs">
            Hlaðaðu inn Arion "LoanPayments" greiðslusögu (.xlsx) til að sjá
            skuld og eigið fé þróast yfir tíma. Gögnin eru lesin alfarið í
            vafranum.
          </p>
          <label className="inline-flex items-center gap-1 rounded border border-neutral-300 px-3 py-1.5 text-sm cursor-pointer hover:bg-neutral-100">
            ⬆ Upload payment history (.xlsx)
            <input
              type="file"
              accept=".xlsx"
              multiple
              onChange={handleUpload}
              className="sr-only"
            />
          </label>
        </div>
      </section>
    );
  }

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
          Vöxtur fasteignaverðs (%/ár):
          <input
            type="number"
            value={growthPct}
            onChange={(e) => setGrowthPct(Number(e.target.value))}
            step={0.5}
            min={0}
            className="w-16 border border-neutral-300 px-1 py-0.5 text-right text-xs"
          />
        </label>
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
        <label className="flex items-center gap-1 text-xs">
          Bæta við greiðsluskrá (.xlsx):
          <input
            type="file"
            accept=".xlsx"
            multiple
            onChange={uploadMore}
            className="text-xs"
          />
        </label>
        {lastRow ? (
          <span className="ml-auto text-neutral-500">
            {today.toLocaleDateString("is-IS", { month: "short", year: "numeric" })}
            {" — "}skuld {fmtM(lastRow.debt)} · eigið fé {fmtM(lastRow.equity)}
          </span>
        ) : null}
      </div>

      {series.length > 0 ? (
        <div className="space-y-1">
          {series.map((s) => (
            <div
              key={s.loanId}
              className="flex flex-wrap items-center gap-2 text-xs text-neutral-600"
            >
              <span className="font-medium">{s.name}</span>
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateSeries(s.loanId, { name: e.target.value })}
                className="border-b border-transparent hover:border-neutral-300 focus:border-neutral-500 outline-none w-28 text-xs"
              />
              <label className="flex items-center gap-1">
                Staða í dag:
                <input
                  type="number"
                  value={s.currentBalance}
                  onChange={(e) =>
                    updateSeries(s.loanId, { currentBalance: Number(e.target.value) })
                  }
                  step={100_000}
                  min={0}
                  className="w-28 border border-neutral-300 px-1 py-0.5 text-right text-xs"
                />
              </label>
              <span className="text-neutral-400">{s.rows.length} færslur</span>
              <button
                onClick={() => removeSeries(s.loanId)}
                className="text-neutral-400 hover:text-red-600"
              >
                eyða
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-neutral-500">
        ⚠ Unnið alfarið í vafranum — ekkert sent á netþjón.{" "}
        {series.map((s) => s.rows.length).reduce((a, b) => a + b, 0)} færslur
        úr {series.length} {series.length > 1 ? "lánum" : "láni"}.
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
        Saga: upphlaðin Arion greiðslusaga (höfuðstóll + verðbætur), staðan í dag
        er akkerið. Framspá: ekki innifalin — þetta er upplýst saga eigin fjár.
        Raunvirði leiðréttir öll gildi með vísitölu neysluverðs
        (CPI_now/CPI_month). Bláir punktar (valfrjálsir) = séreignarsparnaður.
      </p>
    </section>
  );
}
