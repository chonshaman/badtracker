import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ActionButtonVariant =
  | "copy"
  | "pin"
  | "danger-subtle"
  | "danger-strong"
  | "add-score";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: ActionButtonVariant;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
};

function variantClassName(variant: ActionButtonVariant): string {
  switch (variant) {
    case "pin":
      return "action-button action-button-pin";
    case "danger-subtle":
      return "action-button action-button-danger-subtle";
    case "danger-strong":
      return "action-button action-button-danger-strong";
    case "add-score":
      return "action-button action-button-add-score";
    case "copy":
    default:
      return "action-button action-button-copy";
  }
}

export function ActionButton({
  variant,
  iconStart,
  iconEnd,
  className = "",
  children,
  type = "button",
  ...props
}: ActionButtonProps) {
  const resolvedClassName = [variantClassName(variant), className].filter(Boolean).join(" ");
  return (
    <button type={type} className={resolvedClassName} {...props}>
      {iconStart ? <span className="action-button-icon" aria-hidden="true">{iconStart}</span> : null}
      <span className="action-button-label">{children}</span>
      {iconEnd ? <span className="action-button-icon" aria-hidden="true">{iconEnd}</span> : null}
    </button>
  );
}
