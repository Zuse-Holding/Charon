import type { ReactNode } from "react";
import { STEP_GLYPH, STEP_WORD, stepStates } from "./steps";

// The stepper every Metis long job uses: Diligence deals, Intelligence runs,
// Committee meetings. Named stages, the current one marked, a glyph and a
// word for each state (never color alone), and an optional line under the
// current step ("since 2:05 PM", "6 of 15 sources").

export interface Step {
  key: string;
  label: string;
}

export interface StepperProps {
  steps: Step[];
  /** Index of the step in progress; -1 before the first, steps.length when all are done. */
  current: number;
  /** The current step stopped. */
  failed?: boolean;
  /** Shown under the current step's label. */
  currentDetail?: ReactNode;
  /** A line under the whole stepper ("Expected by Tue, Oct 21"). */
  footer?: ReactNode;
  label?: string;
}

export function Stepper({ steps, current, failed = false, currentDetail, footer, label = "Progress" }: StepperProps) {
  const states = stepStates(steps.length, current, failed);
  return (
    <div className="m-stepper">
      <ol className="m-steps" aria-label={label}>
        {steps.map((s, i) => {
          const st = states[i];
          return (
            <li key={s.key} className={`m-step m-step-${st}`} aria-current={st === "now" ? "step" : undefined}>
              <span className="m-step-dot" aria-hidden>{STEP_GLYPH[st]}</span>
              <span className="m-step-label">
                {s.label}
                <span className="m-sr-only"> ({STEP_WORD[st]})</span>
                {(st === "now" || st === "failed") && currentDetail && <span className="m-step-detail">{currentDetail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {footer && <div className="m-stepper-footer">{footer}</div>}
    </div>
  );
}
