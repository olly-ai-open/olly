import Link from "next/link";

type BriefActionPillTone = "default" | "muted";

interface BriefActionPillProps {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  isNew?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  tone?: BriefActionPillTone;
}

export default function BriefActionPill({
  label,
  href,
  onClick,
  disabled,
  isNew,
  isLoading,
  loadingLabel,
  tone = "default",
}: BriefActionPillProps) {
  const baseClasses =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold shadow-card";
  const toneClasses =
    tone === "muted"
      ? "border-border/70 bg-muted text-muted-foreground"
      : "border-border/80 bg-primary text-primary-foreground hover:opacity-90";
  const stateClasses = disabled
    ? "cursor-not-allowed opacity-60"
    : "cursor-pointer";

  const content = (
    <>
      {isNew ? (
        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
      ) : null}
      {isLoading ? (
        <>
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="31.416"
              strokeDashoffset="31.416"
              className="animate-spin"
            />
          </svg>
          {loadingLabel ?? "Generating..."}
        </>
      ) : (
        label
      )}
    </>
  );

  const className = `${baseClasses} ${toneClasses} ${stateClasses}`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {content}
    </button>
  );
}
