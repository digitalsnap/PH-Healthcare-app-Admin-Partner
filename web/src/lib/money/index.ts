/**
 * Centavo helpers. All money is integer centavos in PHP — never floats.
 * Peso amounts only exist at the edges: parsing user input and formatting.
 */

declare const centavosBrand: unique symbol;

/** A whole, non-negative number of centavos. */
export type Centavos = number & { readonly [centavosBrand]: true };

/** Every price and estimate is a range, never a single guaranteed number. */
export type MoneyRange = {
  readonly min: Centavos;
  readonly max: Centavos;
};

export const ZERO = 0 as Centavos;

export function isCentavos(value: unknown): value is Centavos {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Brands a number as centavos, rejecting fractions, negatives and unsafe integers. */
export function centavos(value: number): Centavos {
  if (!isCentavos(value)) {
    throw new RangeError("Centavos must be a non-negative safe integer");
  }
  return value;
}

const PESO_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses a peso amount typed by a person ("1,250", "1250.5", "₱1,250.50")
 * without ever going through a float.
 */
export function parsePesos(input: string): Centavos {
  const cleaned = input.trim().replace(/^₱\s*/, "").replace(/,/g, "");
  const match = PESO_INPUT.exec(cleaned);
  if (!match) {
    throw new RangeError("Not a valid peso amount");
  }
  const pesos = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return centavos(pesos * 100 + fraction);
}

/** Formats as "₱1,250.50". Built from integers, so no rounding can creep in. */
export function formatPesos(amount: Centavos): string {
  const pesos = Math.floor(amount / 100);
  const fraction = String(amount % 100).padStart(2, "0");
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₱${grouped}.${fraction}`;
}

export function add(a: Centavos, b: Centavos): Centavos {
  return centavos(a + b);
}

/** Subtracts a benefit from an amount; a benefit never pushes a cost below zero. */
export function subtractToZero(amount: Centavos, deduction: Centavos): Centavos {
  return centavos(Math.max(0, amount - deduction));
}

/**
 * Takes a share of an amount in basis points (2000 = 20%), rounding half up to
 * the nearest centavo. Uses BigInt so large amounts stay exact.
 */
export function shareOf(amount: Centavos, basisPoints: number): Centavos {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError("Basis points must be a non-negative integer");
  }
  const scaled = BigInt(amount) * BigInt(basisPoints);
  return centavos(Number((scaled + BigInt(5000)) / BigInt(10000)));
}

export function range(min: Centavos, max: Centavos): MoneyRange {
  if (max < min) {
    throw new RangeError("Range max must not be below min");
  }
  return { min, max };
}

export function addRanges(a: MoneyRange, b: MoneyRange): MoneyRange {
  return { min: add(a.min, b.min), max: add(a.max, b.max) };
}

export function formatRange(value: MoneyRange): string {
  return `${formatPesos(value.min)} – ${formatPesos(value.max)}`;
}
