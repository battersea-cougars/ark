#!/usr/bin/env node
// The club's YouTube channel images, from the master logo (apps/web/src/assets/cougars.png), into brand/youtube/.
// Uploaded by hand as the club account: YouTube Studio → Customisation → Branding. Re-run after a logo change:
//   node scripts/youtube-images.mjs
//   avatar.png      800 px square, the whole logo on the site's dark background, inside YouTube's round crop
//   watermark.png   300 px square, the whole logo on transparent, for the corner of every video
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const LOGO = new URL("../apps/web/src/assets/cougars.png", import.meta.url);
const OUT = new URL("../brand/youtube/", import.meta.url);
const DARK = "#0b0b0c"; // the website's background
mkdirSync(OUT, { recursive: true });

const square = (size, background, input) =>
  sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input, gravity: "centre" }]);

// The whole logo in a 560 px box: clear of the circle YouTube crops it to
const logo = await sharp(LOGO.pathname).resize(560, 560, { fit: "inside" }).toBuffer();
await square(800, DARK, logo).png().toFile(new URL("avatar.png", OUT).pathname);

// The whole logo again, transparent, so only the logo sits over the video
const small = await sharp(LOGO.pathname).resize(300, 300, { fit: "inside" }).toBuffer();
await square(300, { r: 0, g: 0, b: 0, alpha: 0 }, small).png().toFile(new URL("watermark.png", OUT).pathname);

console.log("brand/youtube/avatar.png, brand/youtube/watermark.png");
