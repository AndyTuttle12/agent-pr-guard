export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
