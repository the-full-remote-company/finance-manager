import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id: string;
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Rendered under the control, e.g. a field-level validation message. */
  errorMessage?: string;
  required?: boolean;
}

/**
 * A native `<select>`, not shipped by `@tfrc/product@1.1.0` (research.md Part
 * C: "It does not ship a table, a date picker, a select, or a modal"). Built
 * locally on `.field`, the one token this needs, and logged in `PROMOTE.md`
 * at use count 1 — nothing promotes upstream before its third identical use.
 *
 * Native `<select>` rather than a custom listbox: full keyboard and screen
 * reader support for free, which a hand-built listbox would have to
 * re-implement to meet Article IV.
 */
export function Select({
  id,
  label,
  options,
  value,
  onChange,
  errorMessage,
  required = false,
}: SelectProps): ReactNode {
  const errorId = errorMessage === undefined ? undefined : `${id}-error`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        required={required}
        aria-invalid={errorMessage === undefined ? undefined : true}
        aria-describedby={errorId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errorMessage === undefined ? null : (
        <p id={errorId} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
