# Brand images for outside services

Images the club uploads by hand to other services. They're made from the master logo, which stays with the website
(`apps/web/src/assets/cougars.png`), by a script, so a logo change is one re-run.

| Folder     | For                                                                                                                                                                          | Made by                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `youtube/` | The channel's picture (`avatar.png`), banner (`banner.png`) and video watermark (`watermark.png`), uploaded as the club account in YouTube Studio → Customisation → Branding | `node scripts/youtube-images.mjs` |

The website's and the team app's own icons are made by `scripts/favicons.mjs` into each app's `public/` (ADR 0101).
