import * as React from "react"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const pad = (n: string | number) => String(n).padStart(2, "0")

/** "YYYY-MM-DDTHH:mm" → dijelovi (local, bez TZ pomaka) */
function parseValue(value?: string): { date?: Date; hh: string; mm: string } {
  if (!value) return { hh: "", mm: "" }
  const [datePart, timePart = ""] = value.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  const date = y && m && d ? new Date(y, m - 1, d) : undefined
  const [hh = "", mm = ""] = timePart.split(":")
  return { date: date && !isNaN(date.getTime()) ? date : undefined, hh, mm }
}

function compose(date: Date, hh: string, mm: string): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hh || 0)}:${pad(mm || 0)}`
}

function fmtDate(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}.`
}

function clampDigits(raw: string, max: number): string {
  const digits = raw.replace(/\D/g, "").slice(0, 2)
  if (digits === "") return ""
  return Number(digits) > max ? String(max) : digits
}

interface DateTimePickerProps {
  /** "YYYY-MM-DDTHH:mm" ili "" */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}

/**
 * Datum i vrijeme kao jedna vrijednost: dan se bira iz kalendara u Popoveru,
 * sat i minuta se kucaju u dva mono polja pored njega.
 *
 * Vrijeme namjerno stoji izvan Popovera — pri prepisivanju računa se čita sa
 * papira pa mora biti vidljivo i dostupno bez otvaranja ičega.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "Odaberite datum",
  disabled,
  className,
  id,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const parsed = parseValue(value)

  // Draft drži otkucano ("9" ostaje "9" dok korisnik ne završi) — bez njega bi
  // popunjavanje nulama u `compose` prekidalo kucanje na svakoj cifri.
  const [hh, setHh] = React.useState(parsed.hh)
  const [mm, setMm] = React.useState(parsed.mm)
  const mmRef = React.useRef<HTMLInputElement>(null)
  const lastEmitted = React.useRef(value)

  // Resinhronizacija samo kad vrijednost stigne izvana (npr. reset forme);
  // vlastite emisije ne smiju pregaziti draft.
  React.useEffect(() => {
    if (value === lastEmitted.current) return
    const p = parseValue(value)
    setHh(p.hh)
    setMm(p.mm)
  }, [value])

  const emit = (date: Date | undefined, nextHh: string, nextMm: string) => {
    const next = compose(date ?? new Date(), nextHh, nextMm)
    lastEmitted.current = next
    onChange(next)
  }

  const setNow = () => {
    const now = new Date()
    setHh(pad(now.getHours()))
    setMm(pad(now.getMinutes()))
    emit(now, String(now.getHours()), String(now.getMinutes()))
    setOpen(false)
  }

  const timeInput = (
    which: "hh" | "mm",
    val: string,
    max: number,
    label: string,
    ref?: React.Ref<HTMLInputElement>
  ) => (
    <Input
      ref={ref}
      aria-label={label}
      value={val}
      disabled={disabled}
      inputMode="numeric"
      maxLength={2}
      placeholder="00"
      className="h-full w-11 px-0 text-center font-mono text-[13px] tabular-nums"
      onChange={(e) => {
        const next = clampDigits(e.target.value, max)
        if (which === "hh") {
          setHh(next)
          emit(parsed.date, next, mm)
          if (next.length === 2) mmRef.current?.select()
        } else {
          setMm(next)
          emit(parsed.date, hh, next)
        }
      }}
      onBlur={() => {
        if (which === "hh") setHh((h) => (h ? pad(h) : h))
        else setMm((m) => (m ? pad(m) : m))
      }}
    />
  )

  return (
    <div className={cn("flex items-stretch gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("h-full flex-1 justify-start font-normal", !parsed.date && "text-muted-foreground")}
          >
            <CalendarIcon size={14} className="mr-2 shrink-0 text-slate-400" />
            <span className="font-mono tabular-nums">
              {parsed.date ? fmtDate(parsed.date) : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            defaultMonth={parsed.date}
            selected={parsed.date}
            onSelect={(day) => {
              if (day) {
                emit(day, hh, mm)
                setOpen(false)
              }
            }}
          />
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={setNow}
              className="h-8 w-full text-[12px] text-slate-500"
            >
              Danas, sada
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-stretch gap-1 rounded-md">
        {timeInput("hh", hh, 23, "Sati")}
        <span className="self-center font-mono text-slate-300">:</span>
        {timeInput("mm", mm, 59, "Minute", mmRef)}
      </div>
    </div>
  )
}
