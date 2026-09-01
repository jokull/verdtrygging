import { useRef } from "react";
import type { LoanInput } from "../types";
import { LoanForm } from "./LoanForm";
import { nextId } from "../defaults";
import { parseLoanPayments } from "../utils/payment-history";

interface Props {
  loans: LoanInput[];
  onChange: (loans: LoanInput[]) => void;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function LoanList({ loans, onChange }: Props) {
  const updateLoan = (idx: number, loan: LoanInput) => {
    const next = [...loans];
    next[idx] = loan;
    onChange(next);
  };

  const removeLoan = (idx: number) => {
    onChange(loans.filter((_, i) => i !== idx));
  };

  const addLoan = () => {
    onChange([
      ...loans,
      {
        id: nextId(),
        name: `Lán ${loans.length + 1}`,
        balance: 10_000_000,
        apr: 5.0,
        remainingMonths: 240,

        method: "annuity",
        extraBrackets: [],
        pensionPrincipal: 0,
        rateChanges: [],
        startMonth: currentMonth(),
      },
    ]);
  };

  const inputRef = useRef<HTMLInputElement>(null);

  // Upload an Arion LoanPayments .xlsx AS A NEW LOAN. The export carries the
  // loan's identity (Lánsnúmer), origination principal, start month and full
  // payment ledger, so we create the loan pre-filled with those. The user then
  // fills the 3 terms the file can't carry: Eftirst., Vextir, Mán. eftir.
  async function handleUploadNew(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseLoanPayments(file);
      onChange([
        ...loans,
        {
          id: nextId(),
          name: `Lán ${parsed.loanId || loans.length + 1}`,
          balance: 10_000_000, // placeholder — user sets the real "Staða láns"
          apr: 5.0,
          remainingMonths: 240,
          method: "annuity",
          extraBrackets: [],
          pensionPrincipal: 0,
          rateChanges: [],
          startMonth: parsed.originationMonth || currentMonth(),
          arionLoanId: parsed.loanId || undefined,
          originationPrincipal: parsed.originationPrincipal || undefined,
          originationMonth: parsed.originationMonth || undefined,
          history: parsed.rows,
        },
      ]);
    } catch (err) {
      console.error("Arion history parse failed", err);
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Lán</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 cursor-pointer">
            ⬆ nýtt lán úr Excel (.xlsx)
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              onChange={handleUploadNew}
              className="sr-only"
            />
          </label>
          <button
            onClick={addLoan}
            className="text-xs border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100"
          >
            + bæta við láni
          </button>
        </div>
      </div>
      {loans.map((loan, i) => (
        <LoanForm
          key={loan.id}
          loan={loan}
          onChange={(l) => updateLoan(i, l)}
          onRemove={() => removeLoan(i)}
        />
      ))}
    </div>
  );
}
