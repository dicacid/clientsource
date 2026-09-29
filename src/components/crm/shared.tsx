import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { label } from "@/lib/constants";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  new: "bg-muted text-muted-foreground",
  researching: "bg-chart-2/15 text-chart-2",
  contacted: "bg-chart-2/15 text-chart-2",
  engaged: "bg-chart-3/15 text-chart-3",
  meeting: "bg-chart-3/15 text-chart-3",
  qualified: "bg-chart-4/15 text-chart-4",
  customer: "bg-primary/15 text-primary",
  lost: "bg-destructive/15 text-destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex rounded px-2 py-0.5 font-mono text-[11px] uppercase", TONE[status] ?? TONE.new)}>
      {label(status)}
    </span>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ConfirmDelete({
  trigger,
  title,
  description,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void onConfirm()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ANY = "__any__";
export function OptionSelect({
  value,
  onChange,
  options,
  placeholder,
  allowAny,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  allowAny?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value === "" && allowAny ? ANY : value || undefined} onValueChange={(v) => onChange(v === ANY ? "" : v)}>
      <SelectTrigger className={className} aria-label={ariaLabel ?? placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAny && <SelectItem value={ANY}>{placeholder ?? "Any"}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
