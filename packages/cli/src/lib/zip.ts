import { deflateRawSync } from 'node:zlib';

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  data: Uint8Array;
  /** Compress with deflate. Default true; some formats (EPUB's `mimetype`) require storing. */
  compress?: boolean;
}

/** DOS date and time, as ZIP wants them. */
function dos(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

/** A ZIP archive of the entries, in order. No ZIP64: at most 65,535 entries and 4 GB. */
export function createZip(
  entries: readonly ZipEntry[],
  now = new Date(),
): Uint8Array {
  if (entries.length > 0xffff)
    throw new Error('Too many files for a ZIP archive.');
  const stamp = dos(now);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const packed =
      entry.compress === false ? entry.data : deflateRawSync(entry.data);
    // Keep the smaller of the two, as every tool does.
    const stored =
      entry.compress === false || packed.length >= entry.data.length;
    const body = stored ? entry.data : packed;
    const method = stored ? 0 : 8;
    const crc = crc32(entry.data);
    if (offset + body.length > 0xffffffff)
      throw new Error('The archive is larger than 4 GB.');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, body);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, method, true);
    header.setUint16(12, stamp.time, true);
    header.setUint16(14, stamp.date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, body.length, true);
    header.setUint32(24, entry.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + body.length;
  }

  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);

  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
