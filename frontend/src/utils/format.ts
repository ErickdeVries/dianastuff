export function formatRupiah(value: number): string {
  const n = Math.round(value || 0);
  return "Rp " + n.toLocaleString("id-ID");
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

// Tanggal dalam format dd/mm/yyyy.
export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Tanggal + jam dalam format dd/mm/yyyy HH:mm.
export function formatDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
