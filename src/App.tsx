import { useMemo } from "react";
import { useHashState } from "./utils/url-state";
import { computeAll } from "./calc";
import { LoanList } from "./components/LoanList";
import { Assumptions } from "./components/Assumptions";
import { Summary } from "./components/Summary";
import { Schedule } from "./components/Schedule";
import { DebtEquityChart } from "./components/DebtEquityChart";

export function App() {
  const { loans, assumptions, setLoans, setAssumptions } = useHashState();

  const result = useMemo(
    () => computeAll(loans, assumptions),
    [loans, assumptions]
  );

  return (
    <div className="max-w-[1600px] mx-auto p-4 space-y-6">
      <h1 className="text-base font-bold">
        Verðtryggt húsnæðislán — reiknivél
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        <LoanList loans={loans} onChange={setLoans} />
        <Assumptions assumptions={assumptions} onChange={setAssumptions} />
      </div>

      <Summary loanSchedules={result.loanSchedules} />
      <Schedule loanSchedules={result.loanSchedules} />

      <hr className="border-neutral-200" />

      <DebtEquityChart loans={loans} assumptions={assumptions} />

      <footer className="text-xs text-neutral-400 border-t border-neutral-200 pt-3 flex flex-wrap items-center gap-2">
        <span>
          Eigið fé reiknivél — gögnin eru lesin alfarið í vafranum (ekkert sent á
          netþjón).
        </span>
        <a
          href="https://github.com/jokull/verdtrygging"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-600"
        >
          github.com/jokull/verdtrygging
        </a>
      </footer>
    </div>
  );
}
