/**
 * NHIỆM VỤ AI #2 & #3: HỎI ĐÁP DỰA TRÊN DỮ LIỆU (RETRIEVAL-AUGMENTED)
 * ----------------------------------------------------------------------------
 *  #2 Hỏi về LỊCH SỬ CHẨN ĐOÁN : dữ liệu đọc trực tiếp từ bảng lich_su_chan_doan (SQLite)
 *  #3 Tra cứu QUẢN LÝ TRI THỨC  : tri thức (luật, triệu chứng, bệnh) mà động cơ suy diễn đang dùng
 * Số liệu thống kê được TÍNH SẴN bằng code (không để AI tự đếm) để tránh sai số.
 * AI chỉ được trả lời từ dữ liệu cung cấp và phải dẫn mã tham chiếu.
 */

const { goiAI } = require('./goi_llm.js');
const { layMang, catChuoi, docJSON } = require('./tien_ich.js');

const MAX_DO_DAI_CAU_HOI = 1000;
const SO_PHIEN_CHI_TIET_TOI_DA = 150;
const MUI_GIO_VN = 'Asia/Ho_Chi_Minh';

const SCHEMA_TRA_LOI = {
  type: 'object',
  properties: {
    traLoi: { type: 'string' },
    thamChieu: { type: 'array', items: { type: 'string' } }
  },
  required: ['traLoi', 'thamChieu']
};

const QUY_TAC_CHUNG = `QUY TẮC BẮT BUỘC:
1. CHỈ trả lời dựa trên DỮ LIỆU được cung cấp. Không bịa số liệu, không dùng kiến thức bên ngoài để thêm thông tin.
2. Nếu dữ liệu không đủ để trả lời, nói rõ "Dữ liệu hiện tại không có thông tin này".
3. Ưu tiên dùng số liệu trong mục "thongKe" (đã được tính sẵn chính xác) thay vì tự đếm.
4. Dẫn các mã liên quan (mã phiên, mã luật, mã bệnh, mã triệu chứng) và liệt kê chúng trong "thamChieu".
5. Không đưa ra chẩn đoán mới cho người dùng; nếu được hỏi chẩn đoán, hướng dẫn dùng chế độ "Chẩn đoán từ mô tả".
6. Trả lời tiếng Việt, ngắn gọn, rõ ràng. Có thể dùng gạch đầu dòng "- " và **in đậm**.`;

// ============================================================================
// TIỆN ÍCH THỜI GIAN
// ============================================================================

// SQLite CURRENT_TIMESTAMP lưu giờ UTC dạng "YYYY-MM-DD HH:MM:SS" (không có hậu tố Z)
function docThoiGianUTC(giaTri) {
  const chuoi = String(giaTri || '').trim().replace(' ', 'T');
  const coMuiGio = /(Z|[+-]\d{2}:?\d{2})$/.test(chuoi);
  const ngay = new Date(coMuiGio ? chuoi : `${chuoi}Z`);
  return Number.isNaN(ngay.getTime()) ? null : ngay;
}

const DINH_DANG_VN = new Intl.DateTimeFormat('en-CA', {
  timeZone: MUI_GIO_VN, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});

function dinhDangGioVN(ngay) {
  if (!ngay) return { ngay: 'không rõ', gio: '' };
  const [phanNgay, phanGio] = DINH_DANG_VN.format(ngay).split(', ');
  return { ngay: phanNgay, gio: phanGio };
}

// ============================================================================
// #2. NGỮ CẢNH LỊCH SỬ CHẨN ĐOÁN
// ============================================================================

function chuyenDongLichSu(dong) {
  const chiTiet = docJSON(dong.chi_tiet_ket_qua_json, {});
  const trieuChung = docJSON(dong.cac_trieu_chung_dau_vao, {});
  const thoiGian = dinhDangGioVN(docThoiGianUTC(dong.thoi_gian));
  const ketQua = Array.isArray(chiTiet) ? chiTiet : layMang(chiTiet.results);
  return {
    ma: dong.ma_phien,
    ngay: thoiGian.ngay,
    gio: thoiGian.gio,
    benhChinh: dong.benh_chinh || 'Không xác định',
    cf: Number(dong.he_so_tin_cay_chinh) || 0,
    nguon: chiTiet.nguon === 'AI' ? 'AI' : 'Thủ công',
    trieuChung: Object.entries(trieuChung || {}).map(([ma, cf]) => `${ma}(${cf})`),
    benhKhac: ketQua.slice(1, 3).map(r => `${r.diseaseName || r.name || r.diseaseId}(${r.finalCF ?? r.cf})`)
  };
}

function demTheoKhoa(danhSach, layKhoa) {
  return danhSach.reduce((dem, phanTu) => {
    const khoa = layKhoa(phanTu);
    dem[khoa] = (dem[khoa] || 0) + 1;
    return dem;
  }, {});
}

function tinhThongKeLichSu(cacPhien) {
  const coKetLuan = cacPhien.filter(p => p.cf > 0 && p.benhChinh !== 'Không xác định');
  const tongCF = coKetLuan.reduce((tong, p) => tong + p.cf, 0);
  return {
    tongSoPhien: cacPhien.length,
    soPhienCoKetLuan: coKetLuan.length,
    soPhienKhongXacDinh: cacPhien.length - coKetLuan.length,
    cfTrungBinhCacPhienCoKetLuan: coKetLuan.length ? Number((tongCF / coKetLuan.length).toFixed(3)) : 0,
    soPhienTheoBenhChinh: demTheoKhoa(coKetLuan, p => p.benhChinh),
    soPhienTheoNgay: demTheoKhoa(cacPhien, p => p.ngay),
    soPhienTheoNguon: demTheoKhoa(cacPhien, p => p.nguon),
    soLanXuatHienTrieuChung: demTheoKhoa(cacPhien.flatMap(p => p.trieuChung.map(t => t.split('(')[0])), ma => ma)
  };
}

function layTuDienTrieuChung(db) {
  const tuDien = {};
  db.prepare('SELECT ma_trieu_chung, ten_trieu_chung FROM trieu_chung;').all()
    .forEach(dong => { tuDien[dong.ma_trieu_chung] = dong.ten_trieu_chung; });
  return tuDien;
}

function taoNguCanhLichSu(db) {
  const cacDong = db.prepare(`SELECT ma_phien, thoi_gian, cac_trieu_chung_dau_vao, benh_chinh, he_so_tin_cay_chinh, chi_tiet_ket_qua_json
    FROM lich_su_chan_doan ORDER BY thoi_gian DESC, id DESC;`).all();
  const cacPhien = cacDong.map(chuyenDongLichSu);
  const bayGio = dinhDangGioVN(new Date());
  return {
    thoiDiemHienTai: `${bayGio.ngay} ${bayGio.gio} (giờ Việt Nam, UTC+7)`,
    ghiChu: cacPhien.length > SO_PHIEN_CHI_TIET_TOI_DA
      ? `Chỉ liệt kê chi tiết ${SO_PHIEN_CHI_TIET_TOI_DA} phiên gần nhất; mục thongKe tính trên toàn bộ ${cacPhien.length} phiên.`
      : 'Danh sách phiên đầy đủ, sắp xếp mới nhất trước. Trường trieuChung có dạng MÃ(CF).',
    thongKe: tinhThongKeLichSu(cacPhien),
    tuDienTrieuChung: layTuDienTrieuChung(db),
    cacPhien: cacPhien.slice(0, SO_PHIEN_CHI_TIET_TOI_DA)
  };
}

const HUONG_DAN_LICH_SU = `Bạn là TRỢ LÝ TRA CỨU LỊCH SỬ CHẨN ĐOÁN của hệ chuyên gia y tế MED-EXPERT.
Dữ liệu là các phiên chẩn đoán đã lưu (bảng lich_su_chan_doan). Mỗi phiên có: mã phiên, ngày giờ (giờ Việt Nam),
bệnh chính do động cơ suy diễn kết luận, hệ số tin cậy CF (0-1), nguồn tạo phiên (Thủ công / AI), các triệu chứng đầu vào.
Khi người dùng nói "hôm nay", "hôm qua", "tuần này"... hãy tính theo "thoiDiemHienTai".
${QUY_TAC_CHUNG}`;

// ============================================================================
// #3. NGỮ CẢNH QUẢN LÝ TRI THỨC
// ============================================================================

function chuanHoaTriThuc(kb) {
  const nguon = kb || {};
  return {
    nhomTrieuChung: layMang(nguon.symptomGroups).slice(0, 50).map(g => ({ ma: g.id, ten: catChuoi(g.name, 150) })),
    trieuChung: layMang(nguon.symptoms).slice(0, 300).map(s => ({
      ma: s.id, ten: catChuoi(s.name, 200), nhom: s.groupId, laHoiChungTrungGian: Boolean(s.isIntermediate)
    })),
    benh: layMang(nguon.diseases).slice(0, 100).map(d => ({
      ma: d.id,
      ten: catChuoi(d.name, 200),
      tenKhoaHoc: catChuoi(d.scientificName, 200),
      nhomBenh: catChuoi(d.category, 200),
      mucDoNguyHiem: catChuoi(d.severity, 300),
      moTa: catChuoi(d.description, 800),
      dauHieuCanhBao: catChuoi(d.warningSigns, 600),
      huongXuTri: catChuoi(d.treatment || d.recommendation, 800),
      nguonThamKhao: catChuoi(d.reference, 300)
    })),
    luat: layMang(nguon.rules).slice(0, 500).map(r => ({
      ma: r.id, ten: catChuoi(r.name, 200), neu: layMang(r.premises), thi: r.conclusion, cf: Number(r.cf) || 0
    }))
  };
}

function tinhThongKeTriThuc(triThuc) {
  const tanSuat = demTheoKhoa(triThuc.luat.flatMap(r => r.neu), ma => ma);
  const topTrieuChung = Object.entries(tanSuat).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([ma, soLuat]) => ({ ma, soLuat }));
  const sapTheoCF = [...triThuc.luat].sort((a, b) => b.cf - a.cf);
  return {
    soNhomTrieuChung: triThuc.nhomTrieuChung.length,
    soTrieuChung: triThuc.trieuChung.length,
    soBenh: triThuc.benh.length,
    soLuat: triThuc.luat.length,
    soLuatTheoKetLuan: demTheoKhoa(triThuc.luat, r => r.thi),
    trieuChungXuatHienNhieuNhatTrongLuat: topTrieuChung,
    luatCFCaoNhat: sapTheoCF.slice(0, 3).map(r => `${r.ma}(${r.cf})`),
    luatCFThapNhat: sapTheoCF.slice(-3).map(r => `${r.ma}(${r.cf})`)
  };
}

const HUONG_DAN_TRI_THUC = `Bạn là TRỢ LÝ TRA CỨU CƠ SỞ TRI THỨC của hệ chuyên gia y tế MED-EXPERT.
Cơ sở tri thức gồm: nhóm triệu chứng, triệu chứng (sự kiện), bệnh (Frame có các slot mô tả, dấu hiệu cảnh báo,
hướng xử trí, nguồn tham khảo) và luật sinh dạng "NẾU <các tiền đề AND> THÌ <kết luận> [CF]".
Kết luận của luật có thể là bệnh (mã D..) hoặc hội chứng trung gian (mã HC..). Khi nêu luật, hãy viết đầy đủ
dạng "R01: NẾU S01 (tên) ∧ S04 (tên) THÌ D01 (tên) [CF 0.85]".
${QUY_TAC_CHUNG}`;

// ============================================================================
// THỰC THI HỎI ĐÁP
// ============================================================================

async function hoiDapVoiNguCanh(cauHinh, body, { heThong, tenDuLieu, nguCanh }) {
  const cauHoi = catChuoi(body.cauHoi, MAX_DO_DAI_CAU_HOI).trim();
  if (!cauHoi) throw new Error('Vui lòng nhập câu hỏi.');
  const nguoiDung = `${tenDuLieu} (JSON):\n${JSON.stringify(nguCanh)}\n\nCÂU HỎI CỦA NGƯỜI DÙNG:\n"""${cauHoi}"""`;
  const raw = await goiAI(cauHinh, { heThong, nguoiDung, schema: SCHEMA_TRA_LOI, hoiThoai: body.hoiThoai });
  return {
    traLoi: catChuoi(raw && raw.traLoi, 6000),
    thamChieu: layMang(raw && raw.thamChieu).map(String).slice(0, 30)
  };
}

async function hoiVeLichSu(cauHinh, body, { db }) {
  if (!db) throw new Error('Chưa kết nối được CSDL SQLite.');
  return hoiDapVoiNguCanh(cauHinh, body, {
    heThong: HUONG_DAN_LICH_SU,
    tenDuLieu: 'DỮ LIỆU LỊCH SỬ CHẨN ĐOÁN',
    nguCanh: taoNguCanhLichSu(db)
  });
}

async function traCuuTriThuc(cauHinh, body) {
  const triThuc = chuanHoaTriThuc(body.triThuc);
  if (triThuc.luat.length === 0 && triThuc.benh.length === 0) {
    throw new Error('Cơ sở tri thức trống, không có gì để tra cứu.');
  }
  return hoiDapVoiNguCanh(cauHinh, body, {
    heThong: HUONG_DAN_TRI_THUC,
    tenDuLieu: 'CƠ SỞ TRI THỨC',
    nguCanh: { thongKe: tinhThongKeTriThuc(triThuc), ...triThuc }
  });
}

module.exports = { hoiVeLichSu, traCuuTriThuc, taoNguCanhLichSu, chuanHoaTriThuc, tinhThongKeTriThuc };
