import { ClassicTextarea } from "../../components/classicInputs";
import { WorkspaceTextarea } from "../../components/workspaceInputs";

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  maxRows?: number;
  placeholder?: string;
  onBlur?: () => void;
  workspaceSubpage?: boolean;
}

export function TextArea({
  label,
  value,
  onChange,
  minRows = 2,
  maxRows,
  placeholder,
  onBlur,
  workspaceSubpage = false,
}: TextAreaProps) {
  const LayoutTextarea = workspaceSubpage ? WorkspaceTextarea : ClassicTextarea;

  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-slate-400">
        {label}
      </span>
      <LayoutTextarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        size="compact"
        autosize
        minRows={minRows}
        maxRows={maxRows}
      />
    </label>
  );
}
