export function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3 ${className}`}
    >
      {children}
    </h2>
  );
}

export function BulletList({
  items,
  icon,
}: {
  items: string[];
  icon?: React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <span className="mt-0.5 shrink-0 text-zinc-400">{icon ?? "•"}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
