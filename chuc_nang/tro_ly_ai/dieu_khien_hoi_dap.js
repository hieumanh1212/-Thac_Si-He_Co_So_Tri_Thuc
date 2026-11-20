/**
 * ============================================================================
 * CONTROLLER: HỎI ĐÁP AI (LỊCH SỬ CHẨN ĐOÁN & TRA CỨU TRI THỨC)
 * ============================================================================
 * Dạng "hỏi một câu - nhận một câu trả lời" (không lưu hội thoại).
 * AI chỉ trả lời dựa trên dữ liệu do hệ thống cung cấp (RAG) và phải dẫn mã tham chiếu.
 */

const CAU_HINH_CHE_DO_HOI_DAP = {
  lich_su: {
    icon: "fa-clock-rotate-left",
    tieuDe: "Hỏi về lịch sử chẩn đoán",
    moTa: "AI đọc dữ liệu bảng lich_su_chan_doan (các phiên đã lưu) để trả lời. Số liệu thống kê được hệ thống tính sẵn.",
    placeholder: "Ví dụ: Tuần này bệnh nào được chẩn đoán nhiều nhất?",
    chuThich: "Trả lời dựa trên dữ liệu lịch sử hiện có. Hãy đối chiếu lại tại trang Lịch sử.",
    viDu: [
      "Hôm nay có bao nhiêu phiên chẩn đoán?",
      "Bệnh nào được chẩn đoán nhiều nhất?",
      "Phiên gần nhất kết luận bệnh gì, CF bao nhiêu?",
      "Có bao nhiêu phiên được sinh từ AI?"
    ],
    goi: (dichVu, cauHoi) => dichVu.hoiLichSu(cauHoi, [])
  },
  tri_thuc: {
    icon: "fa-book-medical",
    tieuDe: "Tra cứu cơ sở tri thức",
    moTa: "AI đọc tri thức mà động cơ suy diễn đang dùng (nhóm triệu chứng, triệu chứng, bệnh, luật sinh) để trả lời.",
    placeholder: "Ví dụ: Những luật nào suy ra Sốt xuất huyết Dengue?",
    chuThich: "Trả lời dựa trên tri thức hiện tại. Hãy đối chiếu lại tại trang Quản lý tri thức.",
    viDu: [
      "Những luật nào suy ra Sốt xuất huyết Dengue?",
      "Hướng xử trí và dấu hiệu cảnh báo của bệnh Sởi?",
      "Triệu chứng nào xuất hiện trong nhiều luật nhất?",
      "Luật nào có hệ số tin cậy cao nhất?"
    ],
    goi: (dichVu, cauHoi, kb) => dichVu.traCuuTriThuc(cauHoi, [], kb)
  }
};

// Định dạng an toàn: thoát HTML trước, sau đó chỉ hỗ trợ **đậm** và gạch đầu dòng "- " / "* "
function dinhDangTraLoiAI(vanBan) {
  const cacDong = thoatHtmlAI(vanBan).split(/\r?\n/);
  const html = [];
  let dangTrongDanhSach = false;
  for (const dong of cacDong) {
    const laMucDanhSach = /^\s*[-*•]\s+/.test(dong);
    if (laMucDanhSach !== dangTrongDanhSach) {
      html.push(laMucDanhSach ? "<ul>" : "</ul>");
      dangTrongDanhSach = laMucDanhSach;
    }
    const noiDung = dong.replace(/^\s*[-*•]\s+/, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html.push(laMucDanhSach ? `<li>${noiDung}</li>` : `${noiDung}<br>`);
  }
  if (dangTrongDanhSach) html.push("</ul>");
  return html.join("");
}

class HoiDapAIController {
  constructor({ dichVuAI, kbManager }) {
    this.dichVuAI = dichVuAI;
    this.kbManager = kbManager;
    this.cheDo = "lich_su";
    this.aiSanSang = false;
    this.dangGui = false;
    // Câu trả lời gần nhất của từng chế độ: { cauHoi, traLoi, thamChieu, loi }
    this.ketQua = { lich_su: null, tri_thuc: null };
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      icon: $("aiAskIcon"),
      tieuDe: $("aiAskTitle"),
      moTa: $("aiAskDesc"),
      input: $("aiAskInput"),
      btnHoi: $("btnAiAsk"),
      viDu: $("aiAskExamples"),
      traLoi: $("aiAnswerBox")
    };
    this.el.btnHoi.addEventListener("click", () => this.guiCauHoi());
    this.el.input.addEventListener("input", () => this.capNhatNut());
    this.el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.guiCauHoi();
      }
    });
    this.el.viDu.addEventListener("click", (e) => this._xuLyChonViDu(e));
  }

  apDungTrangThaiAI(trangThai) {
    this.aiSanSang = Boolean(trangThai && trangThai.ok);
    this.capNhatNut();
  }

  capNhatNut() {
    this.el.btnHoi.disabled = !this.aiSanSang || this.dangGui || this.el.input.value.trim().length < 3;
  }

  chonCheDo(cheDo) {
    const cauHinh = CAU_HINH_CHE_DO_HOI_DAP[cheDo];
    if (!cauHinh) return;
    this.cheDo = cheDo;
    this.el.icon.className = `fa-solid ${cauHinh.icon}`;
    this.el.tieuDe.textContent = cauHinh.tieuDe;
    this.el.moTa.textContent = cauHinh.moTa;
    this.el.input.placeholder = cauHinh.placeholder;
    this.el.input.value = (this.ketQua[cheDo] && this.ketQua[cheDo].cauHoi) || "";
    this.el.viDu.innerHTML = cauHinh.viDu
      .map(cau => `<button type="button" class="ai-example-chip" data-cau-hoi="${thoatHtmlAI(cau)}">${thoatHtmlAI(cau)}</button>`)
      .join("");
    this.renderTraLoi();
    this.capNhatNut();
  }

  // Dùng khi "Hỏi lại" từ Lịch sử hỏi AI: chỉ điền câu hỏi, người dùng tự bấm Hỏi (tiết kiệm quota)
  datCauHoi(cauHoi) {
    this.el.input.value = cauHoi || "";
    this.capNhatNut();
    this.el.input.focus();
  }

  _xuLyChonViDu(e) {
    const chip = e.target.closest("[data-cau-hoi]");
    if (!chip) return;
    this.el.input.value = chip.dataset.cauHoi;
    this.capNhatNut();
    this.guiCauHoi();
  }

  async guiCauHoi() {
    const cauHoi = this.el.input.value.trim();
    if (!this.aiSanSang || this.dangGui || cauHoi.length < 3) return;

    const cheDo = this.cheDo;
    this._datDangGui(true);
    try {
      const ketQua = await CAU_HINH_CHE_DO_HOI_DAP[cheDo].goi(this.dichVuAI, cauHoi, this.kbManager.getKB());
      this.ketQua[cheDo] = { cauHoi, traLoi: ketQua.traLoi || "(AI không trả lời)", thamChieu: ketQua.thamChieu || [] };
    } catch (e) {
      this.ketQua[cheDo] = { cauHoi, loi: e.message };
    } finally {
      this._datDangGui(false);
    }
  }

  _datDangGui(dangGui) {
    this.dangGui = dangGui;
    this.renderTraLoi();
    this.capNhatNut();
  }

  renderTraLoi() {
    const ketQua = this.ketQua[this.cheDo];
    if (this.dangGui) {
      this.el.traLoi.innerHTML = `<div class="ai-answer-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> AI đang đọc dữ liệu và soạn câu trả lời...</div>`;
      return;
    }
    if (!ketQua) {
      this.el.traLoi.innerHTML = "";
      return;
    }
    this.el.traLoi.innerHTML = ketQua.loi ? this._taoHtmlLoi(ketQua) : this._taoHtmlTraLoi(ketQua);
  }

  _taoHtmlLoi(ketQua) {
    return `
      <div class="ai-answer ai-answer-error">
        <i class="fa-solid fa-triangle-exclamation"></i> Không trả lời được câu hỏi "${thoatHtmlAI(ketQua.cauHoi)}": ${thoatHtmlAI(ketQua.loi)}
      </div>`;
  }

  _taoHtmlTraLoi(ketQua) {
    const thamChieu = ketQua.thamChieu.map(ma => `<span class="session-code-pill">${thoatHtmlAI(ma)}</span>`).join(" ");
    return `
      <div class="ai-answer">
        <div class="ai-answer-head">
          <span class="ai-answer-question"><i class="fa-regular fa-circle-question"></i> ${thoatHtmlAI(ketQua.cauHoi)}</span>
          <span class="ai-tag-ai"><i class="fa-solid fa-robot"></i> Do AI sinh ra</span>
        </div>
        <div class="ai-answer-content">${dinhDangTraLoiAI(ketQua.traLoi)}</div>
        ${thamChieu ? `<div class="ai-answer-refs"><span class="ai-muted">Tham chiếu:</span> ${thamChieu}</div>` : ""}
        <div class="ai-answer-footnote"><i class="fa-solid fa-circle-info"></i> ${CAU_HINH_CHE_DO_HOI_DAP[this.cheDo].chuThich}</div>
      </div>`;
  }
}

if (typeof window !== "undefined") {
  window.HoiDapAIController = HoiDapAIController;
}
