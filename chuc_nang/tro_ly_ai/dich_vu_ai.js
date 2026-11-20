/**
 * DỊCH VỤ AI PHÍA TRÌNH DUYỆT
 * Gọi các endpoint /api/ai/* của may_chu.js. API key KHÔNG bao giờ nằm ở frontend.
 * Mỗi phản hồi có kèm "hanMuc" -> gọi onHanMuc để giao diện cập nhật quota.
 */

class DichVuAI {
  constructor(dbEngine) {
    this.apiBase = (dbEngine && dbEngine.apiBase) || "http://localhost:3000/api";
    this.coMayChu = Boolean(dbEngine && dbEngine.isServerMode);
    this.onHanMuc = null;
  }

  async _fetch(duongDan, tuyChon) {
    try {
      return await fetch(`${this.apiBase}${duongDan}`, {
        headers: { "Content-Type": "application/json" },
        ...tuyChon
      });
    } catch (e) {
      throw new Error("Không kết nối được máy chủ. Hãy chạy start.bat (hoặc node may_chu.js).");
    }
  }

  async _goi(duongDan, tuyChon = {}) {
    const response = await this._fetch(duongDan, tuyChon);
    const duLieu = await response.json().catch(() => ({}));
    if (duLieu.hanMuc && this.onHanMuc) this.onHanMuc(duLieu.hanMuc);
    if (!response.ok || !duLieu.ok) {
      throw new Error(duLieu.error || duLieu.loi || `Lỗi máy chủ AI (HTTP ${response.status}).`);
    }
    return duLieu;
  }

  _post(duongDan, body) {
    return this._goi(duongDan, { method: "POST", body: JSON.stringify(body) });
  }

  async kiemTraTrangThai() {
    if (!this.coMayChu) {
      return { ok: false, loi: "Trợ lý AI cần máy chủ. Hãy chạy start.bat và mở http://localhost:3000" };
    }
    try {
      return await this._goi("/ai/trang_thai", { method: "GET" });
    } catch (e) {
      return { ok: false, loi: e.message };
    }
  }

  layHanMuc() {
    return this._goi("/ai/han_muc", { method: "GET" });
  }

  // #1 Chẩn đoán từ mô tả
  trichXuatTrieuChung(cauHoi, danhMuc) {
    return this._post("/ai/trich_xuat", { cauHoi, danhMuc });
  }

  dienGiaiKetQua(duLieu) {
    return this._post("/ai/dien_giai", duLieu);
  }

  // #2 Hỏi về lịch sử chẩn đoán (dữ liệu do máy chủ tự đọc từ SQLite)
  hoiLichSu(cauHoi, hoiThoai) {
    return this._post("/ai/hoi_lich_su", { cauHoi, hoiThoai });
  }

  // #3 Tra cứu cơ sở tri thức (gửi kèm tri thức mà động cơ suy diễn đang dùng)
  traCuuTriThuc(cauHoi, hoiThoai, kb) {
    const triThuc = {
      symptomGroups: kb.symptomGroups || [],
      symptoms: kb.symptoms || [],
      diseases: (kb.diseases || []).map(({ frame, ...benh }) => benh),
      rules: kb.rules || []
    };
    return this._post("/ai/tra_cuu_tri_thuc", { cauHoi, hoiThoai, triThuc });
  }

  // Lịch sử các lần hỏi AI (máy chủ tự ghi sau mỗi lần gọi AI)
  layLichSuHoi() {
    return this._goi("/ai/lich_su_hoi", { method: "GET" });
  }

  xoaLichSuHoi(id) {
    const duongDan = id === undefined ? "/ai/lich_su_hoi" : `/ai/lich_su_hoi/${encodeURIComponent(id)}`;
    return this._goi(duongDan, { method: "DELETE" });
  }
}

if (typeof window !== "undefined") {
  window.DichVuAI = DichVuAI;
}
