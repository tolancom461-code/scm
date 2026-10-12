export function calculateContractEndDate(currentEndDate: Date | null, extensionDays: number) {
  if (!currentEndDate || extensionDays <= 0) return currentEndDate;
  const updated = new Date(currentEndDate);
  updated.setUTCDate(updated.getUTCDate() + extensionDays);
  return updated;
}

export function calculateCertificateNetDue(currentValue: number, previousValue: number, deductions: number) {
  return currentValue - previousValue - deductions;
}
