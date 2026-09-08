const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const dependencyRoot = process.env.MACAO_NODE_MODULES;
const load = dependencyRoot
  ? createRequire(path.join(dependencyRoot, 'package.json'))
  : require;
const sharp = load('sharp');
const { chromium } = load('playwright');
const { icons } = load('lucide');

async function iconData(name) {
  const elements = icons[name].map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF0006" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${elements}</svg>`;
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')}`;
}

async function main() {
  const logo = await fs.readFile(path.join(__dirname, 'LogoMACAO.png'));
  const logoData = `data:image/png;base64,${logo.toString('base64')}`;
  const contacts = [
    ['Phone', 'tel:+50495093233', '+504 9509 3233'],
    ['Mail', 'mailto:ccaceres@macaosolutions.com', 'ccaceres@macaosolutions.com'],
    ['Globe', 'https://macaosolutions.com', 'macaosolutions.com'],
  ];
  const rows = [];
  for (const [icon, href, label] of contacts) {
    rows.push(`<tr><td width="27" style="width:27px;padding:4px 0;vertical-align:middle;"><img src="${await iconData(icon)}" width="16" height="16" alt="" style="display:block;border:0;"></td><td style="padding:4px 0;font-size:14px;line-height:19px;vertical-align:middle;"><a href="${href}" style="color:#484447;text-decoration:none;">${label}</a></td></tr>`);
  }
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Arturo C\u00e1ceres | MACAO Solutions</title></head>
<body style="margin:0;background:#ffffff;">
<table id="firma" role="presentation" cellpadding="0" cellspacing="0" border="0" width="650" style="width:650px;border-collapse:collapse;background:#ffffff;font-family:Arial,Helvetica,sans-serif;letter-spacing:0;color:#242021;">
  <tr>
    <td width="182" style="width:182px;padding:24px 0;text-align:center;vertical-align:middle;">
      <a href="https://macaosolutions.com" style="text-decoration:none;"><img src="${logoData}" alt="MACAO" width="110" height="137" style="display:block;width:110px;height:137px;margin:0 auto;border:0;"></a>
      <div style="margin-top:5px;font-size:11px;line-height:14px;color:#555154;">Solutions</div>
    </td>
    <td width="2" style="width:2px;padding:27px 0;vertical-align:middle;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="2" style="width:2px;border-collapse:collapse;"><tr><td height="152" bgcolor="#FF0006" style="height:152px;width:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
    </td>
    <td style="padding:24px 24px 24px 27px;vertical-align:middle;">
      <div style="font-size:26px;font-weight:700;line-height:31px;color:#242021;">ARTURO C\u00c1CERES</div>
      <div style="padding-top:3px;font-size:14px;font-weight:600;line-height:20px;color:#E00006;">Gerente General</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:15px;border-collapse:collapse;">${rows.join('\n')}</table>
    </td>
  </tr>
</table>
</body>
</html>`;
  const htmlPath = path.join(__dirname, 'Firma_Arturo_Caceres_MACAO.html');
  await fs.writeFile(htmlPath, html);
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 360 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => Promise.all(Array.from(document.images, img => img.decode())));
    const signature = page.locator('#firma');
    await signature.screenshot({ path: path.join(__dirname, 'Firma_Arturo_Caceres_MACAO.png'), scale: 'css' });
    await signature.screenshot({ path: path.join(__dirname, 'Firma_Arturo_Caceres_MACAO@2x.png') });
    const result = await page.evaluate(() => ({
      imagesLoaded: Array.from(document.images).every(img => img.complete && img.naturalWidth > 0),
      links: Array.from(document.querySelectorAll('a'), a => a.href),
      width: document.querySelector('#firma').getBoundingClientRect().width,
      height: document.querySelector('#firma').getBoundingClientRect().height,
      text: document.querySelector('#firma').innerText,
    }));
    if (!result.imagesLoaded || result.width !== 650 || !result.text.includes('Gerente General')) {
      throw new Error(`Signature validation failed: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
