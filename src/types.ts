export interface RateChange {
  atMonth: number;
  newApr: number;
}

export interface PaymentBracket {
  startYear: number;
  years: number;
  amount: number;
}

export interface RateBracket {
  startYear: number;
  years: number;
  rate: number;
}

export interface LoanInput {
  id: string;
  name: string;
  balance: number;
  apr: number;
  remainingMonths: number;
  method: "annuity" | "equal_principal";
  extraBrackets: PaymentBracket[];
  pensionPrincipal: number;
  rateChanges: RateChange[];
  // Optional real-world link — hydrated from an uploaded Arion LoanPayments
  // export. The upload carries the loan's Lánsnúmer, origination principal and
  // start month (the Útgreiðsla disbursement row) + its monthly payment ledger.
  arionLoanId?: number;
  originationPrincipal?: number;
  originationMonth?: string; // "YYYY-MM"
  startMonth: string; // "YYYY-MM" — the month the projection begins (today by
  // default; set to the loan's origination month when a ledger is attached so
  // the projection/schedule span matches the loan's real term).
  history?: UploadedRow[];
}

/** One payment row from a LoanPayments export ("Lánsnúmer, Aðgerð, Greiðsludags.,
 * Mynt, Höfuðstóll, Vextir, Verðbætur á höfuðstól, Verðbætur á vexti,
 * Greiðslujöfnun, Roll-up upphæð, Dráttarvextir, Kostnaður, Samtals"). */
export interface UploadedRow {
  loanId: number;
  action: string;
  date: string; // "YYYY-MM"
  principal: number; // Höfuðstóll
  indexation: number; // Verðbætur á höfuðstól
  total: number; // Samtals
}

export interface ScenarioConfig {
  label: string;
  rateBrackets: RateBracket[];
}

export type PensionCap = "none" | "single" | "couple";

export interface Assumptions {
  startMonth: string; // "YYYY-MM"
  pensionCap: PensionCap;
  scenarios: [ScenarioConfig, ScenarioConfig, ScenarioConfig];
}

export interface MonthResult {
  month: string;
  monthIndex: number;
  payment: number;
  interest: number;
  principalRepaid: number;
  extra: number;
  pension: number;
  indexation: number;
  balance: number;
  cpi: number;
}

export interface YearSummary {
  year: number;
  months: MonthResult[];
  totalPayment: number;
  totalInterest: number;
  totalPrincipal: number;
  totalExtra: number;
  totalPension: number;
  totalIndexation: number;
  endBalance: number;
}
