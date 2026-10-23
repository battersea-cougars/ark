#!/usr/bin/env node
// The images the club uploads by hand to outside services, from the master logo (apps/web/src/assets/cougars.png),
// into brand/ (brand/README.md says where each goes). Re-run after a logo change:
//   node scripts/brand-images.mjs
// YouTube (brand/youtube/), uploaded as the club account: YouTube Studio → Customisation → Branding
//   avatar.png      800 px square, the whole logo on the site's dark background, inside YouTube's round crop
//   watermark.png   300 px square, the whole logo on transparent, for the corner of every video
//   banner.png      2048×1152, the home page's carbon background with the logo in the middle 1235×338, the part
//                   YouTube shows on every screen (TVs show the rest)
// Google (brand/google/): Google Auth Platform → Branding, the app logo on the consent screen (#156)
//   logo.png        120 px square, Google's size, the whole logo on the site's dark background
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const LOGO = new URL("../apps/web/src/assets/cougars.png", import.meta.url);
const CARBON = new URL("../apps/web/src/assets/cougars_background.png", import.meta.url);
const OUT = new URL("../brand/youtube/", import.meta.url);
const GOOGLE = new URL("../brand/google/", import.meta.url);
const DARK = "#0b0b0c"; // the website's background
mkdirSync(OUT, { recursive: true });
mkdirSync(GOOGLE, { recursive: true });

const square = (size, background, input) =>
  sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input, gravity: "centre" }]);

// The whole logo in a 560 px box: clear of the circle YouTube crops it to
const logo = await sharp(LOGO.pathname).resize(560, 560, { fit: "inside" }).toBuffer();
await square(800, DARK, logo).png().toFile(new URL("avatar.png", OUT).pathname);

// The whole logo again, transparent, so only the logo sits over the video
const small = await sharp(LOGO.pathname).resize(300, 300, { fit: "inside" }).toBuffer();
await square(300, { r: 0, g: 0, b: 0, alpha: 0 }, small).png().toFile(new URL("watermark.png", OUT).pathname);

// The banner: the logo fills the safe strip's height, with a little room
const strip = await sharp(LOGO.pathname).resize(1235, 300, { fit: "inside" }).toBuffer();
await sharp(CARBON.pathname)
  .resize(2048, 1152, { fit: "cover" })
  .composite([{ input: strip, gravity: "centre" }])
  .png()
  .toFile(new URL("banner.png", OUT).pathname);

// Google's consent screen: small, so the logo nearly fills it
const mark = await sharp(LOGO.pathname).resize(104, 104, { fit: "inside" }).toBuffer();
await square(120, DARK, mark).png().toFile(new URL("logo.png", GOOGLE).pathname);

console.log("brand/youtube/avatar.png, watermark.png, banner.png; brand/google/logo.png");
