import { useEffect, useRef, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  /** Accessible name for the close button, e.g. "Schließen" — supplied by
   *  the caller from `useTranslations()`, never a literal here. */
  closeLabel: string;
  children: ReactNode;
}

/**
 * A modal dialog, not shipped by `@tfrc/product@1.1.0` (research.md Part C).
 * Built locally on the native `<dialog>` element and logged in `PROMOTE.md`
 * at use count 1.
 *
 * `<dialog showModal>` rather than a hand-built overlay: focus trapping,
 * `Esc` to close, inert content behind it, and top-layer stacking all come
 * from the browser rather than from application code that would have to get
 * every one of those right to satisfy Article IV.
 */
export function Modal({
  open,
  onClose,
  titleId,
  title,
  closeLabel,
  children,
}: ModalProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // The native Esc-triggered "cancel" event closes the element itself;
        // this only synchronises the caller's `open` state with it.
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      <button type="button" className="btn btn--ghost" aria-label={closeLabel} onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
    </dialog>
  );
}
