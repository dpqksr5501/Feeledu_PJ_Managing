import {
  useEffect,
  useId,
  isValidElement,
  cloneElement,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { X, LoaderCircle, Inbox } from "lucide-react";
export function Modal({
  title,
  children,
  close,
  dismissible = true,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) || [],
      );
    (focusable()[0] ?? dialog.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) close();
      if (event.key === "Tab") {
        const elements = focusable();
        if (!elements.length) {
          event.preventDefault();
          return;
        }
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [close, dismissible]);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          {dismissible && (
            <button className="icon-button" aria-label="닫기" onClick={close}>
              <X size={20} />
            </button>
          )}
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const nativeControl =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type);
  const controlId = id + "-control";
  const control = nativeControl
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId,
        "aria-labelledby": id,
        "aria-describedby": hint ? id + "-hint" : undefined,
      })
    : children;
  return (
    <div className="field">
      {nativeControl ? (
        <label id={id} htmlFor={controlId}>
          {label}
        </label>
      ) : (
        <span id={id}>{label}</span>
      )}
      {control}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={32} strokeWidth={1.3} />
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} /> 불러오는 중
    </div>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <img
        className="brand-wordmark"
        src="/brand/feeledu-logo.png"
        width="1851"
        height="849"
        alt="FEEL EDU"
      />
      <span className="brand-compact" aria-hidden="true">
        <img src="/icon-192.png" width="42" height="42" alt="" />
      </span>
    </div>
  );
}
export function Help({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="help-details">
      <summary>{title}</summary>
      <div className="help-content">{children}</div>
    </details>
  );
}
export function Alert({
  children,
  kind = "warning",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`alert ${kind}`}
    >
      {children}
    </div>
  );
}
