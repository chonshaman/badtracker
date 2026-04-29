export function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function parseMoneyInput(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}
