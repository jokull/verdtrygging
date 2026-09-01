import type { ScenarioConfig } from "./types";

// Historical CPI from Hagstofa VIS01004.px (monthly, base=100 March 1997)
// Source: https://px.hagstofa.is/pxis/pxweb/is/Efnahagur/Efnahagur__visitolur__1_vnv__1_vnv/VIS01004.px
const HISTORICAL_CPI: Record<string, number> = {
  "2024-01": 597.4,
  "2024-02": 598.6,
  "2024-03": 601.0,
  "2024-04": 604.4,
  "2024-05": 606.4,
  "2024-06": 607.5,
  "2024-07": 612.3,
  "2024-08": 614.9,
  "2024-09": 617.5,
  "2024-10": 618.8,
  "2024-11": 619.1,
  "2024-12": 620.0,
  "2025-01": 623.7,
  "2025-02": 627.0,
  "2025-03": 630.8,
  "2025-04": 634.1,
  "2025-05": 636.6,
  "2025-06": 639.7,
  "2025-07": 644.8,
  "2025-08": 648.1,
  "2025-09": 650.2,
  "2025-10": 651.3,
  "2025-11": 651.3,
  "2025-12": 652.4,
  "2026-01": 656.2,
  "2026-02": 659.8,
  "2026-03": 663.0,
};

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function getYearFromMonth(ym: string): number {
  return parseInt(ym.split("-")[0]);
}

/**
 * Build a CPI series for `numMonths + 1` entries starting at `startMonth`.
 * Uses historical values when available, then projects forward using the
 * scenario's annual rates compounded monthly.
 */
export function buildCPISeries(
  startMonth: string,
  numMonths: number,
  scenario: ScenarioConfig
): number[] {
  const series: number[] = [];

  for (let i = 0; i <= numMonths; i++) {
    const month = addMonths(startMonth, i);
    if (HISTORICAL_CPI[month] !== undefined) {
      series.push(HISTORICAL_CPI[month]);
    } else {
      // Find last known CPI and compound forward
      const lastKnownMonth = findLastKnownMonth(month);
      const lastCPI = HISTORICAL_CPI[lastKnownMonth];
      const monthsToProject = monthDiff(lastKnownMonth, month);

      let cpi = lastCPI;
      let currentMonth = lastKnownMonth;
      for (let j = 0; j < monthsToProject; j++) {
        currentMonth = addMonths(currentMonth, 1);
        const year = getYearFromMonth(currentMonth);
        const annualRate = getRateForYear(scenario, year);
        const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
        cpi = cpi * (1 + monthlyRate);
      }
      series.push(Math.round(cpi * 10) / 10);
    }
  }

  return series;
}

function findLastKnownMonth(beforeMonth: string): string {
  const months = Object.keys(HISTORICAL_CPI).sort();
  let last = months[0];
  for (const m of months) {
    if (m >= beforeMonth) break;
    last = m;
  }
  return last;
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function getRateForYear(scenario: ScenarioConfig, year: number): number {
  // Find the bracket that covers this year
  for (let i = scenario.rateBrackets.length - 1; i >= 0; i--) {
    const b = scenario.rateBrackets[i];
    if (year >= b.startYear && year < b.startYear + b.years) return b.rate;
  }
  // Fall back to last bracket's rate (CPI continues)
  return scenario.rateBrackets[scenario.rateBrackets.length - 1]?.rate ?? 2.5;
}

export function getHistoricalCPI(): Record<string, number> {
  return { ...HISTORICAL_CPI };
}
