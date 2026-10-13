#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  (2026-06 fork) Analitik toko (pengunjung + rekap penjualan otomatis), etalase gaya Shopee
  (Terjual X / Dilihat X, harga diskon dicoret), sistem voucher diskon (per-produk + kode voucher
  di checkout), dan pembersihan sisa kode kurir manual lama (ongkir_manual).

backend:
  - task: "Hapus sisa kode kurir manual (ongkir_manual)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        message: "Dihapus: GET /api/ongkir, GET/POST/PUT/DELETE /api/admin/ongkir, model OngkirIn, index ongkir_manual, seed tarif contoh. Checkout sudah pakai /api/shipping/rates (Biteship). Pastikan tidak ada regresi pada rates & create_order."
      - working: true
        agent: "testing"
        message: "iter33: Semua endpoint /api/ongkir dan /api/admin/ongkir mengembalikan 404 sesuai harapan. /api/shipping/rates masih wired (Biteship) dan POST /api/orders masih berjalan normal (uji voucher+diskon mendapat 200)."
  - task: "Diskon per-produk (harga_diskon) + serializer harga_final/diskon_persen/terjual/views"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        message: "ProductIn + product_public: harga_diskon, harga_final, diskon_persen. terjual via _sold_map (hanya order status 'selesai'). views dari product doc. create_order pakai _effective_price."
      - working: true
        agent: "testing"
        message: "iter33: PUT harga 100000 + harga_diskon 80000 -> harga_final=80000, diskon_persen=20. harga_diskon>=harga diabaikan (harga_final=100000, diskon_persen=0, harga_diskon null). GET /products dan /products/{id} konsisten memuat terjual, views, harga_final, diskon_persen, harga_diskon."
  - task: "Tracking view produk (POST /api/products/{id}/view, login & tamu)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        message: "Endpoint publik, increment products.views + insert product_views."
      - working: true
        agent: "testing"
        message: "iter33: Guest (tanpa Authorization) dan buyer login dua-duanya menaikkan views; GET produk setelahnya memperlihatkan kenaikan >=2. Analytics memperbarui total_dilihat, pengunjung_login (distinct), dan pengunjung_terbaru[]."
  - task: "Voucher CRUD + validate + apply di order"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        message: "GET/POST/PUT/DELETE /api/admin/vouchers; POST /api/voucher/validate; create_order terima voucher_code."
      - working: true
        agent: "testing"
        message: "iter33: Validasi CRUD lolos — kode kosong -> 400, nilai<=0 -> 400, persen>100 -> 400, duplikat -> 409. /voucher/validate: persen 10% dari 160000 -> 16000; nominal capped ke subtotal; min_belanja tidak terpenuhi -> valid false; aktif=false -> false; kadaluarsa 2000-01-01 -> false. Order 2x(harga_diskon 80000) + voucher 10% -> subtotal 160000, voucher_diskon 16000, ongkir 20000, total 164000. terpakai++ dan kuota=1 habis -> order kedua ditolak 400."
  - task: "Analitik toko (rekap penjualan + pengunjung + terlaris) + platform fee settings"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        message: "GET /api/admin/analytics + GET/PUT /api/admin/platform-settings."
      - working: true
        agent: "testing"
        message: "iter33: /admin/analytics berisi semua field yang diminta (pesanan_selesai, unit_terjual, pendapatan_kotor/bersih, ongkir_total, voucher_total, platform_fee_percent, platform_fee, produk_terlaris[], total_dilihat, pengunjung_login, pengunjung_terbaru[]). /admin/platform-settings clamp 200->100, -5->0, set 5 OK. Admin-only: tanpa token 403, buyer token 403."

frontend:
  - task: "Etalase & detail produk gaya Shopee (diskon dicoret, Terjual/Dilihat)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/toko.tsx, /app/frontend/app/produk/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        message: "Kartu etalase: badge -X%, harga diskon + harga normal dicoret, 'Terjual X · Dilihat Y'. Detail: harga diskon+coret+tag %, terjual/dilihat, POST view saat buka, add-to-cart pakai harga_final. Screenshot storefront sudah menampilkan -20% + Terjual 3 · Dilihat 2."
  - task: "Form produk admin: field Harga Diskon"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/product-form.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        message: "Field 'Harga Diskon (opsional)' + hint persen + validasi harus < harga normal. Kirim harga_diskon (null jika kosong)."
  - task: "Checkout: input kode voucher + ringkasan diskon"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/checkout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        message: "Step 3: kartu Voucher (input + Pakai -> /api/voucher/validate), chip applied + Hapus, SummaryRow 'Diskon Voucher', total dikurangi. Kirim voucher_code ke /api/orders."
  - task: "Dashboard Analitik Toko (layar baru) + drawer/shortcut"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/dashboard/analitik.tsx, /app/frontend/app/dashboard/_layout.tsx, /app/frontend/app/dashboard/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        message: "Layar /dashboard/analitik: kartu Pendapatan Bersih, grid rekap, pengunjung, produk terlaris (bar), aktivitas pengunjung terbaru. Drawer 'Analitik Toko' + shortcut di dashboard."
  - task: "Dashboard Voucher Diskon (CRUD) + drawer/shortcut"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/dashboard/voucher.tsx, /app/frontend/app/dashboard/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        message: "Layar /dashboard/voucher: list + FAB + modal (kode, tipe persen/nominal, nilai, min belanja, kuota, kadaluarsa, aktif) + hapus (ConfirmDialog). Drawer 'Voucher Diskon' + shortcut."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Diskon per-produk (harga_diskon) + serializer harga_final/diskon_persen/terjual/views"
    - "Voucher CRUD + validate + apply di order"
    - "Analitik toko (rekap penjualan + pengunjung + terlaris) + platform fee settings"
    - "Tracking view produk (POST /api/products/{id}/view, login & tamu)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: "Mohon test BACKEND dulu untuk fitur baru: (1) produk diskon (harga_final/diskon_persen/terjual/views), (2) view tracking login & tamu, (3) voucher CRUD + validate + apply di /api/orders (termasuk kuota habis, min belanja, kadaluarsa, persen>100 ditolak), (4) analitik (rekap hanya status 'selesai', pendapatan_bersih), (5) pastikan /api/ongkir & /api/admin/ongkir sudah 404 (dihapus) tanpa merusak /api/shipping/rates & create_order. Kredensial admin: admin/admin123, buyer: buyer/buyer123. Setelah backend lolos, lanjut frontend."
  - agent: "testing"
    message: "iter33 BACKEND SELESAI — 20/20 pytest lulus (/app/backend/tests/test_iter33_discount_voucher_analytics.py, laporan di /app/test_reports/pytest/pytest_iter33.xml). Fitur yang diverifikasi: diskon per-produk, view tracking (guest+login), voucher CRUD+validate (persen 10% dari 160000 = 16000, nominal capped, min_belanja/aktif/kadaluarsa/kuota tolak), order dengan diskon+voucher (subtotal 160000 - voucher 16000 + ongkir 20000 = total 164000), analytics (semua field hadir, hanya hitung status 'selesai'), platform-settings (clamp 0..100), /api/ongkir & /api/admin/ongkir semua 404, /api/shipping/rates masih wired, admin endpoint 401/403 saat tanpa/buyer token. Password admin tetap admin123. Frontend tidak diuji sesuai permintaan."
  - agent: "testing"
    message: "iter34 FRONTEND SELESAI — 7/7 flow lulus di mobile viewport 390x844 (laporan di /app/test_reports/iteration_34.json). (1) /toko: badge -20%, Rp 71.200 + Rp 89.000 coret, 'Terjual 3 · Dilihat 2' untuk Blouse Katun Premium. (2) /produk/[id]: diskon+coret+tag %, '3 terjual · 2 dilihat', POST /api/products/{id}/view ditembak saat buka, Beli Sekarang Rp 71.200. (3) Checkout voucher: Biteship Gojek Instant Rp 38.000 muncul, HEMATTEST 15% valid -> potongan Rp 10.680, 'Diskon Voucher (HEMATTEST)' di ringkasan, total Rp 109.200 -> Rp 98.520; kode invalid -> 'Kode voucher tidak ditemukan'. (4) Drawer admin: 'Analitik Toko' ✅, 'Voucher Diskon' ✅, 'Ongkir Manual' ❌ (tidak ada). (5) /dashboard/analitik: Pendapatan Bersih + grid rekap + Pengunjung Toko + Produk Terlaris + Aktivitas Pengunjung Terbaru render tanpa crash. (6) /dashboard/voucher: list + FAB + modal create (HEMATTEST persen 10 aktif) + edit (15%) + delete (ConfirmDialog) sukses. (7) /product-form edit: field 'Harga Diskon (opsional)' + hint 'Diskon 44% — harga normal dicoret' saat ketik 50000 vs harga 89000. Tidak ada crash/red screen/console error. Semua 5 task frontend NA bisa di-set working:true."
