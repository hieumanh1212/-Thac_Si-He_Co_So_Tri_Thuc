/**
 * THEO DÕI HẠN MỨC (QUOTA) GEMINI FREE TIER
 * ----------------------------------------------------------------------------
 * Gemini API KHÔNG trả về số quota còn lại trong response. Vì vậy hệ thống:
 *   1. Tự đếm số yêu cầu & token đã gửi từ máy chủ này
 *      (quota ngày của Google reset lúc 0h giờ Thái Bình Dương - America/Los_Angeles)
 *   2. Lấy giới hạn từ .env (GEMINI_RPD_LIMIT / GEMINI_RPM_LIMIT),
 *      hoặc tự "học" giới hạn từ lỗi 429 (Google trả kèm quotaValue).
 * Số liệu là ƯỚC TÍNH: không tính các yêu cầu dùng cùng key từ ứng dụng khác.
 */

const fs = require('node:fs');
const path = require('node:path');
const { layMang, docJSON, soNguyenDuong } = require('./tien_ich.js');

const FILE_HAN_MUC = path.join(__dirname, '..', '.ai_usage.json');
const CUA_SO_PHUT_MS = 60 * 1000;
const MUI_GIO_RESET = 'America/Los_Angeles';

let trangThai = null;
const mocYeuCauGanDay = [];

// ---------------------------------------------------------------------------
// Lưu trữ trạng thái
// ---------------------------------------------------------------------------

function ngayTheoGioReset(ngay = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MUI_GIO_RESET, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ngay);
}

function taoTrangThaiMoi() {
  return { ngay: ngayTheoGioReset(), soYeuCau: 0, soToken: 0, cham429: null, gioiHanHocDuoc: {} };
}

function taiTrangThai() {
  if (trangThai) return trangThai;
  const noiDung = fs.existsSync(FILE_HAN_MUC) ? fs.readFileSync(FILE_HAN_MUC, 'utf8') : '';
  const duLieu = docJSON(noiDung, null);
  trangThai = duLieu && duLieu.ngay ? { ...taoTrangThaiMoi(), ...duLieu } : taoTrangThaiMoi();
  return trangThai;
}

function luuTrangThai() {
  try {
    fs.writeFileSync(FILE_HAN_MUC, JSON.stringify(trangThai, null, 2));
  } catch (e) {
    console.warn('[AI] Không ghi được file hạn mức:', e.message);
  }
}

// Sang ngày mới (theo giờ Thái Bình Dương) -> reset bộ đếm ngày
function trangThaiHomNay() {
  const tt = taiTrangThai();
  const homNay = ngayTheoGioReset();
  if (tt.ngay !== homNay) {
    Object.assign(tt, { ngay: homNay, soYeuCau: 0, soToken: 0, cham429: null });
    luuTrangThai();
  }
  return tt;
}

function donMocCu(bayGio) {
  while (mocYeuCauGanDay.length > 0 && bayGio - mocYeuCauGanDay[0] > CUA_SO_PHUT_MS) {
    mocYeuCauGanDay.shift();
  }
}

// ---------------------------------------------------------------------------
// Ghi nhận sử dụng
// ---------------------------------------------------------------------------

function ghiNhanYeuCau(soToken) {
  const tt = trangThaiHomNay();
  tt.soYeuCau += 1;
  tt.soToken += Number(soToken) || 0;
  mocYeuCauGanDay.push(Date.now());
  luuTrangThai();
}

function phanLoaiHanMuc(quotaId) {
  const id = String(quotaId || '');
  if (/token/i.test(id)) return 'token';
  if (/PerDay/i.test(id)) return 'ngay';
  if (/PerMinute/i.test(id)) return 'phut';
  return 'khac';
}

function docChiTiet429(loiJson) {
  const chiTiet = layMang(loiJson && loiJson.error && loiJson.error.details);
  const quota = chiTiet.find(d => String(d['@type']).includes('QuotaFailure')) || {};
  const thuLai = chiTiet.find(d => String(d['@type']).includes('RetryInfo')) || {};
  const viPham = layMang(quota.violations)[0] || {};
  return {
    loai: phanLoaiHanMuc(viPham.quotaId),
    gioiHan: soNguyenDuong(viPham.quotaValue),
    thuLaiSauGiay: Number.parseFloat(thuLai.retryDelay) || null,
    quotaId: viPham.quotaId || ''
  };
}

function ghiNhan429(loiJson) {
  const tt = trangThaiHomNay();
  const chiTiet = docChiTiet429(loiJson);
  tt.cham429 = { ...chiTiet, luc: new Date().toISOString() };
  if (chiTiet.gioiHan && ['ngay', 'phut'].includes(chiTiet.loai)) {
    tt.gioiHanHocDuoc[chiTiet.loai] = chiTiet.gioiHan;
  }
  luuTrangThai();
  return chiTiet;
}

// ---------------------------------------------------------------------------
// Báo cáo cho giao diện
// ---------------------------------------------------------------------------

function thoiDiemResetTiepTheo(bayGio = new Date()) {
  const phan = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: MUI_GIO_RESET, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(bayGio).map(p => [p.type, p.value]));
  const soGiayDaQua = (Number(phan.hour) % 24) * 3600 + Number(phan.minute) * 60 + Number(phan.second);
  return new Date(bayGio.getTime() + (86400 - soGiayDaQua) * 1000);
}

function taoDongHanMuc(daDung, gioiHan) {
  return {
    daDung,
    gioiHan: gioiHan || null,
    conLai: gioiHan ? Math.max(0, gioiHan - daDung) : null
  };
}

// Google đã báo hết quota NGÀY -> chắc chắn còn 0 (bộ đếm cục bộ có thể thấp hơn thực tế)
function apDungHetHanMucNgay(dong, tt) {
  if (!tt.cham429 || tt.cham429.loai !== 'ngay') return dong;
  return { ...dong, conLai: 0, daHet: true };
}

function xacDinhNguonGioiHan(cauHinh, tt) {
  if (cauHinh.gioiHanNgay) return 'cau_hinh';
  return tt.gioiHanHocDuoc.ngay ? 'hoc_tu_429' : 'chua_co';
}

function layBaoCaoHanMuc(cauHinh) {
  if (cauHinh.nhaCungCap !== 'gemini') {
    return { nhaCungCap: cauHinh.nhaCungCap, model: cauHinh.model, khongGioiHan: true };
  }
  const tt = trangThaiHomNay();
  donMocCu(Date.now());
  return {
    nhaCungCap: 'gemini',
    model: cauHinh.model,
    khongGioiHan: false,
    ngay: apDungHetHanMucNgay(taoDongHanMuc(tt.soYeuCau, cauHinh.gioiHanNgay || tt.gioiHanHocDuoc.ngay), tt),
    phut: taoDongHanMuc(mocYeuCauGanDay.length, cauHinh.gioiHanPhut || tt.gioiHanHocDuoc.phut),
    tokenHomNay: tt.soToken,
    cham429: tt.cham429,
    nguonGioiHan: xacDinhNguonGioiHan(cauHinh, tt),
    resetLuc: thoiDiemResetTiepTheo().toISOString()
  };
}

module.exports = { ghiNhanYeuCau, ghiNhan429, layBaoCaoHanMuc };
