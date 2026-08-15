import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEMO_ITEMS } from "../base44/shared/demo-fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "public", "demo", "wardrobe");

function channels(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function shade(hex, amount) {
  const adjusted = channels(hex).map((value) => Math.max(0, Math.min(255, Math.round(value + ((amount > 0 ? 255 - value : value) * amount)))));
  return `#${adjusted.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hash(value) {
  return [...value].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 17);
}

function detailColor(item) {
  return item.secondaryColor || shade(item.color, -0.24);
}

function buttons(x, from, to, count, color) {
  return Array.from({ length: count }, (_, index) => {
    const y = from + ((to - from) * (index / Math.max(1, count - 1)));
    return `<circle cx="${x}" cy="${y.toFixed(1)}" r="3.1" fill="${color}" opacity=".7"/>`;
  }).join("");
}

function torsoPattern(item, x = 177, y = 126, width = 158, height = 294) {
  const accent = detailColor(item);
  if (item.pattern === "stripe") {
    const vertical = item.template === "shirt";
    return vertical
      ? Array.from({ length: 8 }, (_, index) => `<rect x="${x + 9 + (index * 20)}" y="${y}" width="5" height="${height}" fill="${accent}" opacity=".65"/>`).join("")
      : Array.from({ length: 9 }, (_, index) => `<rect x="${x}" y="${y + 16 + (index * 28)}" width="${width}" height="6" fill="${accent}" opacity=".68"/>`).join("");
  }
  if (item.pattern === "plaid" || item.pattern === "check") {
    const spacing = item.pattern === "plaid" ? 40 : 30;
    const lines = [];
    for (let offset = spacing / 2; offset < width; offset += spacing) lines.push(`<rect x="${x + offset}" y="${y}" width="5" height="${height}" fill="${accent}" opacity=".48"/>`);
    for (let offset = spacing / 2; offset < height; offset += spacing) lines.push(`<rect x="${x}" y="${y + offset}" width="${width}" height="5" fill="${accent}" opacity=".48"/>`);
    return lines.join("");
  }
  if (item.pattern === "graphic") {
    return `<g fill="${accent}" opacity=".78"><path d="M222 226l34-27 36 27-13 39-47 0z"/><circle cx="256" cy="234" r="11" fill="${shade(accent, .28)}"/><path d="M222 283h68l-10 9h-48z" opacity=".6"/></g>`;
  }
  return "";
}

function crew(item, oversized = false) {
  const left = oversized ? 153 : 174;
  const right = oversized ? 359 : 338;
  const sleeveOuter = oversized ? 66 : 86;
  const longSleeve = item.longSleeve;
  const silhouette = longSleeve
    ? `M${left} 122L216 92Q256 116 296 92L${right} 122L400 165L427 380L371 394L326 196L330 438Q256 460 182 438L186 196L141 394L85 380L112 165Z M225 102Q256 128 287 102Q279 158 256 158Q233 158 225 102Z`
    : `M${left} 122L216 92Q256 116 296 92L${right} 122L426 198L374 248L329 199L334 438Q256 463 178 438L183 199L138 248L86 198Z M225 102Q256 128 287 102Q279 158 256 158Q233 158 225 102Z`;
  return `<g class="garment"><path d="${silhouette}" fill="url(#cloth)" fill-rule="evenodd"/><path d="M181 416Q256 438 332 416" fill="none" stroke="var(--detail)" opacity=".28"/>${torsoPattern(item, oversized ? 160 : 181, 145, oversized ? 192 : 150, 267)}${item.pocket ? `<path d="M278 191h39v48q-19 11-39 0z" fill="none" stroke="var(--detail)" opacity=".55"/>` : ""}</g>`;
}

function polo(item) {
  return `<g class="garment"><path d="M176 126L216 94Q256 119 296 94L336 126L421 197L370 246L329 202L333 438Q256 461 179 438L183 202L142 246L91 197Z M226 102Q256 126 286 102L277 158H235Z" fill="url(#cloth)" fill-rule="evenodd"/><path d="M226 102l30 49-21 20-21-56zM286 102l-30 49 21 20 21-56z" fill="var(--detail)" opacity=".84"/><path d="M256 151v91" stroke="var(--detail)" opacity=".5"/>${buttons(256, 169, 219, 3, shade(item.color, -0.34))}<path d="M180 418q76 21 153 0" fill="none" stroke="var(--detail)" opacity=".3"/></g>`;
}

function henley(item) {
  return `<g class="garment"><path d="M174 123L216 92Q256 117 296 92L338 123L420 198L369 246L329 200L333 438Q256 460 179 438L183 200L143 246L92 198Z M226 101Q256 128 286 101Q278 155 256 155Q234 155 226 101Z" fill="url(#cloth)" fill-rule="evenodd"/><path d="M256 149v91" stroke="var(--detail)" stroke-width="5" opacity=".5"/>${buttons(256, 168, 218, 4, detailColor(item))}<path d="M182 418q74 21 150 0" fill="none" stroke="var(--detail)" opacity=".28"/></g>`;
}

function shirt(item, outer = false) {
  const pocketOpacity = outer ? .72 : .44;
  return `<g class="garment"><path d="M171 121L215 88Q256 111 297 88L341 121L390 157L428 382L372 397L327 202L337 445Q256 466 175 445L185 202L140 397L84 382L122 157Z" fill="url(#cloth)"/><path d="M215 88l41 42-30 37-28-55zM297 88l-41 42 30 37 28-55z" fill="var(--detail)" opacity=".75"/><path d="M256 130v315" stroke="var(--detail)" opacity=".45"/>${buttons(256, 174, 414, outer ? 6 : 7, shade(item.color, -0.3))}<path d="M190 190h43v62q-21 12-43 0zM279 190h43v62q-21 12-43 0z" fill="none" stroke="var(--detail)" opacity="${pocketOpacity}"/>${torsoPattern(item, 176, 165, 160, 252)}<path d="M105 350l57-11M350 339l57 11" stroke="var(--detail)" opacity=".34"/></g>`;
}

function sweater(item) {
  const neck = item.mockNeck
    ? `<path d="M226 96h60v62q-30 17-60 0z" fill="var(--detail)" opacity=".72"/>`
    : `<path d="M225 101Q256 128 287 101Q279 155 256 155Q233 155 225 101Z" fill="var(--detail)" opacity=".6"/>`;
  return `<g class="garment"><path d="M169 124L216 91Q256 116 296 91L343 124L393 162L429 386L374 399L328 202L334 434Q256 459 178 434L184 202L138 399L83 386L119 162Z" fill="url(#cloth)"/>${neck}<g stroke="var(--detail)" opacity=".3"><path d="M178 410q78 23 156 0" stroke-width="12"/><path d="M92 374l50-12M370 362l50 12" stroke-width="10"/></g></g>`;
}

function jacket(item, kind) {
  const isBomber = kind === "bomber" || kind === "harrington";
  const isCardigan = kind === "cardigan";
  const hood = kind === "hoodie" ? `<path d="M196 126Q198 58 256 48Q314 58 316 126L288 157H224Z" fill="url(#cloth)" opacity=".96"/><path d="M221 123Q219 80 256 70Q293 80 291 123" fill="none" stroke="var(--detail)" opacity=".42"/>` : "";
  const collar = kind === "hoodie" ? "" : isBomber
    ? `<path d="M211 99q45 27 90 0l-11 47q-34 18-68 0z" fill="var(--detail)" opacity=".72"/>`
    : `<path d="M212 91l44 43-31 39-30-66zM300 91l-44 43 31 39 30-66z" fill="var(--detail)" opacity=".75"/>`;
  const pockets = kind === "field" || kind === "chore"
    ? `<path d="M188 183h48v66q-24 14-48 0zM276 183h48v66q-24 14-48 0zM184 299h54v78q-27 15-54 0zM274 299h54v78q-27 15-54 0z" fill="none" stroke="var(--detail)" opacity=".66"/>`
    : kind === "overshirt"
      ? `<path d="M188 186h48v65q-24 13-48 0zM276 186h48v65q-24 13-48 0z" fill="none" stroke="var(--detail)" opacity=".62"/>`
      : `<path d="M183 311l52-30M329 311l-52-30" stroke="var(--detail)" stroke-width="4" opacity=".52"/>`;
  const closure = isCardigan ? buttons(256, 164, 405, 7, detailColor(item)) : `<path d="M256 134v306" stroke="var(--detail)" stroke-width="${kind === "hoodie" || isBomber ? 5 : 2}" opacity=".62"/>`;
  return `<g class="garment">${hood}<path d="M168 122L213 91Q256 117 299 91L344 122L396 160L431 389L376 403L328 202L337 439Q256 465 175 439L184 202L136 403L81 389L116 160Z" fill="url(#cloth)"/>${collar}${closure}${pockets}${isBomber ? `<path d="M174 416q82 25 164 0" fill="none" stroke="var(--detail)" stroke-width="16" opacity=".58"/>` : ""}</g>`;
}

function bottoms(item, kind) {
  const relaxed = item.relaxed || kind === "cargo";
  const waistLeft = relaxed ? 146 : 165;
  const waistRight = relaxed ? 366 : 347;
  const legLeft = relaxed ? 120 : 150;
  const legRight = relaxed ? 392 : 362;
  const pockets = kind === "cargo"
    ? `<path d="M132 231h63v88q-31 15-63 0zM317 231h63v88q-31 15-63 0z" fill="none" stroke="var(--detail)" opacity=".7"/>`
    : kind === "jeans"
      ? `<path d="M173 133q29 51 75 46M339 133q-29 51-75 46" fill="none" stroke="var(--detail)" opacity=".65"/>`
      : `<path d="M182 140l-21 72M330 140l21 72" stroke="var(--detail)" opacity=".35"/>`;
  return `<g class="garment"><path d="M${waistLeft} 92Q256 72 ${waistRight} 92L${legRight} 446L287 446L256 235L225 446L${legLeft} 446Z" fill="url(#cloth)"/><path d="M${waistLeft + 2} 110q89 25 ${waistRight - waistLeft - 4} 0" fill="none" stroke="var(--detail)" stroke-width="8" opacity=".42"/><path d="M256 106v129" stroke="var(--detail)" opacity=".4"/>${item.pleated ? `<path d="M219 121l18 286M293 121l-18 286" stroke="var(--detail)" opacity=".34"/>` : ""}${pockets}<path d="M${legLeft} 430l74 1M${legRight} 430l-74 1" stroke="var(--detail)" opacity=".33"/></g>`;
}

function shoes(item, kind) {
  const upper = detailColor(item);
  const sole = item.secondaryColor || shade(item.color, .32);
  if (kind === "boots") {
    const boot = `<path d="M116 92h151l-2 184q53 37 142 48 42 6 39 47-139 34-329 1z" fill="url(#cloth)"/><path d="M117 349q196 31 329 0v34q-158 31-329 3z" fill="${sole}"/><path d="M139 119h103M239 109v174" fill="none" stroke="${upper}" stroke-width="11" opacity=".46"/>`;
    return `<g class="garment"><g transform="translate(73 -35) scale(.78)" opacity=".72">${boot}</g><g>${boot}</g></g>`;
  }
  if (kind === "loafers" || kind === "derby") {
    const lace = kind === "derby" ? `<g stroke="${shade(item.color, .35)}" stroke-width="5" opacity=".72"><path d="M182 224l78 23M190 207l82 25M202 192l78 25"/></g>` : `<path d="M168 225q74-24 137 11l-19 47H153z" fill="${upper}" opacity=".58"/><path d="M169 246h113" stroke="${shade(upper, .2)}" stroke-width="7" opacity=".75"/>`;
    const loafer = `<path d="M69 305q44-119 151-122 52 3 98 45 53 45 133 58 35 7 29 51-177 44-414 8z" fill="url(#cloth)"/>${lace}<path d="M68 330q228 36 411-5l-5 33q-204 45-407 12z" fill="${sole}"/>`;
    return `<g class="garment"><g transform="translate(74 -45) scale(.78)" opacity=".7">${loafer}</g><g>${loafer}</g></g>`;
  }
  const technical = kind === "running";
  const panels = technical
    ? `<path d="M106 285l91-91 61 24-71 103zM270 227l77 55-39 44-76-77z" fill="${upper}" opacity=".48"/>`
    : `<path d="M114 282l91-80 58 18-63 99zM272 231l73 50-33 42-75-74z" fill="${upper}" opacity=".42"/>`;
  const laces = `<g fill="none" stroke="${shade(item.color, .38)}" stroke-width="5" opacity=".82"><path d="M190 223l83 28M180 240l83 28M169 257l83 28M158 274l83 28"/></g>`;
  const sneaker = `<path d="M65 306q44-123 154-124 58 2 105 46 51 46 127 57 38 6 33 50-181 46-423 9z" fill="url(#cloth)"/>${panels}${laces}<path d="M62 329q229 40 421-5l-5 40q-214 47-418 12z" fill="${sole}"/><path d="M83 343q215 31 379-4" stroke="${shade(sole, -.24)}" stroke-width="4" opacity=".34"/>`;
  return `<g class="garment"><g transform="translate(74 -44) scale(.78)" opacity=".7">${sneaker}</g><g>${sneaker}</g></g>`;
}

function accessory(item, kind) {
  const accent = detailColor(item);
  if (kind === "cap") return `<g class="garment"><path d="M132 282q13-151 137-158 111 8 122 150-132 49-259 8z" fill="url(#cloth)"/><path d="M253 276q118-32 195 15-99 74-215 20z" fill="var(--detail)"/><path d="M270 124v150M164 183q105 24 204-2" fill="none" stroke="var(--detail)" opacity=".4"/></g>`;
  if (kind === "watch") return `<g class="garment"><path d="M224 43h64l19 150-20 32 20 94-19 150h-64l-19-150 20-94-20-32z" fill="url(#cloth)"/><circle cx="256" cy="256" r="91" fill="${accent}"/><circle cx="256" cy="256" r="75" fill="${shade(item.color, .16)}" stroke="${shade(accent, .26)}" stroke-width="7"/><path d="M256 256l4-49M256 256l38 22" stroke="${shade(accent, -.45)}" stroke-width="7" stroke-linecap="round"/></g>`;
  if (kind === "belt") return `<g class="garment"><path d="M58 229h355v55H58q-24-27 0-55z" fill="url(#cloth)"/><rect x="395" y="210" width="73" height="93" rx="9" fill="none" stroke="${accent}" stroke-width="18"/><path d="M412 256h51" stroke="${accent}" stroke-width="9"/><circle cx="91" cy="256" r="5" fill="${shade(item.color, .38)}"/></g>`;
  if (kind === "sunglasses") return `<g class="garment"><path d="M72 210q83-27 173 8l-14 104q-129 54-159-44zM440 210q-83-27-173 8l14 104q129 54 159-44z" fill="url(#cloth)"/><path d="M235 229q21-19 42 0M72 220L25 187M440 220l47-33" fill="none" stroke="${item.color}" stroke-width="18" stroke-linecap="round"/><path d="M91 230q65-20 132 1l-9 71q-94 38-123-33zM421 230q-65-20-132 1l9 71q94 38 123-33z" fill="${shade(accent, -.35)}" opacity=".82"/>${item.pattern === "tortoise" ? `<g fill="${accent}" opacity=".65"><circle cx="85" cy="220" r="8"/><circle cx="218" cy="230" r="7"/><circle cx="427" cy="222" r="8"/><circle cx="294" cy="230" r="7"/></g>` : ""}</g>`;
  if (kind === "beanie") return `<g class="garment"><path d="M135 304q3-198 121-211 118 13 121 211z" fill="url(#cloth)"/><path d="M124 290h264v94q-132 38-264 0z" fill="var(--detail)" opacity=".72"/><g stroke="${shade(accent, .22)}" opacity=".38">${Array.from({ length: 9 }, (_, index) => `<path d="M${153 + (index * 26)} 132v236"/>`).join("")}</g></g>`;
  if (kind === "scarf") return `<g class="garment"><path d="M158 57h174l-20 380-56 25-56-25z" fill="url(#cloth)"/><path d="M171 205q85 30 170 0M165 301q91 30 182 0" stroke="var(--detail)" stroke-width="8" opacity=".42"/>${Array.from({ length: 10 }, (_, index) => `<path d="M${201 + (index * 12)} 426l${index % 2 ? 4 : -4} 52" stroke="${item.color}" stroke-width="5"/>`).join("")}</g>`;
  if (kind === "tote") return `<g class="garment"><path d="M112 170h288l-28 284H140z" fill="url(#cloth)"/><path d="M176 185q0-114 80-114t80 114" fill="none" stroke="${item.color}" stroke-width="20"/><path d="M144 205h224" stroke="var(--detail)" opacity=".4"/><path d="M214 278h84v70h-84z" fill="none" stroke="var(--detail)" opacity=".34"/></g>`;
  return `<g class="garment"><path d="M96 214h320l-24 218H120z" fill="url(#cloth)"/><path d="M175 218q0-119 81-119t81 119" fill="none" stroke="${item.color}" stroke-width="22"/><path d="M96 240h320" stroke="${accent}" stroke-width="18" opacity=".7"/><path d="M207 240v192M305 240v192" stroke="var(--detail)" opacity=".35"/><circle cx="256" cy="250" r="8" fill="${accent}"/></g>`;
}

function artwork(item) {
  switch (item.template) {
    case "crew": return crew(item);
    case "oversized": return crew(item, true);
    case "polo": return polo(item);
    case "shirt": return shirt(item);
    case "sweater": return sweater(item);
    case "henley": return henley(item);
    case "overshirt": return shirt(item, true);
    case "bomber": return jacket(item, "bomber");
    case "field": return jacket(item, "field");
    case "chore": return jacket(item, "chore");
    case "hoodie": return jacket(item, "hoodie");
    case "harrington": return jacket(item, "harrington");
    case "cardigan": return jacket(item, "cardigan");
    case "trousers": return bottoms(item, "trousers");
    case "jeans": return bottoms(item, "jeans");
    case "chinos": return bottoms(item, "chinos");
    case "cargo": return bottoms(item, "cargo");
    case "sneakers": return shoes(item, "sneakers");
    case "loafers": return shoes(item, "loafers");
    case "boots": return shoes(item, "boots");
    case "running": return shoes(item, "running");
    case "derby": return shoes(item, "derby");
    default: return accessory(item, item.template);
  }
}

function svg(item) {
  const seed = hash(item.key) % 997;
  const accent = detailColor(item);
  const light = shade(item.color, .18);
  const dark = shade(item.color, -.22);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title">
  <title id="title">${item.name}</title>
  <defs>
    <linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset=".42" stop-color="${item.color}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="9" stdDeviation="8" flood-color="#171714" flood-opacity=".16"/>
    </filter>
    <filter id="fabric" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="${seed}" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values=".08 0 0 0 .45  0 .08 0 0 .45  0 0 .08 0 .45  0 0 0 .13 0" result="softNoise"/>
      <feBlend in="SourceGraphic" in2="softNoise" mode="soft-light"/>
    </filter>
  </defs>
  <style>.garment{--detail:${accent};filter:url(#soft-shadow)}.garment&gt;*{vector-effect:non-scaling-stroke}.garment{stroke:${dark};stroke-width:1.15;stroke-linejoin:round;stroke-linecap:round}.garment{filter:url(#soft-shadow)}</style>
  <g filter="url(#fabric)">${artwork(item)}</g>
</svg>`;
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all(DEMO_ITEMS.map((fixture) => writeFile(path.join(outputDirectory, `${fixture.key}.svg`), svg(fixture), "utf8")));
console.log(`Generated ${DEMO_ITEMS.length} deterministic SVG garment assets in ${path.relative(root, outputDirectory)}.`);
