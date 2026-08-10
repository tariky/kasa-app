import * as React from 'react';

import { Input } from '@/components/ui/input';
import { parseDecimal } from '@/lib/utils';

interface DecimalInputProps
  extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'inputMode'> {
  /** Trenutna vrijednost — string iz forme ili broj iz state-a. */
  value: string | number;
  /**
   * Poziva se pri svakoj izmjeni sa sanitizovanim tekstom (može sadržavati
   * zarez) i parsiranom numeričkom vrijednošću (NaN dok je unos nepotpun).
   */
  onValueChange: (text: string, value: number) => void;
  /** Maksimalan broj decimala (default 2). */
  maxDecimals?: number;
}

function sanitize(raw: string, maxDecimals: number): string {
  let out = '';
  let separatorSeen = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if ((ch === ',' || ch === '.') && !separatorSeen) {
      out += ch;
      separatorSeen = true;
    }
  }
  const sepIdx = out.search(/[.,]/);
  if (sepIdx >= 0) out = out.slice(0, sepIdx + 1 + maxDecimals);
  return out;
}

/**
 * Unos decimalnih vrijednosti (cijene, količine) koji prihvata i zarez i
 * tačku kao decimalni separator. Nevažeći karakteri se odbacuju u toku
 * kucanja, a dozvoljen je samo jedan separator.
 */
const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ value, onValueChange, maxDecimals = 2, onBlur, ...props }, ref) => {
    // Dok korisnik kuca, prikazuje se njegov tekst (draft) — inače bi
    // roditelj koji drži broj u state-u obrisao "12," na "12".
    const [draft, setDraft] = React.useState<string | null>(null);

    // Ako roditelj promijeni vrijednost mimo drafta (npr. klampovanje
    // rabata na 100), draft se odbacuje da prikaz ne ostane desinhronizovan.
    React.useEffect(() => {
      if (draft == null) return;
      if (typeof value === 'string') {
        if (draft !== value) setDraft(null);
        return;
      }
      const parsed = parseDecimal(draft);
      const matches = isNaN(parsed) ? value === 0 : parsed === value;
      if (!matches) setDraft(null);
    }, [value, draft]);

    const display =
      draft ??
      (value === '' || value == null || (typeof value === 'number' && isNaN(value))
        ? ''
        : String(value).replace('.', ','));

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => {
          const text = sanitize(e.target.value, maxDecimals);
          setDraft(text);
          onValueChange(text, parseDecimal(text));
        }}
        onBlur={(e) => {
          setDraft(null);
          onBlur?.(e);
        }}
      />
    );
  }
);
DecimalInput.displayName = 'DecimalInput';

export { DecimalInput };
