// 设置页可折叠模块容器：点击展开/收起，activitySignal 变化时自动展开。

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ChevronDown } from "lucide-react";

import { PANEL_CLASS, SETTINGS_BORDERED_MODULE_CLASS } from "./styles";

export function SettingsCollapsibleModule({
  title,
  description,
  activitySignal,
  children,
}: {
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

  return (
    <section className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} overflow-hidden p-0`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="group flex w-full items-start gap-3 p-4 text-left outline-none transition-colors hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-indigo-500/25 dark:hover:bg-slate-800/20 dark:focus-visible:ring-violet-400/25 sm:p-5"
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition-colors group-hover:border-slate-300 group-hover:bg-white dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300 dark:group-hover:border-slate-600 dark:group-hover:bg-[#15233a]">
          <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-slate-950 dark:text-white">{title}</span>
          <span className="mt-1 block text-sm leading-6 text-slate-500 dark:text-slate-400">
            {description}
          </span>
        </span>
      </button>
      {open ? (
        <div id={contentId} className="space-y-4 border-t border-slate-200 px-4 pb-4 pt-4 dark:border-slate-800 sm:px-5 sm:pb-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
