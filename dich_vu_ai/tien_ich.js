/**
 * TIỆN ÍCH DÙNG CHUNG CHO DỊCH VỤ AI
 */

function layMang(giaTri) {
  return Array.isArray(giaTri) ? giaTri : [];
}

function catChuoi(giaTri, doDaiToiDa) {
  const chuoi = giaTri === undefined || giaTri === null ? '' : String(giaTri);
  return chuoi.slice(0, doDaiToiDa);
}

function docJSON(vanBan, macDinh) {
  try {
    return vanBan ? JSON.parse(vanBan) : macDinh;
  } catch (e) {
    return macDinh;
  }
}

function soNguyenDuong(giaTri) {
  const so = Number.parseInt(giaTri, 10);
  return Number.isInteger(so) && so > 0 ? so : null;
}

module.exports = { layMang, catChuoi, docJSON, soNguyenDuong };
