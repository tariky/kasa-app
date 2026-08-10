import * as React from "react"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** "YYYY-MM-DD" → Date (local, no TZ shift) */
function parseISO(value?: string): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return undefined
  const date = new Date(y, m - 1, d)
  return isNaN(date.getTime()) ? undefined : date
}

/** Date → "YYYY-MM-DD" (local, no TZ shift) */
function toISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function fmtDisplay(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}.`
}

interface DatePickerProps {
  /** "YYYY-MM-DD" or "" */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  /** "YYYY-MM-DD" — raniji dani se ne mogu odabrati */
  minDate?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Odaberite datum",
  disabled,
  className,
  id,
  minDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseISO(value)
  const min = parseISO(minDate)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon size={14} className="mr-2 text-slate-400 shrink-0" />
          <span className="font-mono">{selected ? fmtDisplay(selected) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          defaultMonth={selected ?? min}
          selected={selected}
          startMonth={min}
          disabled={min ? { before: min } : undefined}
          onSelect={(day) => {
            if (day) {
              onChange(toISO(day))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
