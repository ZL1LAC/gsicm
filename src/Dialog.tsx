import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native dialogs keep keyboard focus inside the active task. */
export function Dialog({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`app-dialog ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
