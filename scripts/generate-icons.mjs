// 확장 프로그램 아이콘(16/48/128)을 순수 Node(zlib만 사용, 외부 의존성 없음)로 생성한다.
// 브랜드 컬러 배경(#2a78d6) 위에 막대그래프 모양(시리즈별 조회수 "집계"를 상징)을 흰색으로 그린다.
// 4배 슈퍼샘플링 후 다운스케일해서 별도 안티에일리어싱 코드 없이 매끈한 모서리를 얻는다.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT_DIR = "public/icons";
const SIZES = [16, 48, 128];
const SUPERSAMPLE = 4;

const BG = [0x2a, 0x78, 0xd6];
const FG = [0xff, 0xff, 0xff];

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const clampedR = Math.min(r, w / 2, h / 2);
  const inLeft = px < x + clampedR;
  const inRight = px > x + w - clampedR;
  const inTop = py < y + clampedR;
  const inBottom = py > y + h - clampedR;
  if ((inLeft || inRight) && (inTop || inBottom)) {
    const cx = inLeft ? x + clampedR : x + w - clampedR;
    const cy = inTop ? y + clampedR : y + h - clampedR;
    return (px - cx) ** 2 + (py - cy) ** 2 <= clampedR ** 2;
  }
  return true;
}

function renderSupersampled(size) {
  const s = size * SUPERSAMPLE;
  const pixels = new Uint8ClampedArray(s * s * 4);

  const bgRadius = s * 0.22;
  const margin = s * 0.24;
  const gap = s * 0.09;
  const barWidth = (s - margin * 2 - gap * 2) / 3;
  const bottom = s - margin;
  const heights = [s * 0.22, s * 0.36, s * 0.5];
  const barRadius = barWidth * 0.35;
  const bars = heights.map((h, i) => ({
    x: margin + i * (barWidth + gap),
    y: bottom - h,
    w: barWidth,
    h,
  }));

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * s + x) * 4;
      let color = null;
      if (insideRoundedRect(x, y, 0, 0, s, s, bgRadius)) {
        color = BG;
        for (const bar of bars) {
          if (insideRoundedRect(x, y, bar.x, bar.y, bar.w, bar.h, barRadius)) {
            color = FG;
            break;
          }
        }
      }
      if (color) {
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 255;
      }
    }
  }
  return pixels;
}

// SUPERSAMPLE x SUPERSAMPLE 블록을 평균 내려 다운스케일 (박스 필터 안티에일리어싱)
function downsample(pixels, size) {
  const s = size * SUPERSAMPLE;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const srcIdx = ((y * SUPERSAMPLE + sy) * s + (x * SUPERSAMPLE + sx)) * 4;
          r += pixels[srcIdx];
          g += pixels[srcIdx + 1];
          b += pixels[srcIdx + 2];
          a += pixels[srcIdx + 3];
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE;
      const dstIdx = (y * size + x) * 4;
      out[dstIdx] = r / n;
      out[dstIdx + 1] = g / n;
      out[dstIdx + 2] = b / n;
      out[dstIdx + 3] = a / n;
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 4;
      const dstIdx = rowStart + 1 + x * 4;
      raw[dstIdx] = pixels[srcIdx];
      raw[dstIdx + 1] = pixels[srcIdx + 1];
      raw[dstIdx + 2] = pixels[srcIdx + 2];
      raw[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const supersampled = renderSupersampled(size);
    const pixels = downsample(supersampled, size);
    const png = encodePng(pixels, size);
    fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), png);
  }
  console.log(`아이콘 생성 완료: ${SIZES.map((s) => `icon${s}.png`).join(", ")}`);
}

main();
