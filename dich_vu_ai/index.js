/**
 * ============================================================================
 * DỊCH VỤ TRỢ LÝ AI (MED-EXPERT) - ĐIỀU HƯỚNG API /api/ai/*
 * ============================================================================
 * Kiến trúc lai (Neuro-Symbolic): AI chỉ làm việc ở "biên" hệ thống
 * (hiểu ngôn ngữ tự nhiên & diễn giải); kết luận chẩn đoán luôn do động cơ suy diễn.
 *
 *   GET  /api/ai/trang_thai        Trạng thái cấu hình + hạn mức
 *   GET  /api/ai/han_muc           Hạn mức (quota) đã dùng / còn lại
 *   POST /api/ai/trich_xuat        #1 Mô tả bệnh nhân -> triệu chứng trong tri thức
 *   POST /api/ai/dien_giai         #1 Diễn giải kết quả động cơ suy diễn
 *   POST /api/ai/hoi_lich_su       #2 Hỏi đáp về lịch sử chẩn đoán
 *   POST /api/ai/tra_cuu_tri_thuc  #3 Tra cứu cơ sở tri thức
 *   GET/DELETE /api/ai/lich_su_hoi Lịch sử các lần hỏi AI (xem lich_su_hoi.js)
 */

const { layCauHinhAI, kiemTraCauHinh } = require('./cau_hinh.js');
const { layBaoCaoHanMuc } = require('./han_muc.js');
const { trichXuatTrieuChung, dienGiaiKetQua } = require('./nhiem_vu_chan_doan.js');
const { hoiVeLichSu, traCuuTriThuc } = require('./nhiem_vu_hoi_dap.js');
const { khoiTaoBangLichSuHoi, ghiLichSuHoi, xuLyApiLichSuHoi } = require('./lich_su_hoi.js');

// loaiLichSu: loại bản ghi trong "Lịch sử hỏi AI" (null = không ghi, vd bước diễn giải phụ)
const BANG_DIEU_HUONG_POST = {
  '/api/ai/trich_xuat': { xuLy: trichXuatTrieuChung, loaiLichSu: 'chan_doan' },
  '/api/ai/dien_giai': { xuLy: dienGiaiKetQua, loaiLichSu: null },
  '/api/ai/hoi_lich_su': { xuLy: hoiVeLichSu, loaiLichSu: 'lich_su' },
  '/api/ai/tra_cuu_tri_thuc': { xuLy: traCuuTriThuc, loaiLichSu: 'tri_thuc' }
};

function xuLyGET(pathname, cauHinh, loiCauHinh) {
  const hanMuc = layBaoCaoHanMuc(cauHinh);
  if (pathname === '/api/ai/trang_thai') {
    return { ok: !loiCauHinh, nhaCungCap: cauHinh.nhaCungCap, model: cauHinh.model, loi: loiCauHinh, hanMuc };
  }
  if (pathname === '/api/ai/han_muc') {
    return { ok: true, hanMuc };
  }
  return null;
}

/**
 * Tạo bộ xử lý API AI. Trả về hàm (req, res, pathname) => Promise<boolean>
 * (true nếu request đã được xử lý).
 */
function taoBoXuLyAI({ sendJSON, parseRequestBody, db }) {
  const nguCanh = { db };
  khoiTaoBangLichSuHoi(db);

  async function xuLyPOST(req, res, tuyen, cauHinh) {
    let body = {};
    try {
      body = await parseRequestBody(req);
      const ketQua = await tuyen.xuLy(cauHinh, body, nguCanh);
      ghiLichSuHoi(db, { loai: tuyen.loaiLichSu, body, ketQua, cauHinh });
      sendJSON(res, 200, {
        ok: true, nhaCungCap: cauHinh.nhaCungCap, model: cauHinh.model, ...ketQua, hanMuc: layBaoCaoHanMuc(cauHinh)
      });
    } catch (e) {
      ghiLichSuHoi(db, { loai: tuyen.loaiLichSu, body, loi: e.message, cauHinh });
      sendJSON(res, 502, { ok: false, error: e.message, hanMuc: layBaoCaoHanMuc(cauHinh) });
    }
  }

  return async function xuLyApiAI(req, res, pathname) {
    if (!pathname.startsWith('/api/ai/')) return false;
    const lichSu = xuLyApiLichSuHoi(req.method, pathname, db);
    if (lichSu) {
      sendJSON(res, lichSu.status, lichSu.body);
      return true;
    }
    const cauHinh = layCauHinhAI();
    const loiCauHinh = kiemTraCauHinh(cauHinh);

    if (req.method === 'GET') {
      const ketQua = xuLyGET(pathname, cauHinh, loiCauHinh);
      if (ketQua) sendJSON(res, 200, ketQua);
      return Boolean(ketQua);
    }

    const tuyen = req.method === 'POST' ? BANG_DIEU_HUONG_POST[pathname] : null;
    if (!tuyen) return false;
    if (loiCauHinh) {
      sendJSON(res, 503, { ok: false, error: loiCauHinh });
      return true;
    }
    await xuLyPOST(req, res, tuyen, cauHinh);
    return true;
  };
}

module.exports = { taoBoXuLyAI };
