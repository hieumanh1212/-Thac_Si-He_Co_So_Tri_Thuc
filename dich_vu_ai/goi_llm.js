/**
 * GỌI LLM (GEMINI / OLLAMA) VỚI ĐẦU RA JSON THEO SCHEMA
 * Hỗ trợ hội thoại nhiều lượt (hoiThoai) và ghi nhận hạn mức sử dụng.
 *
 * yeuCau = { heThong, nguoiDung, schema, hoiThoai?: [{ vaiTro: 'user'|'ai', noiDung }] }
 */

const { layMang, catChuoi, docJSON } = require('./tien_ich.js');
const { ghiNhanYeuCau, ghiNhan429 } = require('./han_muc.js');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const SO_LUOT_HOI_THOAI_TOI_DA = 6;
const TEN_LOAI_HAN_MUC = { ngay: ' theo ngày', phut: ' theo phút', token: ' theo số token', khac: '' };

// ---------------------------------------------------------------------------
// Tiện ích chung
// ---------------------------------------------------------------------------

// Gemini dùng kiểu dữ liệu viết hoa (OpenAPI subset): "object" -> "OBJECT"
function chuyenSchemaSangGemini(schema) {
  if (Array.isArray(schema)) return schema.map(chuyenSchemaSangGemini);
  if (!schema || typeof schema !== 'object') return schema;
  const ketQua = {};
  for (const [khoa, giaTri] of Object.entries(schema)) {
    ketQua[khoa] = khoa === 'type' ? String(giaTri).toUpperCase() : chuyenSchemaSangGemini(giaTri);
  }
  return ketQua;
}

function tachJSON(vanBan) {
  const sach = String(vanBan || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const duLieu = docJSON(sach, null);
  if (!duLieu) throw new Error('AI trả về dữ liệu không đúng định dạng JSON.');
  return duLieu;
}

function chuanHoaHoiThoai(hoiThoai) {
  return layMang(hoiThoai)
    .filter(luot => luot && luot.noiDung)
    .slice(-SO_LUOT_HOI_THOAI_TOI_DA)
    .map(luot => ({ laAI: luot.vaiTro === 'ai', noiDung: catChuoi(luot.noiDung, 1500) }));
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

function taoCauHinhSinhGemini(cauHinh, schema) {
  const generationConfig = {
    temperature: 0.1,
    responseMimeType: 'application/json',
    responseSchema: chuyenSchemaSangGemini(schema)
  };
  const budget = Number.parseInt(cauHinh.geminiThinkingBudget, 10);
  if (Number.isInteger(budget)) {
    generationConfig.thinkingConfig = { thinkingBudget: budget };
  }
  return generationConfig;
}

function taoNoiDungGemini({ nguoiDung, hoiThoai }) {
  const cacLuot = chuanHoaHoiThoai(hoiThoai).map(luot => ({
    role: luot.laAI ? 'model' : 'user',
    parts: [{ text: luot.noiDung }]
  }));
  return [...cacLuot, { role: 'user', parts: [{ text: nguoiDung }] }];
}

async function taoLoiGemini(response) {
  const vanBan = await response.text().catch(() => '');
  if (response.status === 429) {
    const chiTiet = ghiNhan429(docJSON(vanBan, {}));
    const thuLai = chiTiet.thuLaiSauGiay ? ` Thử lại sau khoảng ${Math.ceil(chiTiet.thuLaiSauGiay)} giây.` : ' Vui lòng thử lại sau.';
    return new Error(`Gemini báo đã vượt hạn mức miễn phí${TEN_LOAI_HAN_MUC[chiTiet.loai]}.${thuLai}`);
  }
  if (response.status === 503) {
    return new Error('Gemini đang quá tải tạm thời (HTTP 503). Vui lòng thử lại sau ít giây.');
  }
  return new Error(`Gemini API lỗi HTTP ${response.status}: ${vanBan.slice(0, 300)}`);
}

async function goiGemini(cauHinh, yeuCau) {
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(cauHinh.model)}:generateContent`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cauHinh.geminiKey },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: yeuCau.heThong }] },
        contents: taoNoiDungGemini(yeuCau),
        generationConfig: taoCauHinhSinhGemini(cauHinh, yeuCau.schema)
      })
    });
  } catch (e) {
    throw new Error(`Gemini không phản hồi kịp (${e.name === 'TimeoutError' ? 'quá 60 giây' : e.message}). Hãy thử lại hoặc đổi GEMINI_MODEL trong .env.`);
  }
  if (!response.ok) throw await taoLoiGemini(response);

  const duLieu = await response.json();
  ghiNhanYeuCau(duLieu.usageMetadata && duLieu.usageMetadata.totalTokenCount);
  const parts = (duLieu.candidates && duLieu.candidates[0] && duLieu.candidates[0].content
    && duLieu.candidates[0].content.parts) || [];
  return tachJSON(parts.map(p => p.text || '').join(''));
}

// ---------------------------------------------------------------------------
// Ollama (chạy cục bộ)
// ---------------------------------------------------------------------------

function taoTinNhanOllama({ heThong, nguoiDung, hoiThoai }) {
  const cacLuot = chuanHoaHoiThoai(hoiThoai).map(luot => ({
    role: luot.laAI ? 'assistant' : 'user',
    content: luot.noiDung
  }));
  return [{ role: 'system', content: heThong }, ...cacLuot, { role: 'user', content: nguoiDung }];
}

async function goiOllama(cauHinh, yeuCau) {
  let response;
  try {
    response = await fetch(`${cauHinh.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: cauHinh.model,
        stream: false,
        format: yeuCau.schema,
        options: { temperature: 0.1 },
        messages: taoTinNhanOllama(yeuCau)
      })
    });
  } catch (e) {
    throw new Error(`Không kết nối được Ollama tại ${cauHinh.ollamaUrl}. Hãy cài Ollama và chạy "ollama pull ${cauHinh.model}".`);
  }
  if (!response.ok) {
    const vanBan = await response.text().catch(() => '');
    throw new Error(`Ollama lỗi HTTP ${response.status}: ${vanBan.slice(0, 300)}`);
  }
  const duLieu = await response.json();
  return tachJSON(duLieu && duLieu.message && duLieu.message.content);
}

async function goiAI(cauHinh, yeuCau) {
  if (cauHinh.nhaCungCap === 'gemini') return goiGemini(cauHinh, yeuCau);
  return goiOllama(cauHinh, yeuCau);
}

module.exports = { goiAI };
