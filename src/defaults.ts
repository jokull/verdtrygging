import type { LoanInput, Assumptions, ScenarioConfig, RateBracket } from "./types";

let _nextId = 1;
export function nextId(): string {
  return String(_nextId++);
}

export function defaultLoans(): LoanInput[] {
  const id1 = nextId();
  const id2 = nextId();
  return [
    {
      id: id1,
      name: "Húsnæðislán A",
      balance: 68_250_000,
      apr: 4.75,
      remainingMonths: 288,

      method: "annuity",
      extraBrackets: [],
      pensionPrincipal: 0,
      rateChanges: [],
      startMonth: currentMonth(),
    },
    {
      id: id2,
      name: "Húsnæðislán B",
      balance: 9_400_000,
      apr: 6.15,
      remainingMonths: 288,

      method: "annuity",
      extraBrackets: [{ startYear: 2027, years: 5, amount: 90_000 }],
      pensionPrincipal: 38_500,
      rateChanges: [],
      startMonth: currentMonth(),
    },
  ];
}

export function deriveScenarios(
  baseBrackets: RateBracket[]
): [ScenarioConfig, ScenarioConfig, ScenarioConfig] {
  const optimistic: ScenarioConfig = {
    label: "Bjartsýn",
    rateBrackets: baseBrackets.map((b) => ({
      startYear: b.startYear,
      years: b.years,
      rate: Math.max(2.0, b.rate - 0.5),
    })),
  };

  const base: ScenarioConfig = {
    label: "Grunn",
    rateBrackets: [...baseBrackets],
  };

  const conservative: ScenarioConfig = {
    label: "Varúð",
    rateBrackets: baseBrackets.map((b) => ({
      startYear: b.startYear,
      years: b.years,
      rate: Math.min(6.0, b.rate + 0.7),
    })),
  };

  return [optimistic, base, conservative];
}

export function defaultBaseRates(): RateBracket[] {
  const y = new Date().getFullYear();
  return [
    { startYear: y, years: 2, rate: 4.3 },
    { startYear: y + 2, years: 23, rate: 2.5 },
  ];
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function defaultAssumptions(): Assumptions {
  const baseRates = defaultBaseRates();
  return {
    startMonth: currentMonth(),
    pensionCap: "single" as const,
    scenarios: deriveScenarios(baseRates),
  };
}
