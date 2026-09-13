// Shipping label print / preview helper.
//
// Builds a simple A6-ish HTML address label and hands it to expo-print, which
// opens the native print sheet on iOS/Android and the browser print dialog on
// web. Used by the admin to print an address slip to stick on the parcel.

import * as Print from "expo-print";

export type ShippingLabelData = {
  no_order: string;
  nama_toko?: string;
  toko_wa?: string;
  penerima?: string;
  wa?: string;
  alamat?: string;
  kota?: string;
  kode_pos?: string;
  kurir?: string;
  no_resi?: string | null;
  items: { nama_produk: string; qty: number }[];
};

function esc(s?: string | null): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export function buildLabelHtml(d: ShippingLabelData): string {
  const itemsRows = d.items
    .map((it) => `<tr><td>${esc(it.nama_produk)}</td><td style="text-align:right">${it.qty}x</td></tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 16px; }
    .label { border: 2px solid #A855F7; border-radius: 12px; padding: 16px; max-width: 420px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px dashed #999; padding-bottom: 8px; margin-bottom: 10px; }
    .toko { font-size: 15px; font-weight: 700; color: #A855F7; }
    .toko small { display:block; font-weight: 400; color:#555; font-size: 11px; }
    .order { font-size: 12px; color: #555; text-align: right; }
    .sec-title { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #888; margin: 10px 0 2px; }
    .name { font-size: 18px; font-weight: 700; }
    .addr { font-size: 14px; line-height: 1.4; margin-top: 2px; }
    .ship { display:flex; justify-content: space-between; margin-top: 10px; font-size: 13px; }
    .resi { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    td { padding: 2px 0; border-bottom: 1px solid #eee; }
  </style></head>
  <body>
    <div class="label">
      <div class="head">
        <div class="toko">${esc(d.nama_toko || "Diana Stuff")}${d.toko_wa ? `<small>${esc(d.toko_wa)}</small>` : ""}</div>
        <div class="order">No. Pesanan<br/><b>${esc(d.no_order)}</b></div>
      </div>
      <div class="sec-title">Penerima</div>
      <div class="name">${esc(d.penerima) || "-"}</div>
      ${d.wa ? `<div class="addr">${esc(d.wa)}</div>` : ""}
      <div class="addr">${esc(d.alamat) || "-"}</div>
      <div class="addr">${esc(d.kota)} ${esc(d.kode_pos)}</div>
      <div class="ship">
        <div>Kurir: <b>${esc(d.kurir) || "-"}</b></div>
        ${d.no_resi ? `<div>Resi: <span class="resi">${esc(d.no_resi)}</span></div>` : ""}
      </div>
      <div class="sec-title">Isi Paket</div>
      <table>${itemsRows}</table>
    </div>
  </body></html>`;
}

export async function printShippingLabel(d: ShippingLabelData): Promise<void> {
  await Print.printAsync({ html: buildLabelHtml(d) });
}
