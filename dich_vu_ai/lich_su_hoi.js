/**
 * LỊCH SỬ HỎI AI (bảng lich_su_hoi_ai trong SQLite)
 * ----------------------------------------------------------------------------
 * Tự động ghi lại MỌI lần người dùng hỏi AI (kể cả lần lỗi) để tra cứu / kiểm soát lại:
 *   - chan_doan : mô tả bệnh nhân -> triệu chứng AI trích xuất
 *   - lich_su   : câu hỏi về lịch sử chẩn đoán
 *   - tri_thuc  : câu hỏi tra cứu cơ sở tri thức
 *
 *   GET    /api/ai/lich_su_hoi        Danh sách (mới nhất trước)
 *   DELETE /api/ai/lich_su_hoi/:id    Xóa 1 bản ghi
 *   DELETE /api/ai/lich_su_hoi        Xóa toàn bộ
 */

const { layMang, catChuoi, docJSON } = require('./tien_ich.js');

const SO_BAN_GHI_TOI_DA = 500;
const LOAI_HOP_LE = ['chan_doan', 'lich_su', 'tri_thuc'];

const SQL_TAO_BANG = `
  CREATE TABLE IF NOT EXISTS lich_su_hoi_ai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thoi_gian TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    loai VARCHAR(20) NOT NULL,
    cau_hoi TEXT NOT NULL,
    tra_loi TEXT,
    tham_chieu_json TEXT,
    thanh_cong INTEGER NOT NULL DEFAULT 1,
    nha_cung_cap VARCHAR(20),
    model VARCHAR(80)
  );`;

function khoiTaoBangLichSuHoi(db) {
  if (db) db.exec(SQL_TAO_BANG);
}

// ---------------------------------------------------------------------------
// Chuyển kết quả từng loại nhiệm vụ thành { traLoi, thamChieu } để lưu
// ---------------------------------------------------------------------------

function tomTatTrichXuat(ketQua, body) {
  const tenTheoMa = new Map(layMang(body.danhMuc).map(s => [s.id, s.name]));
  const cacDong = layMang(ketQua.trieuChung).map(t =>
    `- ${t.ma} ${tenTheoMa.get(t.ma) || ''} (CF ${t.cf}, ${t.loai === 'suy_luan' ? 'AI suy luận' : 'trích dẫn'})`
  );
  const phan = [`Tóm tắt: ${ketQua.tomTat || '(không có)'}`];
  phan.push(cacDong.length ? `Triệu chứng AI trích xuất:\n${cacDong.join('\n')}` : 'AI không tìm thấy triệu chứng nào khớp tri thức.');
  if (layMang(ketQua.canhBao).length) phan.push(`Lưu ý: ${ketQua.canhBao.join('; ')}`);
  return { traLoi: phan.join('\n'), thamChieu: layMang(ketQua.trieuChung).map(t => t.ma) };
}

function taoNoiDungLuu(loai, ketQua, body) {
  if (loai === 'chan_doan') return tomTatTrichXuat(ketQua, body);
  return { traLoi: ketQua.traLoi || '', thamChieu: layMang(ketQua.thamChieu) };
}

/**
 * Ghi 1 lượt hỏi AI. Không bao giờ ném lỗi (lỗi ghi lịch sử không được làm hỏng câu trả lời).
 * @param {{ loai, body, ketQua?, loi?, cauHinh }} luot
 */
function ghiLichSuHoi(db, { loai, body, ketQua, loi, cauHinh }) {
  try {
    const cauHoi = catChuoi(body && body.cauHoi, 2000).trim();
    if (!db || !cauHoi || !LOAI_HOP_LE.includes(loai)) return;
    const noiDung = loi ? { traLoi: loi, thamChieu: [] } : taoNoiDungLuu(loai, ketQua || {}, body);
    db.prepare(`INSERT INTO lich_su_hoi_ai (loai, cau_hoi, tra_loi, tham_chieu_json, thanh_cong, nha_cung_cap, model)
      VALUES (?, ?, ?, ?, ?, ?, ?);`).run(
      loai, cauHoi, catChuoi(noiDung.traLoi, 8000), JSON.stringify(noiDung.thamChieu.slice(0, 50)),
      loi ? 0 : 1, cauHinh.nhaCungCap, cauHinh.model
    );
  } catch (e) {
    console.warn('[AI] Không ghi được lịch sử hỏi AI:', e.message);
  }
}

// ---------------------------------------------------------------------------
// API đọc / xóa
// ---------------------------------------------------------------------------

function chuyenDong(dong) {
  return {
    id: dong.id,
    thoiGian: dong.thoi_gian,
    loai: dong.loai,
    cauHoi: dong.cau_hoi,
    traLoi: dong.tra_loi || '',
    thamChieu: layMang(docJSON(dong.tham_chieu_json, [])),
    thanhCong: dong.thanh_cong === 1,
    nhaCungCap: dong.nha_cung_cap || '',
    model: dong.model || ''
  };
}

function layDanhSachLichSuHoi(db) {
  const cacDong = db.prepare(`SELECT * FROM lich_su_hoi_ai ORDER BY id DESC LIMIT ${SO_BAN_GHI_TOI_DA};`).all();
  const tong = db.prepare('SELECT count(*) AS c FROM lich_su_hoi_ai;').get().c;
  return { ok: true, tong, items: cacDong.map(chuyenDong) };
}

function xoaLichSuHoi(db, id) {
  if (id === null) {
    db.prepare('DELETE FROM lich_su_hoi_ai;').run();
    return { ok: true };
  }
  const ketQua = db.prepare('DELETE FROM lich_su_hoi_ai WHERE id = ?;').run(id);
  return ketQua.changes > 0 ? { ok: true } : { ok: false, error: `Không tìm thấy bản ghi #${id}.` };
}

function docIdTuDuongDan(pathname) {
  const phan = pathname.replace('/api/ai/lich_su_hoi', '').replace(/^\//, '');
  if (!phan) return null;
  const id = Number.parseInt(phan, 10);
  return Number.isInteger(id) ? id : Number.NaN;
}

/** Xử lý /api/ai/lich_su_hoi*. Trả về object JSON cần gửi, hoặc null nếu không khớp route. */
function xuLyApiLichSuHoi(method, pathname, db) {
  if (!pathname.startsWith('/api/ai/lich_su_hoi')) return null;
  if (!db) return { status: 503, body: { ok: false, error: 'Chưa kết nối được CSDL SQLite.' } };
  if (method === 'GET' && pathname === '/api/ai/lich_su_hoi') {
    return { status: 200, body: layDanhSachLichSuHoi(db) };
  }
  if (method !== 'DELETE') return null;
  const id = docIdTuDuongDan(pathname);
  if (Number.isNaN(id)) return { status: 400, body: { ok: false, error: 'Mã bản ghi không hợp lệ.' } };
  const ketQua = xoaLichSuHoi(db, id);
  return { status: ketQua.ok ? 200 : 404, body: ketQua };
}

module.exports = { khoiTaoBangLichSuHoi, ghiLichSuHoi, xuLyApiLichSuHoi };
