/**
 * ============================================================================
 * TRÌNH KHỞI ĐỘNG MỘT CHẠM (MED-EXPERT)
 * ============================================================================
 * Được gọi bởi start.bat. Tự động:
 *   1. Kiểm tra phiên bản Node.js (cần >= 22.13 để dùng node:sqlite không cần cờ)
 *   2. Kiểm tra / tạo file .env từ .env.example
 *   3. Nếu máy chủ đã chạy sẵn -> chỉ mở trình duyệt
 *   4. Ngược lại -> khởi động may_chu.js, chờ sẵn sàng, mở trình duyệt
 *   5. Báo trạng thái CSDL & Trợ lý AI
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { exec } = require('node:child_process');

const THU_MUC = __dirname;
const ENV_PATH = path.join(THU_MUC, '.env');
const ENV_MAU_PATH = path.join(THU_MUC, '.env.example');

// ---------------------------------------------------------------------------
// 1. KIỂM TRA MÔI TRƯỜNG
// ---------------------------------------------------------------------------

function kiemTraPhienBanNode() {
  const [chinh, phu] = process.versions.node.split('.').map(Number);
  const hopLe = chinh > 22 || (chinh === 22 && phu >= 13);
  if (!hopLe) {
    console.error(`[LỖI] Node.js ${process.versions.node} quá cũ. Cần Node.js 22.13 trở lên (khuyến nghị bản LTS mới nhất).`);
    console.error('      Tải tại: https://nodejs.org');
    process.exit(1);
  }
  console.log(`[OK] Node.js ${process.versions.node}`);
}

function chuanBiFileEnv() {
  if (fs.existsSync(ENV_PATH)) {
    process.loadEnvFile(ENV_PATH);
    console.log('[OK] Đã nạp cấu hình .env');
    return;
  }
  if (fs.existsSync(ENV_MAU_PATH)) {
    fs.copyFileSync(ENV_MAU_PATH, ENV_PATH);
    console.warn('[!] Chưa có file .env -> đã tạo từ .env.example.');
    console.warn('    Trợ lý AI sẽ chưa hoạt động cho đến khi bạn điền GEMINI_API_KEY vào file .env rồi chạy lại.');
    process.loadEnvFile(ENV_PATH);
    return;
  }
  console.warn('[!] Không có file .env. Hệ thống vẫn chạy, nhưng Trợ lý AI sẽ không hoạt động.');
}

// ---------------------------------------------------------------------------
// 2. KIỂM TRA CỔNG & MÁY CHỦ
// ---------------------------------------------------------------------------

function congDangBan(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function docTrangThai(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

async function choMayChuSanSang(baseUrl, soLanThu = 40) {
  for (let i = 0; i < soLanThu; i++) {
    const trangThai = await docTrangThai(`${baseUrl}/api/trang_thai`);
    if (trangThai && trangThai.ok) return trangThai;
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. MỞ TRÌNH DUYỆT & BÁO TRẠNG THÁI
// ---------------------------------------------------------------------------

function moTrinhDuyet(url) {
  const lenh = {
    win32: `start "" "${url}"`,
    darwin: `open "${url}"`
  }[process.platform] || `xdg-open "${url}"`;
  exec(lenh, (err) => {
    if (err) console.warn(`[!] Không tự mở được trình duyệt. Hãy mở thủ công: ${url}`);
  });
}

async function baoTrangThaiAI(baseUrl) {
  const ai = await docTrangThai(`${baseUrl}/api/ai/trang_thai`);
  if (ai && ai.ok) {
    console.log(`[OK] Trợ lý AI sẵn sàng: ${ai.nhaCungCap} / ${ai.model}`);
    return;
  }
  console.warn(`[!] Trợ lý AI chưa sẵn sàng: ${(ai && ai.loi) || 'không đọc được trạng thái'}`);
}

function inHuongDanDung(baseUrl) {
  console.log('');
  console.log('================================================================');
  console.log(`  HỆ THỐNG ĐANG CHẠY TẠI: ${baseUrl}`);
  console.log('  Giữ cửa sổ này mở trong khi sử dụng.');
  console.log('  Để TẮT hệ thống: nhấn Ctrl + C (hoặc đóng cửa sổ này).');
  console.log('================================================================');
}

// Cổng đã bận: là máy chủ của hệ thống (bản mới / bản cũ) hay chương trình khác?
async function xuLyMayChuDangChay(baseUrl, port) {
  const trangThai = await docTrangThai(`${baseUrl}/api/trang_thai`);
  if (!trangThai || !trangThai.ok) {
    console.error(`[LỖI] Cổng ${port} đang bị một chương trình khác sử dụng.`);
    console.error('      Hãy tắt chương trình đó, hoặc đặt PORT=3001 trong file .env rồi chạy lại.');
    process.exit(1);
  }
  // Máy chủ khởi động từ phiên bản cũ sẽ không có API hạn mức AI
  const hanMuc = await docTrangThai(`${baseUrl}/api/ai/han_muc`);
  if (!hanMuc || !hanMuc.ok) {
    console.error('[LỖI] Đang có một máy chủ PHIÊN BẢN CŨ chạy sẵn (khởi động trước khi cập nhật code).');
    console.error('      Hãy đóng cửa sổ máy chủ cũ (hoặc nhấn Ctrl + C trong cửa sổ đó) rồi bấm lại start.bat.');
    process.exit(1);
  }
  console.log(`[OK] Máy chủ đã chạy sẵn tại ${baseUrl} -> chỉ mở trình duyệt.`);
  moTrinhDuyet(baseUrl);
}

// ---------------------------------------------------------------------------
// 4. LUỒNG CHÍNH
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== KHỞI ĐỘNG HỆ CƠ SỞ TRI THỨC Y TẾ (MED-EXPERT) ===');
  kiemTraPhienBanNode();
  chuanBiFileEnv();

  const port = Number(process.env.PORT) || 3000;
  const baseUrl = `http://localhost:${port}`;

  if (await congDangBan(port)) {
    await xuLyMayChuDangChay(baseUrl, port);
    return;
  }

  console.log('[..] Đang khởi động máy chủ...');
  require('./may_chu.js');

  const trangThai = await choMayChuSanSang(baseUrl);
  if (!trangThai) {
    console.error('[LỖI] Máy chủ không phản hồi sau 10 giây. Xem thông báo lỗi phía trên.');
    process.exit(1);
  }
  console.log(`[OK] CSDL SQLite: ${trangThai.counts.tap_luat} luật, ${trangThai.counts.trieu_chung} triệu chứng, ${trangThai.counts.danh_muc_benh} bệnh`);
  await baoTrangThaiAI(baseUrl);
  moTrinhDuyet(baseUrl);
  inHuongDanDung(baseUrl);
}

main().catch((e) => {
  console.error('[LỖI] Không khởi động được hệ thống:', e.message);
  process.exit(1);
});
