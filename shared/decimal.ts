/** Exact fixed point, six decimal places. API values must be strings. */
const SCALE = 1_000_000n;
export function decimal(value: string): bigint {
  if (!/^-?\d{1,18}(\.\d{1,6})?$/.test(value))
    throw new Error("INVALID_DECIMAL");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -result : result;
}
export function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("INVALID_DIVISOR");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const result = (absolute + denominator / 2n) / denominator;
  return negative ? -result : result;
}
export function formatDecimal(value: bigint, places = 2): string {
  if (!Number.isInteger(places) || places < 0 || places > 6)
    throw new Error("INVALID_PRECISION");
  const unit = 10n ** BigInt(6 - places);
  const rounded = roundedDivide(value, unit);
  const absolute = rounded < 0n ? -rounded : rounded;
  const digits = absolute.toString().padStart(places + 1, "0");
  return `${rounded < 0n ? "-" : ""}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
}
export function multiply(a: bigint, b: bigint): bigint {
  return roundedDivide(a * b, SCALE);
}
