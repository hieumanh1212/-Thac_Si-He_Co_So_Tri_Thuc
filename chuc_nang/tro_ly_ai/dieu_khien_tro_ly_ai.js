/**
 * ============================================================================
 * CONTROLLER: TRỢ LÝ AI CHẨN ĐOÁN (KIẾN TRÚC LAI NEURO-SYMBOLIC)
 * ============================================================================
 * Luồng xử lý:
 *   [1] Người dùng gõ lời kể tự nhiên
 *   [2] AI trích xuất -> {mã triệu chứng: CF}   (chỉ các mã có trong KB hiện tại)
 *   [3] Người dùng rà soát / chỉnh sửa
 *   [4] ĐỘNG CƠ SUY DIỄN TIẾN (luật sinh + MYCIN) tính kết luận
 *       + ĐỘNG CƠ SUY DIỄN LÙI gợi ý triệu chứng nên hỏi thêm
 *   [5] AI diễn giải kết quả thành văn bản (không được đổi kết luận)
 *   [6] Người dùng xác nhận đã kiểm tra -> lưu "Lần chẩn đoán" với nhãn nguồn AI
 */

const CAC_MUC_CF_AI = [
  { value: 1.0, label: "Chắc chắn (1.0)" },
  { value: 0.8, label: "Khá chắc (0.8)" },
  { value: 0.6, label: "Có vẻ (0.6)" },
  { value: 0.4, label: "Nghi ngờ (0.4)" }
];

function thoatHtmlAI(giaTri) {
  return String(giaTri === undefined || giaTri === null ? "" : giaTri)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class TroLyAIController {
  constructor({ dbEngine, kbManager, dichVuAI, forwardEngine, backwardEngine }) {
    this.dbEngine = dbEngine;
    this.kbManager = kbManager;
    this.dichVuAI = dichVuAI;
    this.forwardEngine = forwardEngine;
    this.backwardEngine = backwardEngine;

    this.aiSanSang = false;
    this.dangXuLy = false;
    this.thongTinAI = { nhaCungCap: "", model: "" };
    this.cauHoi = "";
    this.ketQuaTrichXuat = null;
    this.trieuChungHienTai = new Map(); // ma -> { cf, bangChung }
    this.ketQuaSuyDien = null;
    this.goiYHoiThem = [];
    this.dienGiai = "";
    this.maLuotDienGiai = 0;
    this.ketQuaLoiThoi = false;
  }

  // ==========================================================================
  // KHỞI TẠO
  // ==========================================================================

  init() {
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      statusPill: $("aiStatusPill"),
      input: $("aiQuestionInput"),
      charCount: $("aiCharCount"),
      btnAnalyze: $("btnAiAnalyze"),
      loading: $("aiLoading"),
      loadingText: $("aiLoadingText"),
      resultArea: $("aiResultArea"),
      summary: $("aiSummaryText"),
      symptomList: $("aiSymptomList"),
      unmatched: $("aiUnmatchedBox"),
      btnRerun: $("btnAiRerun"),
      diagnosisList: $("aiDiagnosisList"),
      followUp: $("aiFollowUpBox"),
      explanation: $("aiExplanationText"),
      ack: $("aiAckCheckbox"),
      btnSave: $("btnAiSave"),
      btnOpenDiagnosis: $("btnAiOpenDiagnosis")
    };
  }

  bindEvents() {
    this.el.input.addEventListener("input", () => this.capNhatTrangThaiNut());
    this.el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this.phanTich();
    });
    this.el.btnAnalyze.addEventListener("click", () => this.phanTich());
    this.el.btnRerun.addEventListener("click", () => this.chaySuyDien());
    this.el.ack.addEventListener("change", () => this.capNhatTrangThaiNut());
    this.el.btnSave.addEventListener("click", () => this.luuPhien());
    this.el.btnOpenDiagnosis.addEventListener("click", () => this.moTrangChanDoan());
    this.el.symptomList.addEventListener("change", (e) => this._xuLyDoiCF(e));
    this.el.symptomList.addEventListener("click", (e) => this._xuLyXoaTrieuChung(e));
    document.querySelectorAll("#aiModeDiagnosis .ai-example-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        this.el.input.value = chip.dataset.example || "";
        this.capNhatTrangThaiNut();
        this.el.input.focus();
      });
    });
  }

  // Dùng khi "Hỏi lại" từ Lịch sử hỏi AI: chỉ điền mô tả, người dùng tự bấm Phân tích
  datMoTa(moTa) {
    this.el.input.value = moTa || "";
    this.capNhatTrangThaiNut();
    this.el.input.focus();
  }

  capNhatTriThuc(kb) {
    this.forwardEngine.setKnowledgeBase(kb);
    this.backwardEngine.setKnowledgeBase(kb);
  }

  capNhatTrangThaiNut() {
    const doDai = this.el.input.value.trim().length;
    this.el.charCount.textContent = `${this.el.input.value.length} / 2000`;
    this.el.btnAnalyze.disabled = !this.aiSanSang || this.dangXuLy || doDai < 5;
    this.el.btnSave.disabled = !this.el.ack.checked || !this.ketQuaSuyDien || this.ketQuaLoiThoi;
    this.el.btnRerun.classList.toggle("ai-rerun-needed", this.ketQuaLoiThoi);
  }

  // Triệu chứng đã bị sửa sau lần suy diễn gần nhất -> kết quả không còn khớp
  _danhDauLoiThoi() {
    this.ketQuaLoiThoi = true;
    this.el.ack.checked = false;
    this.capNhatTrangThaiNut();
  }

  // Nhận trạng thái AI (do trang kiểm tra một lần và chia sẻ cho các chế độ)
  apDungTrangThaiAI(trangThai) {
    this.aiSanSang = Boolean(trangThai.ok);
    this.thongTinAI = { nhaCungCap: trangThai.nhaCungCap || "", model: trangThai.model || "" };
    this._hienTrangThaiAI(trangThai);
    this.capNhatTrangThaiNut();
  }

  _hienTrangThaiAI(trangThai) {
    const pill = this.el.statusPill;
    if (trangThai.ok) {
      pill.className = "ai-status-pill ai-status-ok";
      pill.innerHTML = `<i class="fa-solid fa-circle-check"></i> AI sẵn sàng: ${thoatHtmlAI(trangThai.nhaCungCap)} / ${thoatHtmlAI(trangThai.model)}`;
      return;
    }
    pill.className = "ai-status-pill ai-status-off";
    pill.innerHTML = `<i class="fa-solid fa-plug-circle-xmark"></i> ${thoatHtmlAI(trangThai.loi || "AI chưa sẵn sàng")}`;
  }

  // ==========================================================================
  // BƯỚC 1-2: GỬI LỜI KỂ CHO AI TRÍCH XUẤT TRIỆU CHỨNG
  // ==========================================================================

  layDanhMucChoAI() {
    // Chỉ gửi triệu chứng gốc; hội chứng trung gian (HC) do động cơ suy diễn tự suy ra
    return (this.kbManager.getKB().symptoms || [])
      .filter(s => !s.isIntermediate && s.groupId !== "group_syndrome")
      .map(s => ({ id: s.id, name: s.name }));
  }

  async phanTich() {
    const cauHoi = this.el.input.value.trim();
    if (!this.aiSanSang || this.dangXuLy || cauHoi.length < 5) return;

    this._hienDangXuLy("AI đang đọc lời kể và trích xuất triệu chứng...");
    try {
      // Nạp lại tri thức mới nhất (chỉ đọc) -> danh mục triệu chứng & động cơ suy diễn luôn cập nhật
      await this.kbManager.lamMoiTuCSDL();
      const ketQua = await this.dichVuAI.trichXuatTrieuChung(cauHoi, this.layDanhMucChoAI());
      this.cauHoi = cauHoi;
      this.thongTinAI = { nhaCungCap: ketQua.nhaCungCap, model: ketQua.model };
      this._napKetQuaTrichXuat(ketQua);
      this.el.resultArea.hidden = false;
      this.chaySuyDien();
      this.el.resultArea.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      window.ThongBao.thatBai(e.message, "AI trích xuất thất bại");
    } finally {
      this._hienDangXuLy(null);
    }
  }

  _hienDangXuLy(thongDiep) {
    this.dangXuLy = Boolean(thongDiep);
    this.el.loading.hidden = !thongDiep;
    if (thongDiep) this.el.loadingText.textContent = thongDiep;
    this.capNhatTrangThaiNut();
  }

  _napKetQuaTrichXuat(ketQua) {
    this.ketQuaTrichXuat = ketQua;
    this.trieuChungHienTai = new Map(
      (ketQua.trieuChung || []).map(t => [t.ma, { cf: t.cf, bangChung: t.bangChung, loai: t.loai, lyDo: t.lyDo }])
    );
    this.el.summary.innerHTML = `<i class="fa-solid fa-quote-left"></i> ${thoatHtmlAI(ketQua.tomTat || "(AI không tóm tắt được mô tả)")}`;
    this.renderKhongKhop();
  }

  // ==========================================================================
  // BƯỚC 3-4: RÀ SOÁT TRIỆU CHỨNG & CHẠY ĐỘNG CƠ SUY DIỄN
  // ==========================================================================

  layFactsHienTai() {
    const facts = {};
    this.trieuChungHienTai.forEach((info, ma) => { facts[ma] = info.cf; });
    return facts;
  }

  chaySuyDien() {
    const facts = this.layFactsHienTai();
    this.ketQuaSuyDien = this.forwardEngine.infer(facts);
    this.goiYHoiThem = this.layGoiYHoiThem(facts);
    this.ketQuaLoiThoi = false;
    this.el.ack.checked = false;

    this.renderTrieuChung();
    this.renderKetQua();
    this.renderGoiYHoiThem();
    this.capNhatTrangThaiNut();
    this.dienGiaiBangAI();
  }

  _tenTrieuChung(ma) {
    const sym = (this.kbManager.getKB().symptoms || []).find(s => s.id === ma);
    return sym ? sym.name : ma;
  }

  renderTrieuChung() {
    if (this.trieuChungHienTai.size === 0) {
      this.el.symptomList.innerHTML = `
        <div class="ai-empty">
          <i class="fa-solid fa-circle-question"></i>
          AI không tìm thấy triệu chứng nào khớp với cơ sở tri thức. Hãy mô tả cụ thể hơn
          hoặc chọn triệu chứng thủ công ở trang Chẩn đoán.
        </div>`;
      return;
    }
    const dong = [];
    this.trieuChungHienTai.forEach((info, ma) => dong.push(this._taoDongTrieuChung(ma, info)));
    this.el.symptomList.innerHTML = dong.join("");
  }

  _taoDongTrieuChung(ma, info) {
    const options = CAC_MUC_CF_AI.map(muc =>
      `<option value="${muc.value}" ${Number(info.cf) === muc.value ? "selected" : ""}>${muc.label}</option>`
    ).join("");
    const bangChung = info.bangChung
      ? `<div class="ai-evidence"><i class="fa-solid fa-quote-left"></i> Căn cứ trong mô tả: "${thoatHtmlAI(info.bangChung)}"</div>`
      : `<div class="ai-evidence ai-evidence-missing">Không có căn cứ trích dẫn. Cần kiểm tra kỹ.</div>`;
    return `
      <div class="ai-symptom-row ${info.loai === "suy_luan" ? "ai-symptom-inferred" : ""}">
        <div class="ai-symptom-main">
          <span class="session-code-pill">${thoatHtmlAI(ma)}</span>
          <strong>${thoatHtmlAI(this._tenTrieuChung(ma))}</strong>
          ${this._taoNhanLoaiTrieuChung(info)}
          ${bangChung}
        </div>
        <select class="form-control ai-cf-select" data-ma="${thoatHtmlAI(ma)}" title="Mức độ chắc chắn (CF)">${options}</select>
        <button type="button" class="ai-remove-btn" data-remove="${thoatHtmlAI(ma)}" title="Xóa triệu chứng này">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>`;
  }

  // "Trích dẫn" = được nói trực tiếp; "AI suy luận" = suy ra từ chi tiết lâm sàng (CF tối đa 0.6)
  _taoNhanLoaiTrieuChung(info) {
    if (info.loai !== "suy_luan") {
      return `<span class="ai-kind-badge ai-kind-quote">Trích dẫn</span>`;
    }
    const lyDo = info.lyDo ? `<div class="ai-evidence ai-evidence-reason"><i class="fa-solid fa-lightbulb"></i> Lý do suy luận: ${thoatHtmlAI(info.lyDo)}</div>` : "";
    return `<span class="ai-kind-badge ai-kind-inferred">AI suy luận</span>${lyDo}`;
  }

  _taoHtmlCanhBao(canhBao) {
    if (canhBao.length === 0) return "";
    return `
      <div class="ai-unmatched-title ai-warning-title"><i class="fa-solid fa-triangle-exclamation"></i> Lưu ý từ AI khi đọc mô tả:</div>
      <ul class="ai-note-list">${canhBao.map(t => `<li>${thoatHtmlAI(t)}</li>`).join("")}</ul>`;
  }

  _taoHtmlKhongKhop(khongKhop) {
    if (khongKhop.length === 0) return "";
    return `
      <div class="ai-unmatched-title"><i class="fa-solid fa-filter-circle-xmark"></i> Biểu hiện chưa có trong cơ sở tri thức (không dùng để suy diễn):</div>
      <div class="ai-chip-wrap">${khongKhop.map(t => `<span class="ai-chip-muted">${thoatHtmlAI(t)}</span>`).join("")}</div>`;
  }

  _taoHtmlMaBiLoai(biLoai) {
    if (biLoai.length === 0) return "";
    return `<div class="ai-muted">Đã tự động loại ${biLoai.length} mã AI đề xuất không hợp lệ / không có trong cơ sở tri thức: ${thoatHtmlAI(biLoai.join(", "))}</div>`;
  }

  renderKhongKhop() {
    const ketQua = this.ketQuaTrichXuat || {};
    const html = [
      this._taoHtmlCanhBao(ketQua.canhBao || []),
      this._taoHtmlKhongKhop(ketQua.khongKhopDuoc || []),
      this._taoHtmlMaBiLoai(ketQua.maBiLoai || [])
    ].join("");
    this.el.unmatched.innerHTML = html;
    this.el.unmatched.hidden = html.trim() === "";
  }

  _xuLyDoiCF(e) {
    const select = e.target.closest(".ai-cf-select");
    if (!select) return;
    const info = this.trieuChungHienTai.get(select.dataset.ma);
    if (!info) return;
    info.cf = Number(select.value);
    this._danhDauLoiThoi();
  }

  _xuLyXoaTrieuChung(e) {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    this.trieuChungHienTai.delete(btn.dataset.remove);
    this.renderTrieuChung();
    this._danhDauLoiThoi();
  }

  renderKetQua() {
    const results = (this.ketQuaSuyDien && this.ketQuaSuyDien.results) || [];
    if (results.length === 0) {
      this.el.diagnosisList.innerHTML = `
        <div class="ai-empty">
          <i class="fa-solid fa-circle-question"></i>
          Không có luật nào được kích hoạt đầy đủ với các triệu chứng hiện tại, nên động cơ suy diễn chưa đủ căn cứ để kết luận.
        </div>`;
      return;
    }
    this.el.diagnosisList.innerHTML = results.slice(0, 5).map((r, idx) => this._taoTheBenh(r, idx)).join("");
  }

  _taoTheBenh(r, idx) {
    const pct = Math.round((r.finalCF || 0) * 100);
    const nhan = (r.interpretation && r.interpretation.label) || "";
    const luat = (r.firedRules || []).map(f =>
      `<li><span class="session-code-pill">${thoatHtmlAI(f.ruleId)}</span> <code>${thoatHtmlAI(f.formulaStr)}</code></li>`
    ).join("");
    return `
      <div class="ai-disease-card ${idx === 0 ? "ai-disease-top" : ""}">
        <div class="ai-disease-head">
          <span class="ai-rank">#${idx + 1}</span>
          <strong>${thoatHtmlAI(r.diseaseName)}</strong>
          <span class="ai-cf-value">${pct}%</span>
        </div>
        <div class="ai-cf-bar"><div style="width: ${pct}%;"></div></div>
        <div class="ai-muted">CF = ${thoatHtmlAI(r.finalCF)} • ${thoatHtmlAI(nhan)}</div>
        <ul class="ai-rule-list">${luat}</ul>
      </div>`;
  }

  // Suy diễn lùi: tìm triệu chứng còn thiếu của bệnh dẫn đầu để gợi ý hỏi thêm
  layGoiYHoiThem(facts) {
    const top = (this.ketQuaSuyDien.results || [])[0];
    if (!top) return [];
    const danhGia = this.backwardEngine.evaluateHypothesis(top.diseaseId, facts);
    return ((danhGia && danhGia.missingSymptoms) || []).slice(0, 5).map(m => ({
      ten: m.symptom.name,
      lyDo: m.whyReason
    }));
  }

  renderGoiYHoiThem() {
    if (this.goiYHoiThem.length === 0) {
      this.el.followUp.hidden = true;
      return;
    }
    this.el.followUp.innerHTML = `
      <div class="ai-followup-title"><i class="fa-solid fa-circle-question"></i> Suy diễn lùi: nên kiểm tra thêm các triệu chứng sau (WHY)</div>
      <ul>${this.goiYHoiThem.map(g => `<li><strong>${thoatHtmlAI(g.ten)}</strong><br><span class="ai-muted">${thoatHtmlAI(g.lyDo)}</span></li>`).join("")}</ul>`;
    this.el.followUp.hidden = false;
  }

  // ==========================================================================
  // BƯỚC 5: AI DIỄN GIẢI KẾT QUẢ (CHẠY NỀN, KHÔNG CHẶN GIAO DIỆN)
  // ==========================================================================

  _taoDuLieuDienGiai() {
    const results = (this.ketQuaSuyDien && this.ketQuaSuyDien.results) || [];
    const trieuChung = [];
    this.trieuChungHienTai.forEach((info, ma) => trieuChung.push(`${this._tenTrieuChung(ma)} (CF ${info.cf})`));
    return {
      trieuChung,
      ketQua: results.slice(0, 5).map(r => ({
        ten: r.diseaseName,
        cf: r.finalCF,
        luat: (r.firedRules || []).map(f => `${f.ruleId}: ${f.ruleName || ""}`)
      })),
      nenKiemTraThem: this.goiYHoiThem.map(g => g.ten)
    };
  }

  async dienGiaiBangAI() {
    const maLuot = ++this.maLuotDienGiai;
    this.dienGiai = "";
    this.el.explanation.innerHTML = `<span class="ai-muted"><i class="fa-solid fa-circle-notch fa-spin"></i> AI đang viết diễn giải...</span>`;
    try {
      const ketQua = await this.dichVuAI.dienGiaiKetQua(this._taoDuLieuDienGiai());
      if (maLuot !== this.maLuotDienGiai) return; // đã có lượt suy diễn mới hơn
      this.dienGiai = ketQua.dienGiai || "";
      this.el.explanation.innerHTML = thoatHtmlAI(this.dienGiai).replace(/\n/g, "<br>");
    } catch (e) {
      if (maLuot !== this.maLuotDienGiai) return;
      this.el.explanation.innerHTML = `<span class="ai-muted"><i class="fa-solid fa-triangle-exclamation"></i> Không tạo được diễn giải: ${thoatHtmlAI(e.message)}. Kết quả ở Bước 2 vẫn hợp lệ.</span>`;
    }
  }

  // ==========================================================================
  // BƯỚC 6: LƯU "LẦN CHẨN ĐOÁN" VỚI NHÃN NGUỒN AI
  // ==========================================================================

  _taoAiMeta() {
    const trichXuat = this.ketQuaTrichXuat || {};
    const bangChung = {};
    this.trieuChungHienTai.forEach((info, ma) => { bangChung[ma] = info.bangChung || ""; });
    const goc = {};
    (trichXuat.trieuChung || []).forEach(t => { goc[t.ma] = t.cf; });
    return {
      cauHoi: this.cauHoi,
      tomTat: trichXuat.tomTat || "",
      bangChung,
      trieuChungAIGoc: goc,
      daChinhSua: JSON.stringify(goc) !== JSON.stringify(this.layFactsHienTai()),
      khongKhopDuoc: trichXuat.khongKhopDuoc || [],
      canhBao: trichXuat.canhBao || [],
      cacMaSuyLuan: [...this.trieuChungHienTai].filter(([, info]) => info.loai === "suy_luan").map(([ma]) => ma),
      dienGiai: this.dienGiai,
      nhaCungCap: this.thongTinAI.nhaCungCap,
      model: this.thongTinAI.model
    };
  }

  async luuPhien() {
    if (!this.el.ack.checked || !this.ketQuaSuyDien) return;
    if (this.trieuChungHienTai.size === 0) {
      window.ThongBao.canhBao("Không có triệu chứng nào để lưu.");
      return;
    }
    this.el.btnSave.disabled = true;
    try {
      await this.dbEngine.saveInferenceSession(
        this.layFactsHienTai(),
        this.ketQuaSuyDien.results || [],
        this.ketQuaSuyDien.traceLogs || [],
        { nguon: "AI", aiMeta: this._taoAiMeta() }
      );
      window.ThongBao.thanhCong("Đã lưu lần chẩn đoán (nhãn: Sinh từ AI) vào Lịch sử.");
      this.el.ack.checked = false;
    } catch (e) {
      window.ThongBao.thatBai(`Không lưu được phiên: ${e.message}`);
    } finally {
      this.capNhatTrangThaiNut();
    }
  }

  moTrangChanDoan() {
    sessionStorage.setItem("RELOAD_DIAGNOSIS_SYMPTOMS", JSON.stringify(this.layFactsHienTai()));
    window.location.href = "../chan_doan/chan_doan.html";
  }
}

if (typeof window !== "undefined") {
  window.TroLyAIController = TroLyAIController;
}
