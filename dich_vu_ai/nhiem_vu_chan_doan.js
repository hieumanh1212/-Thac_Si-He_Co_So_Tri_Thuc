/**
 * NHIỆM VỤ AI #1: CHẨN ĐOÁN TỪ MÔ TẢ BỆNH NHÂN
 * ----------------------------------------------------------------------------
 *  a) Trích xuất: mô tả tự nhiên -> các triệu chứng CÓ TRONG TRI THỨC + CF
 *       - "trich_dan": được nói trực tiếp / diễn đạt tương đương
 *       - "suy_luan" : suy ra từ chi tiết lâm sàng cụ thể (CF tối đa 0.6)
 *  b) Diễn giải: kết quả động cơ suy diễn -> đoạn văn dễ hiểu
 * Kết luận bệnh LUÔN do động cơ suy diễn (luật sinh + MYCIN) quyết định.
 */

const { goiAI } = require('./goi_llm.js');
const { layMang, catChuoi } = require('./tien_ich.js');

const MAX_DO_DAI_MO_TA = 2000;
const CAC_MUC_CF = [1.0, 0.8, 0.6, 0.4];
const CF_TOI_DA_SUY_LUAN = 0.6;

// ============================================================================
// a) TRÍCH XUẤT / SUY LUẬN TRIỆU CHỨNG
// ============================================================================

const SCHEMA_TRICH_XUAT = {
  type: 'object',
  properties: {
    tomTat: { type: 'string' },
    trieuChung: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ma: { type: 'string' },
          cf: { type: 'number' },
          loai: { type: 'string', enum: ['trich_dan', 'suy_luan'] },
          bangChung: { type: 'string' },
          lyDo: { type: 'string' }
        },
        required: ['ma', 'cf', 'loai', 'bangChung']
      }
    },
    khongKhopDuoc: { type: 'array', items: { type: 'string' } },
    canhBao: { type: 'array', items: { type: 'string' } }
  },
  required: ['tomTat', 'trieuChung', 'khongKhopDuoc', 'canhBao']
};

const HUONG_DAN_TRICH_XUAT = `Bạn là MODULE CHUYỂN ĐỔI MÔ TẢ LÂM SÀNG -> SỰ KIỆN (TRIỆU CHỨNG) của một hệ chuyên gia y tế dựa trên luật sinh.
Người dùng (người bệnh, người nhà hoặc nhân viên y tế) mô tả tình trạng bệnh nhân. Nhiệm vụ: xác định các triệu chứng
trong DANH MỤC mà bệnh nhân đang có, để động cơ suy diễn dùng làm giả thiết đầu vào.

MỖI TRIỆU CHỨNG THUỘC 1 TRONG 2 LOẠI:
- "trich_dan": được nói trực tiếp hoặc diễn đạt tương đương (vd "nóng 39,5 độ" -> sốt cao; "sổ mũi" -> chảy nước mũi).
- "suy_luan": không nói thẳng nhưng suy ra hợp lý, MỘT BƯỚC, từ chi tiết lâm sàng cụ thể được mô tả
  (vd "thở hổn hển, phải ngồi dậy mới thở được" -> khó thở; "bé bỏ bú, quấy khóc khi ăn, miệng có vết loét" -> loét miệng).
  Bắt buộc ghi "lyDo" giải thích suy luận. CF tối đa 0.6.

QUY TẮC BẮT BUỘC:
1. TUYỆT ĐỐI KHÔNG chẩn đoán bệnh, không nêu tên bệnh trong kết quả. Việc chẩn đoán do động cơ suy diễn đảm nhiệm.
2. KHÔNG suy ra triệu chứng từ TÊN BỆNH hoặc chẩn đoán có sẵn (vd "nghi sốt xuất huyết" KHÔNG được tự thêm các triệu
   chứng của sốt xuất huyết). Nếu mô tả có nêu tên bệnh / chẩn đoán, ghi lưu ý vào "canhBao".
3. KHÔNG thêm triệu chứng chỉ vì nó "thường đi kèm". Không suy diễn chuỗi nhiều bước.
4. Chỉ dùng mã có trong DANH MỤC. Không tự tạo mã mới.
5. Triệu chứng bị phủ định (vd "không ho", "chưa sốt") thì KHÔNG đưa vào.
6. CF theo mức chắc chắn: 1.0 = khẳng định rõ; 0.8 = khá chắc; 0.6 = có vẻ/hơi; 0.4 = nghi ngờ, không chắc.
7. "bangChung": trích NGUYÊN VĂN cụm từ trong mô tả làm căn cứ.
8. "khongKhopDuoc": biểu hiện được mô tả nhưng không có mã phù hợp trong danh mục.
9. "canhBao": lưu ý cho người kiểm tra (mô tả nêu tên bệnh, mô tả mơ hồ, mâu thuẫn, dấu hiệu nặng cần đi khám ngay...).
10. "tomTat": tóm tắt mô tả trong 1 câu, khách quan, không chẩn đoán.
Trả lời bằng tiếng Việt, đúng định dạng JSON yêu cầu.`;

function chuanHoaDanhMuc(danhMuc) {
  return layMang(danhMuc)
    .filter(s => s && typeof s.id === 'string' && typeof s.name === 'string')
    .slice(0, 300)
    .map(s => ({ id: s.id.trim(), name: s.name.trim() }));
}

function lamTronCF(cf) {
  const so = Number(cf);
  if (!Number.isFinite(so) || so <= 0) return null;
  return CAC_MUC_CF.find(muc => so >= muc - 0.1) || 0.4;
}

function chuanHoaMucTrieuChung(muc, maHopLe) {
  const ma = catChuoi(muc && muc.ma, 20).trim().toUpperCase();
  const cf = lamTronCF(muc && muc.cf);
  if (!maHopLe.has(ma) || cf === null) {
    return { loi: ma || '(trống)' };
  }
  const laSuyLuan = muc.loai === 'suy_luan';
  return {
    ma,
    cf: laSuyLuan ? Math.min(cf, CF_TOI_DA_SUY_LUAN) : cf,
    loai: laSuyLuan ? 'suy_luan' : 'trich_dan',
    bangChung: catChuoi(muc.bangChung, 200),
    lyDo: catChuoi(muc.lyDo, 300)
  };
}

// Kiểm soát đầu ra AI: loại mã không tồn tại, mã trùng, CF không hợp lệ
function chuanHoaKetQuaTrichXuat(raw, danhMuc) {
  const nguon = raw || {};
  const maHopLe = new Set(danhMuc.map(s => s.id));
  const daThem = new Set();
  const trieuChung = [];
  const biLoai = [];

  for (const muc of layMang(nguon.trieuChung)) {
    const ketQua = chuanHoaMucTrieuChung(muc, maHopLe);
    if (ketQua.loi) {
      biLoai.push(ketQua.loi);
      continue;
    }
    if (daThem.has(ketQua.ma)) continue;
    daThem.add(ketQua.ma);
    trieuChung.push(ketQua);
  }

  return {
    tomTat: catChuoi(nguon.tomTat, 500),
    trieuChung,
    khongKhopDuoc: layMang(nguon.khongKhopDuoc).map(String).slice(0, 20),
    canhBao: layMang(nguon.canhBao).map(String).slice(0, 10),
    maBiLoai: biLoai
  };
}

async function trichXuatTrieuChung(cauHinh, body) {
  const moTa = catChuoi(body.cauHoi, MAX_DO_DAI_MO_TA).trim();
  if (!moTa) throw new Error('Vui lòng nhập mô tả tình trạng bệnh nhân.');
  const danhMuc = chuanHoaDanhMuc(body.danhMuc);
  if (danhMuc.length === 0) throw new Error('Danh mục triệu chứng trống.');

  const nguoiDung = `DANH MỤC TRIỆU CHỨNG (mã | tên):\n${danhMuc.map(s => `${s.id} | ${s.name}`).join('\n')}\n\nMÔ TẢ TÌNH TRẠNG BỆNH NHÂN:\n"""${moTa}"""`;
  const raw = await goiAI(cauHinh, { heThong: HUONG_DAN_TRICH_XUAT, nguoiDung, schema: SCHEMA_TRICH_XUAT });
  return chuanHoaKetQuaTrichXuat(raw, danhMuc);
}

// ============================================================================
// b) DIỄN GIẢI KẾT QUẢ ĐỘNG CƠ SUY DIỄN
// ============================================================================

const SCHEMA_DIEN_GIAI = {
  type: 'object',
  properties: { dienGiai: { type: 'string' } },
  required: ['dienGiai']
};

const HUONG_DAN_DIEN_GIAI = `Bạn là TRỢ LÝ DIỄN GIẢI của một hệ chuyên gia y tế dựa trên luật sinh và hệ số tin cậy MYCIN (CF).
Hãy viết đoạn giải thích tiếng Việt (tối đa 180 từ) cho người dùng phổ thông, CHỈ dựa trên KẾT QUẢ ĐỘNG CƠ được cung cấp.

QUY TẮC BẮT BUỘC:
1. Không thêm bệnh nào ngoài danh sách kết quả. Không thay đổi các con số CF.
2. Nêu bệnh có CF cao nhất và giải thích vì sao (dựa trên luật đã kích hoạt và triệu chứng).
3. Nhắc tới các khả năng khác nếu có, và các triệu chứng nên kiểm tra thêm (nếu được cung cấp).
4. Không kê đơn, không nêu liều thuốc cụ thể.
5. Kết thúc bằng lời khuyên đến cơ sở y tế để bác sĩ thăm khám và xét nghiệm xác định.
6. Nếu không có kết quả nào, giải thích rằng tri thức hiện tại chưa đủ để kết luận.`;

function tomTatKetQuaChoAI(body) {
  const ketQua = layMang(body.ketQua).slice(0, 5).map(r => ({
    benh: catChuoi(r.ten, 200),
    cf: Number(r.cf) || 0,
    luat: layMang(r.luat).slice(0, 6).map(String)
  }));
  return {
    trieuChung: layMang(body.trieuChung).slice(0, 40).map(String),
    ketQua,
    nenKiemTraThem: layMang(body.nenKiemTraThem).slice(0, 6).map(String)
  };
}

async function dienGiaiKetQua(cauHinh, body) {
  const duLieu = tomTatKetQuaChoAI(body);
  const nguoiDung = `KẾT QUẢ ĐỘNG CƠ SUY DIỄN (JSON):\n${JSON.stringify(duLieu, null, 2)}`;
  const raw = await goiAI(cauHinh, { heThong: HUONG_DAN_DIEN_GIAI, nguoiDung, schema: SCHEMA_DIEN_GIAI });
  return { dienGiai: catChuoi(raw && raw.dienGiai, 3000) };
}

module.exports = { trichXuatTrieuChung, dienGiaiKetQua, chuanHoaKetQuaTrichXuat, lamTronCF };
