export function formatRupiah(value: number): string {
  const n = Math.round(value || 0);
  return "Rp " + n.toLocaleString("id-ID");
}
