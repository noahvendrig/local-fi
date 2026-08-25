"use client";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  isPending = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,.6))" }}
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-line bg-surf p-6 shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium text-t1">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-t2">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isPending) onClose();
            }}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-t1 hover:bg-surf-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              danger
                ? "border border-err bg-err text-white hover:opacity-90"
                : "bg-acc text-on-acc hover:bg-acc-2"
            }`}
          >
            {isPending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
