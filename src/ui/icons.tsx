import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  BadmintonIcon as HugeBadmintonIcon,
  BadmintonShuttleIcon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  InformationCircleIcon,
  Tick02Icon,
  ToggleOffIcon,
  ToggleOnIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

type IconProps = {
  size?: number;
  color?: string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

function Icon({
  icon,
  size = 24,
  color = "currentColor",
  className,
  ...props
}: IconProps & { icon: IconSvgElement }) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      color={color}
      strokeWidth={2}
      className={className}
      aria-hidden={props["aria-hidden"] ?? true}
    />
  );
}

export function ArrowLeft(props: IconProps) {
  return <Icon icon={ArrowLeft01Icon} {...props} />;
}

export function Check(props: IconProps) {
  return <Icon icon={Tick02Icon} {...props} />;
}

export function ChevronDown(props: IconProps) {
  return <Icon icon={ArrowDown01Icon} {...props} />;
}

export function ChevronRight(props: IconProps) {
  return <Icon icon={ArrowRight01Icon} {...props} />;
}

export function ChevronUp(props: IconProps) {
  return <Icon icon={ArrowUp01Icon} {...props} />;
}

export function Copy(props: IconProps) {
  return <Icon icon={Copy01Icon} {...props} />;
}

export function Download(props: IconProps) {
  return <Icon icon={Download01Icon} {...props} />;
}

export function Info(props: IconProps) {
  return <Icon icon={InformationCircleIcon} {...props} />;
}

export function Plus(props: IconProps) {
  return <Icon icon={Add01Icon} {...props} />;
}

export function Trash2(props: IconProps) {
  return <Icon icon={Delete02Icon} {...props} />;
}

export function X(props: IconProps) {
  return <Icon icon={Cancel01Icon} {...props} />;
}

export function ToggleLeft(props: IconProps) {
  return <Icon icon={ToggleOffIcon} {...props} />;
}

export function ToggleRight(props: IconProps) {
  return <Icon icon={ToggleOnIcon} {...props} />;
}

export function BadmintonIcon(props: IconProps) {
  return <Icon icon={HugeBadmintonIcon} {...props} />;
}

export function ShuttleIcon(props: IconProps) {
  return <Icon icon={BadmintonShuttleIcon} {...props} />;
}
