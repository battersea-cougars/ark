// The club's branded email frame (ADR 0027, colours from ADR 0084), for the team app's sign-in code and the website's
// enquiry email. One quiet card, as a good transactional email is: the club's red bar along the top, the wordmark,
// then what the email is for, plainly; under it a tall footer that says who it's from. Email HTML is tables and inline
// styles, and no images, so it looks the same with images blocked. Anything a person typed goes through escapeHtml
// before it reaches the page.

export const EMAIL = {
  carbon: "#0e0d0b",
  panel: "#191715",
  raised: "#24211e",
  bone: "#efe8e1",
  muted: "#a6a09a",
  subtle: "#77716b",
  red: "#e5131f",
  yellow: "#ffd60a",
  display: "Anton, Impact, 'Arial Narrow Bold', 'Helvetica Neue', Arial, sans-serif",
  body: "'Inter Tight', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'SF Mono', Menlo, Consolas, 'Courier New', monospace",
} as const;

/** Who the club is, under every email. */
const CLUB = {
  name: "Battersea Cougars Inline Hockey Club",
  line: "Roller hockey in South West London, every Friday night",
  site: "batterseacougars.com",
  email: "batterseahockey@gmail.com",
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe to put in HTML, in an element or an attribute. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Styles for what goes in a card, so every email reads the same. */
export const EMAIL_TYPE = {
  heading: `margin:0 0 20px;font-family:${EMAIL.body};font-size:22px;line-height:1.3;font-weight:700;color:${EMAIL.bone};`,
  subheading: `margin:32px 0 8px;font-family:${EMAIL.body};font-size:17px;line-height:1.3;font-weight:700;color:${EMAIL.bone};`,
  text: `margin:0 0 12px;font-family:${EMAIL.body};font-size:16px;line-height:1.55;color:${EMAIL.muted};`,
};

/**
 * A whole email page: `panel` (HTML) in the card, then `footer` (HTML, what this email is about) above the club's own
 * footer. `preheader` is the line inbox lists show after the subject; `title` and `preheader` are plain text.
 */
export function emailPage({
  title,
  preheader,
  panel,
  footer = "",
  links = true,
}: {
  title: string;
  preheader: string;
  panel: string;
  footer?: string;
  /** The club's website and inbox as links. Off for the sign-in code: on a phone a link opens a browser, not the app. */
  links?: boolean;
}): string {
  const { carbon, panel: card, muted, subtle, bone, red, display, body } = EMAIL;
  const link = `color:${muted};text-decoration:underline;`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${carbon};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${carbon};">
<tr><td align="center" style="padding:40px 16px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
  <tr><td style="height:6px;line-height:6px;font-size:0;background:${red};border-radius:8px 8px 0 0;">&nbsp;</td></tr>
  <tr><td style="background:${card};border-radius:0 0 8px 8px;padding:36px 40px 40px;">
    <div style="margin:0 0 32px;font-family:${display};font-size:30px;line-height:1;font-style:italic;letter-spacing:1px;color:${bone};text-transform:uppercase;">Cougars</div>
${panel}
  </td></tr>
  <tr><td style="padding:40px 24px 64px;text-align:center;font-family:${body};font-size:13px;line-height:1.7;color:${subtle};">${
    footer ? `\n    <div style="margin:0 0 24px;color:${muted};">${footer}</div>` : ""
  }
    <div style="font-weight:600;color:${muted};">${CLUB.name}</div>
    <div>${CLUB.line}</div>
${
  links
    ? `    <div style="margin-top:12px;"><a href="https://${CLUB.site}" style="${link}">${CLUB.site}</a> &nbsp;·&nbsp; <a href="mailto:${CLUB.email}" style="${link}">${CLUB.email}</a></div>\n`
    : ""
}  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
