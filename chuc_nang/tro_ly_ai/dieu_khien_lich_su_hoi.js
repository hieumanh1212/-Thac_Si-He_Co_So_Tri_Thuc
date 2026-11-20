/**
 * ============================================================================
 * CONTROLLER: LỊCH SỬ HỎI AI
 * ============================================================================
 * Hiển thị các lần hỏi AI đã được máy chủ ghi lại (bảng lich_su_hoi_ai):
 * lọc theo loại, tìm kiếm, xem lại câu trả lời, hỏi lại, xóa.
 */

const LOAI_LICH_SU_HOI_AI = {
  chan_doan: { ten: "Chẩn đoán từ mô tả", icon: "fa-user-doctor", lop: "is-diag" },
  lich_su: { ten: "Hỏi về lịch sử", icon: "fa-clock-rotate-left", lop: "is-hist" },
  tri_thuc: { ten: "Tra cứu tri thức", icon: "fa-book-medical", lop: "is-kb" }
};

// Thời gian trong SQLite là UTC dạng "YYYY-MM-DD HH:MM:SS" -> hiển thị giờ Việt Nam
function dinhDangThoiGianHoiAI(giaTri) {
  const chuoi = String(giaTri || "").replace(" ", "T");
  const ngay = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(chuoi) ? chuoi : `${chuoi}Z`);
  if (Number.isNaN(ngay.getTime())) return String(giaTri || "");
  return ngay.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric"
  });
}

class LichSuHoiAIController {
  /**
   * @param {{ dichVuAI: DichVuAI, onHoiLai: (loai: string, cauHoi: string) => void }} thamSo
   */
  constructor({ dichVuAI, onHoiLai }) {
    this.dichVuAI = dichVuAI;
    this.onHoiLai = onHoiLai;
    this.danhSach = [];
    this.tong = 0;
    this.dangTai = false;
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      locLoai: $("aiHistFilterType"),
      timKiem: $("aiHistSearch"),
      thongKe: $("aiHistCount"),
      danhSach: $("aiHistList"),
      btnTaiLai: $("btnAiHistReload"),
      btnXoaHet: $("btnAiHistClear")
    };
    this.el.locLoai.addEventListener("change", () => this.renderDanhSach());
    this.el.timKiem.addEventListener("input", () => this.renderDanhSach());
    this.el.btnTaiLai.addEventListener("click", () => this.taiDuLieu());
    this.el.btnXoaHet.addEventListener("click", () => this.xoaToanBo());
    this.el.danhSach.addEventListener("click", (e) => this._xuLyHanhDong(e));
  }

  async taiDuLieu() {
    if (this.dangTai) return;
    this.dangTai = true;
    this.el.danhSach.innerHTML = `<div class="ai-empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Đang tải lịch sử hỏi AI...</div>`;
    try {
      const ketQua = await this.dichVuAI.layLichSuHoi();
      this.danhSach = ketQua.items || [];
      this.tong = ketQua.tong || this.danhSach.length;
      this.renderDanhSach();
    } catch (e) {
      this.el.danhSach.innerHTML = `<div class="ai-empty"><i class="fa-solid fa-triangle-exclamation"></i>${thoatHtmlAI(e.message)}</div>`;
    } finally {
      this.dangTai = false;
    }
  }

  _locDanhSach() {
    const loai = this.el.locLoai.value;
    const tuKhoa = this.el.timKiem.value.trim().toLowerCase();
    return this.danhSach.filter(muc => {
      const dungLoai = !loai || muc.loai === loai;
      const dungTuKhoa = !tuKhoa || `${muc.cauHoi}\n${muc.traLoi}`.toLowerCase().includes(tuKhoa);
      return dungLoai && dungTuKhoa;
    });
  }

  renderDanhSach() {
    const ketQua = this._locDanhSach();
    const vuotGioiHan = this.tong > this.danhSach.length ? ` (đang tải ${this.danhSach.length} lượt gần nhất)` : "";
    this.el.thongKe.textContent = `Hiển thị ${ketQua.length} / ${this.tong} lượt hỏi${vuotGioiHan}`;
    this.el.btnXoaHet.disabled = this.danhSach.length === 0;
    if (ketQua.length === 0) {
      const thongDiep = this.danhSach.length === 0 ? "Chưa có lượt hỏi AI nào được ghi lại." : "Không có lượt hỏi nào khớp bộ lọc.";
      this.el.danhSach.innerHTML = `<div class="ai-empty"><i class="fa-regular fa-folder-open"></i>${thongDiep}</div>`;
      return;
    }
    this.el.danhSach.innerHTML = ketQua.map(muc => this._taoMuc(muc)).join("");
  }

  _taoMuc(muc) {
    const loai = LOAI_LICH_SU_HOI_AI[muc.loai] || { ten: muc.loai, icon: "fa-robot", lop: "" };
    const nhanLoi = muc.thanhCong ? "" : `<span class="ai-hist-badge is-error"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi</span>`;
    const thamChieu = taoHtmlThamChieuAI(muc.thamChieu);
    return `
      <div class="ai-hist-item">
        <div class="ai-hist-head">
          <span class="ai-hist-badge ${loai.lop}"><i class="fa-solid ${loai.icon}"></i> ${thoatHtmlAI(loai.ten)}</span>
          ${nhanLoi}
          <span class="ai-muted"><i class="fa-regular fa-clock"></i> ${thoatHtmlAI(dinhDangThoiGianHoiAI(muc.thoiGian))}</span>
          <span class="ai-muted">• ${thoatHtmlAI(muc.model)}</span>
          <span class="ai-hist-actions">
            <button type="button" class="btn-secondary ai-hist-btn" data-hanh-dong="hoi-lai" data-id="${muc.id}" title="Đưa câu hỏi này vào ô nhập để hỏi lại">
              <i class="fa-solid fa-rotate-right"></i> Hỏi lại
            </button>
            <button type="button" class="ai-remove-btn" data-hanh-dong="xoa" data-id="${muc.id}" title="Xóa lượt hỏi này">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </span>
        </div>
        <div class="ai-hist-question"><i class="fa-regular fa-circle-question"></i> ${thoatHtmlAI(muc.cauHoi)}</div>
        <details class="ai-hist-answer">
          <summary>${muc.thanhCong ? "Xem câu trả lời của AI" : "Xem chi tiết lỗi"}</summary>
          <div class="ai-answer-content">${dinhDangTraLoiAI(muc.traLoi, muc.thanhCong ? muc.thamChieu : [])}</div>
          ${thamChieu ? `<div class="ai-answer-refs"><span class="ai-muted">Tham chiếu:</span> ${thamChieu}</div>` : ""}
        </details>
      </div>`;
  }

  _xuLyHanhDong(e) {
    const nut = e.target.closest("[data-hanh-dong]");
    if (!nut) return;
    const muc = this.danhSach.find(m => String(m.id) === nut.dataset.id);
    if (!muc) return;
    if (nut.dataset.hanhDong === "hoi-lai") {
      this.onHoiLai(muc.loai, muc.cauHoi);
      return;
    }
    this.xoaMot(muc);
  }

  async xoaMot(muc) {
    const dongY = await window.XacNhan.xoa(`lượt hỏi AI #${muc.id}`, thoatHtmlAI(muc.cauHoi.slice(0, 200)));
    if (!dongY) return;
    try {
      await this.dichVuAI.xoaLichSuHoi(muc.id);
      this.danhSach = this.danhSach.filter(m => m.id !== muc.id);
      this.tong = Math.max(0, this.tong - 1);
      this.renderDanhSach();
    } catch (e) {
      window.ThongBao.thatBai(e.message, "Không xóa được");
    }
  }

  async xoaToanBo() {
    const dongY = await window.XacNhan.xoa(`toàn bộ ${this.tong} lượt hỏi AI`, "Toàn bộ lịch sử hỏi AI sẽ bị xóa vĩnh viễn khỏi CSDL SQLite.");
    if (!dongY) return;
    try {
      await this.dichVuAI.xoaLichSuHoi();
      this.danhSach = [];
      this.tong = 0;
      this.renderDanhSach();
      window.ThongBao.thanhCong("Đã xóa toàn bộ lịch sử hỏi AI.");
    } catch (e) {
      window.ThongBao.thatBai(e.message, "Không xóa được");
    }
  }
}

if (typeof window !== "undefined") {
  window.LichSuHoiAIController = LichSuHoiAIController;
}
