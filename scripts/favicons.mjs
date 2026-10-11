#!/usr/bin/env node
// The icons for the website and the team app, the same in both (ADR 0101): the "C" of COUGARS from the logo, white
// with the logo's black outline, on logo red. Re-run after a change: node scripts/favicons.mjs
//   favicon.ico            16, 32 and 48 px, for browsers and Google Search (which asks for /favicon.ico)
//   favicon.png            96 px (Google wants a multiple of 48)
//   apple-touch-icon.png   180 px, square (iOS rounds the corners itself)
//   icon-192.png, icon-512.png, icon-maskable-512.png   for manifest.webmanifest (Android)
//   the store app's (ADR 0108): its 1024 px App Store icon (square, no transparency: Apple rounds it) and a plain carbon
//   launch screen, in apps/team/ios
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const apps = ["web", "team"].map((app) => new URL(`../apps/${app}/public/`, import.meta.url));
const RED = "#e5131f";
const BIG = 1024; // drawn once at this size, then scaled down

// The C's white fill, traced from apps/web/src/assets/cougars.png in its pixels (2026-10-09): no font has it, it's
// the logo's own lettering. Its box is x 128–340, y 787–1022.
const C =
  "M241 789 L340 787 L309 861 L270 861 L282 824 L252 824 Q246 824 244 830 L189 989 L259 987 L241 1022 L138 1022 " +
  "Q128 1022 131 1012 L198 830 Q213 789 241 789 Z";
const BOX = { x: 234, y: 904.5, height: 235 }; // its centre and height
const OUTLINE = 6; // the logo's black ring, in the same pixels

/**
 * A red tile with the letter centred. `height`: the letter's height as a share of the tile. `radius`: corner
 * rounding as a share of the side (0 = square, for icons the device rounds or masks itself).
 */
async function icon(size, { height = 0.66, radius = 0.22 } = {}) {
  const scale = (BIG * height) / BOX.height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BIG}" height="${BIG}">
    <rect width="${BIG}" height="${BIG}" rx="${BIG * radius}" fill="${RED}"/>
    <g transform="translate(${BIG / 2} ${BIG / 2}) scale(${scale}) translate(${-BOX.x} ${-BOX.y})">
      <path d="${C}" fill="#fff" stroke="#000" stroke-width="${OUTLINE * 2}" stroke-linejoin="round"/>
      <path d="${C}" fill="#fff"/>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

// An .ico is a small directory of PNGs.
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size % 256, e);
    header.writeUInt8(size % 256, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const files = {
  "favicon.ico": ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await icon(size) })))),
  "favicon.png": await icon(96),
  "apple-touch-icon.png": await icon(180, { radius: 0 }),
  "icon-192.png": await icon(192),
  "icon-512.png": await icon(512),
  // Android crops maskable icons to a circle or squircle: full-bleed red, the letter inside the safe middle.
  "icon-maskable-512.png": await icon(512, { radius: 0, height: 0.5 }),
};
for (const dir of apps) for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, dir), data);
console.log(`Wrote ${Object.keys(files).join(", ")} to apps/web/public and apps/team/public`);

const ios = new URL("../apps/team/ios/App/App/Assets.xcassets/", import.meta.url);
writeFileSync(
  new URL("AppIcon.appiconset/AppIcon-512@2x.png", ios),
  await sharp(await icon(1024, { radius: 0 }))
    .removeAlpha()
    .png()
    .toBuffer(),
);
const carbon = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: "#0e0d0b" } })
  .png()
  .toBuffer();
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"])
  writeFileSync(new URL(`Splash.imageset/${name}`, ios), carbon);
console.log("Wrote the store app's icon and launch screen to apps/team/ios");
