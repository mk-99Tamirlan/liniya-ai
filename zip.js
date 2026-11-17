function crc32(bytes) {
  let crc = -1;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
export function buildZip(files) {
  // ZIP Store format, implemented without libraries; supported by Windows Explorer.
  const encoder = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
  const dosTime = ((new Date().getHours() & 31) << 11) | ((new Date().getMinutes() & 63) << 5);
  const now = new Date(); const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  for (const [filename, content] of files) {
    const name = encoder.encode(filename), data = encoder.encode(content), checksum = crc32(data);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, checksum, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
    chunks.push(header, data);
    const c = new Uint8Array(46 + name.length), v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true); v.setUint16(12, dosTime, true); v.setUint16(14, dosDate, true); v.setUint32(16, checksum, true);
    v.setUint32(20, data.length, true); v.setUint32(24, data.length, true); v.setUint16(28, name.length, true);
    v.setUint32(42, offset, true); c.set(name, 46); central.push(c); offset += header.length + data.length;
  }
  const centralSize = central.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
