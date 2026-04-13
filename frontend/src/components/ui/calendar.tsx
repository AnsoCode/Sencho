import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import "react-day-picker/style.css";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function CalendarChevron({ orientation }: { orientation: string }) {
  return orientation === "left" ? (
    <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
  ) : (
    <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
  );
}

export function Calendar({ className, classNames, ...props }: CalendarProps) {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex items-center justify-center h-7 relative",
        caption_label: "text-sm font-medium font-sans",
        nav: "flex items-center gap-1",
        button_previous: cn(
          "absolute left-1 inline-flex items-center justify-center",
          "h-7 w-7 rounded-md border-0 bg-transparent p-0",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          "cursor-pointer transition-colors"
        ),
        button_next: cn(
          "absolute right-1 inline-flex items-center justify-center",
          "h-7 w-7 rounded-md border-0 bg-transparent p-0",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          "cursor-pointer transition-colors"
        ),
        weekdays: "flex",
        weekday: "text-muted-foreground w-8 font-sans text-xs font-medium",
        week: "flex mt-1",
        day: "relative p-0 text-center font-mono text-sm",
        day_button: cn(
          "inline-flex items-center justify-center h-8 w-8 rounded-md",
          "font-mono text-sm tabular-nums p-0 border-0 bg-transparent",
          "cursor-pointer transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
        ),
        today: "border border-brand/40 rounded-md",
        selected: "bg-brand text-brand-foreground rounded-md hover:bg-brand hover:text-brand-foreground",
        outside: "text-muted-foreground/50",
        disabled: "text-muted-foreground/30 cursor-not-allowed",
        chevron: `${defaults.chevron} fill-muted-foreground`,
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
      }}
      {...props}
    />
  );
}
