import { PropsWithChildren, ReactNode } from "react";

type TransparentButtonProps = {
  title?: string;
  onClick: () => void;
  color?: colors;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  disabled?: boolean;
  isActive?: boolean;
};

type colors = "blue" | "red" | "black" | "green";

export default function TransparentButton({
  title,
  onClick,
  children,
  color,
  icon,
  iconPosition = "left",
  disabled = false,
  isActive = false,
}: PropsWithChildren<TransparentButtonProps>) {
  const colorMap: Record<colors, string> = {
    blue: "border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/60",
    red: "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60",
    black:
      "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800",
    green:
      "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60",
  };

  const activeMap: Record<colors, string> = {
    blue: "border-blue-400 dark:border-blue-600 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",
    red: "border-red-400 dark:border-red-600 bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400",
    black:
      "border-zinc-400 dark:border-zinc-500 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200",
    green:
      "border-emerald-400 dark:border-emerald-600 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300",
  };

  const resolvedColor = color ?? "black";
  const colorStyle = isActive
    ? activeMap[resolvedColor]
    : colorMap[resolvedColor];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${disabled ? "border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600" : colorStyle}`}
    >
      {icon && iconPosition === "left" && (
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {icon}
        </span>
      )}
      {title && title}
      {children}
      {icon && iconPosition === "right" && (
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {icon}
        </span>
      )}
    </button>
  );
}
