import { PropsWithChildren, ReactNode } from "react";

type TransparentButtonProps = {
  title?: string;
  onClick: () => void;
  color?: colors;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  disabled?: boolean;
  isActive?: boolean;
  noBorder?: boolean;
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
  noBorder = false,
}: PropsWithChildren<TransparentButtonProps>) {
  const colorMap: Record<colors, string> = {
    blue: "border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60",
    red: "border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60",
    black:
      "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70",
    green:
      "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60",
  };

  const activeMap: Record<colors, string> = {
    blue: "border-indigo-400 dark:border-indigo-600 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300",
    red: "border-rose-400 dark:border-rose-600 bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400",
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
      className={`inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl shadow-sm ${noBorder ? "" : "border"} transition-all hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${disabled ? "border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 shadow-none cursor-not-allowed" : colorStyle}`}
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
