/**
 * WIDGET HIỂN THỊ HẠN MỨC (QUOTA) AI
 * Số liệu do máy chủ tự đếm (Gemini không trả về quota còn lại) -> hiển thị là ƯỚC TÍNH.
 */

const TEN_LOAI_HAN_MUC_AI = { ngay: "theo ngày", phut: "theo phút", token: "theo token", khac: "" };

const KHOA_HIEN_HAN_MUC_AI = "MED_EXPERT_HIEN_HAN_MUC_AI";

class HienThiHanMucAI {
  /**
   * @param {HTMLElement} phanTu   Khung hiển thị chi tiết hạn mức (ẩn mặc định)
   * @param {DichVuAI} dichVuAI
   * @param {HTMLElement} nutBatTat Nút bật/tắt (có chấm màu báo nhanh mức sử dụng)
   */
  constructor(phanTu, dichVuAI, nutBatTat = null) {
    this.el = phanTu;
    this.dichVuAI = dichVuAI;
    this.nut = nutBatTat;
    this.hanMuc = null;
    this.dangHien = this._docTrangThaiHien();
    this.dinhDangSo = new Intl.NumberFormat("vi-VN");
    if (this.nut) this.nut.addEventListener("click", () => this.batTat());
  }

  _docTrangThaiHien() {
    try {
      return localStorage.getItem(KHOA_HIEN_HAN_MUC_AI) === "1";
    } catch (e) {
      return false;
    }
  }

  batTat() {
    this.dangHien = !this.dangHien;
    try {
      localStorage.setItem(KHOA_HIEN_HAN_MUC_AI, this.dangHien ? "1" : "0");
    } catch (e) { /* trình duyệt chặn lưu trữ: chỉ áp dụng trong phiên này */ }
    this.render(this.hanMuc);
  }

  // Mức cảnh báo nhanh cho chấm màu trên nút: ok | warn | danger
  _mucCanhBao(hanMuc) {
    const ngay = hanMuc.ngay || {};
    if (ngay.daHet || hanMuc.cham429) return "danger";
    if (!ngay.gioiHan) return "ok";
    return this._mauTheoTyLe((ngay.daDung / ngay.gioiHan) * 100).replace("is-", "");
  }

  _capNhatNut(hanMuc) {
    if (!this.nut) return;
    this.nut.hidden = !hanMuc;
    if (!hanMuc) return;
    const muc = hanMuc.khongGioiHan ? "ok" : this._mucCanhBao(hanMuc);
    this.nut.dataset.muc = muc;
    this.nut.classList.toggle("active", this.dangHien);
    this.nut.setAttribute("aria-pressed", String(this.dangHien));
  }

  batDauTuDongCapNhat(chuKyMs = 30000) {
    if (!this.dichVuAI.coMayChu) return;
    setInterval(() => {
      this.dichVuAI.layHanMuc().catch(() => { /* bỏ qua lỗi mạng tạm thời */ });
    }, chuKyMs);
  }

  render(hanMuc) {
    this.hanMuc = hanMuc || null;
    this._capNhatNut(this.hanMuc);
    if (!this.el) return;
    if (!hanMuc || !this.dangHien) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    if (hanMuc.khongGioiHan) {
      this.el.innerHTML = `<div class="ai-quota-row"><i class="fa-solid fa-infinity"></i> ${thoatHtmlAI(hanMuc.nhaCungCap)} chạy cục bộ: không giới hạn quota</div>`;
      return;
    }
    this.el.innerHTML = `
      <div class="ai-quota-head"><i class="fa-solid fa-gauge-high"></i> Hạn mức AI (${thoatHtmlAI(hanMuc.model)})</div>
      <div class="ai-quota-meters">
        ${this._taoThanhDo("Hôm nay", hanMuc.ngay, "yêu cầu")}
        ${this._taoThanhDo("Trong 1 phút", hanMuc.phut, "yêu cầu")}
        <div class="ai-quota-meter"><span>Token hôm nay: <b>${this.dinhDangSo.format(hanMuc.tokenHomNay || 0)}</b></span></div>
      </div>
      ${this._taoDong429(hanMuc.cham429)}
      <div class="ai-quota-note">${this._taoChuThich(hanMuc)}</div>`;
  }

  _mauTheoTyLe(tyLe) {
    if (tyLe >= 90) return "is-danger";
    if (tyLe >= 70) return "is-warn";
    return "is-ok";
  }

  _taoThanhDo(nhan, dong, donVi) {
    if (!dong) return "";
    if (!dong.gioiHan) {
      return `<div class="ai-quota-meter"><span>${nhan}: đã dùng <b>${dong.daDung}</b> ${donVi} <em>(chưa rõ giới hạn)</em></span></div>`;
    }
    const tyLe = dong.daHet ? 100 : Math.min(100, Math.round((dong.daDung / dong.gioiHan) * 100));
    return `
      <div class="ai-quota-meter ${this._mauTheoTyLe(tyLe)}">
        <span>${nhan}: còn <b>${dong.conLai}</b> / ${dong.gioiHan} ${donVi}</span>
        <div class="ai-quota-bar"><div style="width: ${tyLe}%;"></div></div>
      </div>`;
  }

  _gioVN(isoString) {
    return new Date(isoString).toLocaleTimeString("vi-VN", {
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh"
    });
  }

  _taoDong429(cham429) {
    if (!cham429) return "";
    const loai = TEN_LOAI_HAN_MUC_AI[cham429.loai] || "";
    const thuLai = cham429.thuLaiSauGiay ? `, Google yêu cầu chờ khoảng ${Math.ceil(cham429.thuLaiSauGiay)} giây` : "";
    return `<div class="ai-quota-alert"><i class="fa-solid fa-circle-exclamation"></i>
      Đã chạm hạn mức ${loai} lúc ${this._gioVN(cham429.luc)}${thuLai}.</div>`;
  }

  _taoChuThich(hanMuc) {
    const nguon = {
      cau_hinh: "Giới hạn lấy từ file .env.",
      hoc_tu_429: "Giới hạn ngày được hệ thống học từ thông báo lỗi 429 của Google.",
      chua_co: "Chưa có giới hạn: điền GEMINI_RPD_LIMIT / GEMINI_RPM_LIMIT trong .env (xem trong AI Studio)."
    }[hanMuc.nguonGioiHan] || "";
    return `Ước tính từ máy chủ này. Reset lúc ${this._gioVN(hanMuc.resetLuc)} (giờ VN). ${nguon}`;
  }
}

if (typeof window !== "undefined") {
  window.HienThiHanMucAI = HienThiHanMucAI;
}
