// 设置页可折叠模块容器：点击展开/收起，activitySignal 变化时自动展开。

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ChevronDown } from "lucide-react";

import { actionButtonClassNameForAppearance, type LayoutActionAppearance } from "../../../components/layoutActionButtons";
import { PANEL_CLASS, SETTINGS_BORDERED_MODULE_CLASS } from "./styles";

export function SettingsCollapsibleModule({
  appearance,
  title,
  description,
  activitySignal,
  children,
}: {
  appearance: LayoutActionAppearance;
  title: string;
  description: string;
  activitySignal?: string;
  children: ReactNode;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const previousActivitySignal = useRef(activitySignal);

  useEffect(() => {
    if (activitySignal === previousActivitySignal.current) {
      return;
    }
    previousActivitySignal.current = activitySignal;
    if (activitySignal) {
      setOpen(true);
    }
  }, [activitySignal]);

  const toggleButtonClassName = actionButtonClassNameForAppearance(appearance, {
    preset: "secondary",
    size: "md",
    fullWidth: true,
    className:
      "h-auto min-h-0 items-start justify-start gap-3 rounded-none border-x-0 border-t-0 px-4 py-4 text-left shadow-none sm:px-5 sm:py-5",
  });
  const iconClassName = actionButtonClassNameForAppearance(appearance, {
    preset: open ? "primary" : "secondary",
    size: "icon-sm",
    className: "pointer-events-none mt-0.5 shrink-0",
  });

  return (
    <section className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} overflow-hidden p-0`}>
      <button
        type="button"
        aria-expanded={open}
        aria-pressed={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className={toggleButtonClassName}
      >
        <span className={iconClassName}>
          <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-slate-950 dark:text-white">{title}</span>
          <span className="mt-1 block text-sm leading-6 text-slate-500 dark:text-slate-400">
            {description}
          </span>
        </span>
      </button>
      {open ? (
        <div id={contentId} className="space-y-4 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
