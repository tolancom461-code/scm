/** Display only: keep every significant decimal digit without numeric rounding. */
export function trimDecimal(value: string | number): string {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
export function formatPercent(value: string | number): string {
  return `${trimDecimal(value)}%`;
}
