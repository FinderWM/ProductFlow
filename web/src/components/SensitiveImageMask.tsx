import { EyeOff } from "lucide-react";

export type SensitiveImageMaskIntensity = "soft" | "strong";

const imageMaskClassNames: Record<SensitiveImageMaskIntensity, string> = {
  soft: "scale-[1.015] blur-[4px] saturate-90",
  strong: "scale-[1.05] blur-[18px] saturate-45 brightness-65 contrast-80",
};

const overlayClassNames: Record<SensitiveImageMaskIntensity, string> = {
  soft: "bg-white/10 backdrop-blur-[2px] dark:bg-slate-950/18",
  strong: "bg-white/34 backdrop-blur-[8px] dark:bg-slate-950/56",
};

export function sensitiveImageClassName(
  masked: boolean,
  className: string,
  intensity: SensitiveImageMaskIntensity = "soft",
): string {
  return masked ? `${className} ${imageMaskClassNames[intensity]}` : className;
}

export function SensitiveImageOverlay({
  masked,
  label,
  intensity = "soft",
}: {
  masked: boolean;
  label: string;
  intensity?: SensitiveImageMaskIntensity;
}) {
  if (!masked) {
    return null;
  }

  return (
    <div className={`pointer-events-none absolute inset-0 flex items-center justify-center ${overlayClassNames[intensity]}`}>
      <span
        role="img"
        aria-label={label}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/64 text-slate-700 shadow-sm dark:border-slate-600/80 dark:bg-slate-950/64 dark:text-slate-100"
      >
        <EyeOff size={16} aria-hidden="true" />
      </span>
    </div>
  );
}
