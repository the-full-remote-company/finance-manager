import type { ReactNode } from "react";

export interface DatePickerProps {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, the wire format from contracts/README.md. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  errorMessage?: string;
  required?: boolean;
}

/**
 * A native `<input type="date">`, not shipped by `@tfrc/product@1.1.0`
 * (research.md Part C). Built locally on `.field` and logged in
 * `PROMOTE.md` at use count 1.
 *
 * Native date input rather than a custom calendar widget: the browser
 * supplies locale-correct formatting, full keyboard support, and a mobile
 * date wheel for free — a hand-built calendar would have to re-earn every
 * one of those for Article IV, for a control this feature uses to capture a
 * start date, a contract end date, or a notice deadline, never to browse a
 * range.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  min,
  max,
  errorMessage,
  required = false,
}: DatePickerProps): ReactNode {
  const errorId = errorMessage === undefined ? undefined : `${id}-error`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        required={required}
        aria-invalid={errorMessage === undefined ? undefined : true}
        aria-describedby={errorId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {errorMessage === undefined ? null : (
        <p id={errorId} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
