/**
 * CẤU HÌNH NHÀ CUNG CẤP AI (đọc từ biến môi trường / file .env)
 *
 *   AI_PROVIDER            = gemini | ollama   (mặc định: gemini nếu có key, ngược lại ollama)
 *   GEMINI_API_KEY         = <key lấy từ https://aistudio.google.com/apikey>
 *   GEMINI_MODEL           = gemini-3.5-flash-lite  (free tier: 15 RPM, 500 RPD)
 *   GEMINI_THINKING_BUDGET = để trống với Flash Lite; 0 với Flash (tắt "suy nghĩ")
 *   GEMINI_RPD_LIMIT       = hạn mức số yêu cầu / ngày (xem trong AI Studio)
 *   GEMINI_RPM_LIMIT       = hạn mức số yêu cầu / phút (xem trong AI Studio)
 *   OLLAMA_URL             = http://localhost:11434
 *   OLLAMA_MODEL           = qwen2.5:7b
 */

const { soNguyenDuong } = require('./tien_ich.js');

function layCauHinhAI() {
  const env = process.env;
  const coKeyGemini = Boolean(env.GEMINI_API_KEY);
  const nhaCungCap = (env.AI_PROVIDER || (coKeyGemini ? 'gemini' : 'ollama')).toLowerCase();
  const model = nhaCungCap === 'gemini'
    ? (env.GEMINI_MODEL || 'gemini-3.5-flash-lite')
    : (env.OLLAMA_MODEL || 'qwen2.5:7b');
  return {
    nhaCungCap,
    model,
    geminiKey: env.GEMINI_API_KEY || '',
    geminiThinkingBudget: env.GEMINI_THINKING_BUDGET,
    gioiHanNgay: soNguyenDuong(env.GEMINI_RPD_LIMIT),
    gioiHanPhut: soNguyenDuong(env.GEMINI_RPM_LIMIT),
    ollamaUrl: (env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')
  };
}

function kiemTraCauHinh(cauHinh) {
  if (cauHinh.nhaCungCap === 'gemini' && !cauHinh.geminiKey) {
    return 'Chưa cấu hình GEMINI_API_KEY trong file .env.';
  }
  if (!['gemini', 'ollama'].includes(cauHinh.nhaCungCap)) {
    return `AI_PROVIDER không hợp lệ: "${cauHinh.nhaCungCap}" (chỉ hỗ trợ gemini | ollama).`;
  }
  return null;
}

module.exports = { layCauHinhAI, kiemTraCauHinh };
