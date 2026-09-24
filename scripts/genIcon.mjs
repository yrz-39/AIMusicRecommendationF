/**
 * 生成 StudyMood DJ 应用图标（樱花 · 绘梨衣主题）。
 *
 * 纯 Node 实现：手绘 RGBA 像素 → zlib 压缩 → PNG chunk 组装 → png-to-ico 转 .ico。
 * 输出 build/icon.ico（electron-builder 使用）。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pngToIco from "png-to-ico";

const SIZE = 256;

/* ---------- 绘制 ---------- */

/** 5 片花瓣的圆心（围绕中心，起始角 -90° 朝上） */
const petals = Array.from({ length: 5 }, (_, i) => {
  const angle = (-90 + i * 72) * (Math.PI / 180);
  const R = 58; // 花瓣圆心到图标中心的距离
  return { x: SIZE / 2 + R * Math.cos(angle), y: SIZE / 2 + R * Math.sin(angle), r: 46 };
});

function colorAt(x, y) {
  // 背景：奶白 → 樱粉 的垂直渐变
  const t = y / SIZE;
  const r = 255;
  const g = Math.round(243 - 40 * t);
  const b = Math.round(246 - 15 * t);

  // 圆角矩形遮罩（边距 8，圆角 52）
  const m = 8, rad = 52;
  const cx = Math.min(Math.max(x, m + rad), SIZE - m - rad);
  const cy = Math.min(Math.max(y, m + rad), SIZE - m - rad);
  const distCorner = Math.hypot(x - cx, y - cy);
  const inRounded = distCorner <= rad || (x >= m && x <= SIZE - m && y >= m && y <= SIZE - m && distCorner <= rad + 1);

  // 花瓣：白色，带抗锯齿软边
  let flowerA = 0;
  for (const p of petals) {
    const d = Math.hypot(x - p.x, y - p.y);
    flowerA = Math.max(flowerA, Math.min(1, Math.max(0, (p.r - d) / 1.5)));
  }
  // 花心：暖金圆
  const centerD = Math.hypot(x - SIZE / 2, y - SIZE / 2);
  const centerA = Math.min(1, Math.max(0, (24 - centerD) / 1.5));

  let rr = r, gg = g, bb = b, aa = 255;
  if (flowerA > 0) {
    // 花瓣白，微微透粉
    rr = Math.round(rr + (255 - rr) * flowerA);
    gg = Math.round(gg + (252 - gg) * flowerA);
    bb = Math.round(bb + (250 - bb) * flowerA);
  }
  if (centerA > 0) {
    rr = Math.round(rr + (232 - rr) * centerA);
    gg = Math.round(gg + (168 - gg) * centerA);
    bb = Math.round(bb + (110 - bb) * centerA);
  }
  return [rr, gg, bb, inRounded ? aa : 0];
}

function renderPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let off = 0;
  const scale = SIZE / size;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = colorAt(x * scale, y * scale);
      raw[off++] = r; raw[off++] = g; raw[off++] = b; raw[off++] = a;
    }
  }
  return encodePng(size, size, raw);
}

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 输出 ---------- */

mkdirSync("build", { recursive: true });
const png256 = renderPng(256);
writeFileSync(path.join("build", "icon.png"), png256);
const ico = await pngToIco([png256]);
writeFileSync(path.join("build", "icon.ico"), ico);
console.log("build/icon.ico + build/icon.png 已生成");
