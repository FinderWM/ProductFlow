import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";

interface MediaPreviewTriggerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onClick"> {
  children: ReactNode;
  onPreview: () => void;
  stopPropagation?: boolean;
}

export function MediaPreviewTrigger({
  children,
  onPreview,
  stopPropagation = false,
  className,
  onKeyDown,
  role = "button",
  tabIndex = 0,
  ...props
}: MediaPreviewTriggerProps) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    onPreview();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (stopPropagation) {
        event.stopPropagation();
      }
      onPreview();
    }
  };

  return (
    <div
      role={role}
      tabIndex={tabIndex}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        "cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
