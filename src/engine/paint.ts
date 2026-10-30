import type { CScene, Frame, WordFx } from "./types.js";
import { curveApex, curveControl } from "./layout.js";
import { paintBackdrop } from "./backdrop.js";

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Strip scripts and event handlers from agent-written inline SVG. */
const sanitize = (svg: string) =>
  svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/javascript:/gi, "");

/**
 * Text animated word by word (or line by line). Each word is a nested tspan; its offset is a relative
 * dx/dy, compensated on the next word (and a trailing zero-width tspan) so the line's layout and anchor
 * never change. No text measurement needed.
 */
function wordTspans(lines: string[], w: WordFx, x: number, y0: number, lh: number, fo: number, stroked: boolean): string {
  const op = (v: number) => ` fill-opacity="${n(fo * v)}"${stroked ? ` stroke-opacity="${n(v)}"` : ""}`;
  let k = 0;
  return lines.map((line, li) => {
    const y = y0 + li * lh;
    if (w.lines) {
      const v = w.v[li] ?? 1, o = 1 - v;
      return `<tspan x="${n(x + w.dx * o)}" y="${n(y + w.dy * o)}"${op(v)}>${esc(line)}</tspan>`;
    }
    let px = 0, py = 0;
    const parts = line.split(/(\s+)/).map((part) => {
      if (!part || /^\s+$/.test(part)) return esc(part);
      const v = w.v[k++] ?? 1, o = 1 - v, ox = w.dx * o, oy = w.dy * o;
      const t = `<tspan dx="${n(ox - px)}" dy="${n(oy - py)}"${op(v)}>${esc(part)}</tspan>`;
      px = ox; py = oy;
      return t;
    }).join("");
    const tail = px || py ? `<tspan dx="${n(-px)}" dy="${n(-py)}">\u200b</tspan>` : "";
    return `<tspan x="${n(x)}" y="${n(y)}">${parts}${tail}</tspan>`;
  }).join("");
}

/** Render one frame to an SVG string. `prefix` keeps ids unique when several frames share a page. */
export function paint(c: CScene, f: Frame, prefix = "f"): string {
  const [W, H] = c.size;
  const th = c.theme;
  const out: string[] = [];

  function node(id: string): string {
    const o = c.objects[id], s = f.objects[id];
    if (!o || !s || s.hidden || s.opacity <= 0.001) return "";
    const d = o.def, box = c.layout[id];
    const cx = box.x, cy = box.y;
    const tf: string[] = [];
    if (s.dx || s.dy || s.rotate || s.scale !== 1) {
      tf.push(`translate(${n(cx + s.dx)} ${n(cy + s.dy)})`);
      if (s.rotate) tf.push(`rotate(${n(s.rotate)})`);
      if (s.scale !== 1) tf.push(`scale(${n(Math.max(0, s.scale))})`);
      tf.push(`translate(${n(-cx)} ${n(-cy)})`);
    }
    const drawing = s.draw < 1;
    const stroke = s.stroke !== "none" ? s.stroke : drawing ? s.fill : "none";
    const sw = s.stroke !== "none" ? s.strokeWidth : drawing ? 3 : 0;
    const dash = drawing ? ` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${n(1 - Math.max(0, s.draw))}"` : d.dash ? ` stroke-dasharray="${d.dash}"` : "";
    const paintAttrs = `fill="${s.fill}" fill-opacity="${n(drawing ? s.fillOpacity : s.fillOpacity)}" stroke="${stroke}" stroke-width="${n(sw)}"${dash}`;
    const shadow = d.shadow ? ` filter="url(#${prefix}-sh)"` : "";
    let body = "";

    switch (d.type) {
      case "rect": {
        const frameDash = d.frame && !drawing ? ` stroke-dasharray="14 10"` : "";
        body = `<rect x="${n(cx - s.w / 2)}" y="${n(cy - s.h / 2)}" width="${n(Math.max(0, s.w))}" height="${n(Math.max(0, s.h))}" rx="${n(o.radius ?? 0)}" ${paintAttrs}${frameDash}${shadow}/>`;
        if (d.text && o.font) {
          const f = o.font, lines = d.text.split("\n"), lh = f.size * 1.25;
          const tAttrs = `font-family="${f.family}" font-size="${f.size}" font-weight="${f.weight}" fill="${o.labelFill ?? th.palette.text}"`;
          if (d.frame) {
            body += `<text x="${n(cx - s.w / 2)}" y="${n(cy - s.h / 2 - 12)}" ${tAttrs}>${esc(d.text)}</text>`;
          } else {
            const y0 = cy - ((lines.length - 1) * lh) / 2;
            const show = drawing ? Math.max(0, (s.draw - 0.55) / 0.45) : 1;
            body += `<text text-anchor="middle" dominant-baseline="central" ${tAttrs} opacity="${n(show)}">${lines.map((l, i) => `<tspan x="${n(cx)}" y="${n(y0 + i * lh)}">${esc(l)}</tspan>`).join("")}</text>`;
          }
        }
        break;
      }
      case "circle":
        body = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(0, Math.min(s.w, s.h) / 2))}" ${paintAttrs}${shadow}/>`;
        break;
      case "line":
      case "arrow": {
        const [[x1, y1], [x2, y2]] = o.points!;
        const t = Math.max(0, Math.min(1, s.draw));
        if (t <= 0.001) break;
        const da = d.dash ? ` stroke-dasharray="${d.dash}"` : "";
        let ex: number, ey: number, tx: number, ty: number, mx: number, my: number;
        if (d.bend) {
          // Partial quadratic curve via de Casteljau: the drawn part ends at parameter t.
          const [cx0, cy0] = curveControl([x1, y1], [x2, y2], d.bend);
          const qx = x1 + (cx0 - x1) * t, qy = y1 + (cy0 - y1) * t;
          const rx = cx0 + (x2 - cx0) * t, ry = cy0 + (y2 - cy0) * t;
          ex = qx + (rx - qx) * t; ey = qy + (ry - qy) * t;
          tx = ex - qx; ty = ey - qy;
          [mx, my] = curveApex([x1, y1], [x2, y2], d.bend);
          body = `<path d="M${n(x1)} ${n(y1)} Q${n(qx)} ${n(qy)} ${n(ex)} ${n(ey)}" fill="none" stroke="${s.stroke}" stroke-width="${n(s.strokeWidth)}" stroke-linecap="round"${da}/>`;
        } else {
          ex = x1 + (x2 - x1) * t; ey = y1 + (y2 - y1) * t;
          tx = x2 - x1; ty = y2 - y1;
          mx = (x1 + x2) / 2; my = (y1 + y2) / 2;
          body = `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(ex)}" y2="${n(ey)}" stroke="${s.stroke}" stroke-width="${n(s.strokeWidth)}" stroke-linecap="round"${da}/>`;
        }
        if (d.text && o.font && t > 0.6) {
          const f = o.font;
          // Centred on the midpoint (curve apex), pushed out along the normal (left of travel, or the
          // bulge side of a curve), with a background halo so the line never runs through the text.
          const len = Math.hypot(x2 - x1, y2 - y1) || 1, side = d.bend && d.bend < 0 ? -1 : 1;
          const off = f.size * 0.7 + 6, lx = mx + ((y2 - y1) / len) * off * side, ly = my - ((x2 - x1) / len) * off * side;
          body += `<text x="${n(lx)}" y="${n(ly)}" text-anchor="middle" dominant-baseline="central" font-family="${f.family}" font-size="${f.size}" font-weight="${f.weight}" fill="${o.labelFill ?? th.palette.muted}" stroke="${th.palette.bg}" stroke-width="6" stroke-linejoin="round" paint-order="stroke" opacity="${n(Math.min(1, (t - 0.6) / 0.4))}">${esc(d.text)}</text>`;
        }
        if (d.type === "arrow" && t > 0.02) {
          const ang = Math.atan2(ty, tx), hs = 6 + s.strokeWidth * 3;
          const p = (a: number, r: number) => `${n(ex + Math.cos(a) * r)},${n(ey + Math.sin(a) * r)}`;
          body += `<polygon points="${p(ang, 0)} ${p(ang + Math.PI * 0.82, hs)} ${p(ang - Math.PI * 0.82, hs)}" fill="${s.stroke}" stroke="${s.stroke}" stroke-width="1" stroke-linejoin="round"/>`;
        }
        break;
      }
      case "text": {
        const font = o.font!;
        const raw = (d.text ?? "").replace(/\{value\}/g, s.value.toFixed(d.decimals ?? 0));
        const lines = raw.split("\n");
        let budget = s.reveal >= 1 ? Infinity : Math.floor(raw.replace(/\n/g, "").length * Math.max(0, s.reveal));
        const lh = font.size * 1.25;
        const anchor = d.anchor ?? "middle";
        const x = anchor === "start" ? cx - box.w / 2 : anchor === "end" ? cx + box.w / 2 : cx;
        const y0 = cy - ((lines.length - 1) * lh) / 2;
        const wf = s.words && s.words.v.some((v) => v < 0.999) ? s.words : undefined;
        const tspans = wf ? wordTspans(lines, wf, x, y0, lh, s.fillOpacity, s.stroke !== "none") : lines.map((line, i) => {
          const shown = line.slice(0, Math.max(0, budget));
          budget -= line.length;
          return `<tspan x="${n(x)}" y="${n(y0 + i * lh)}">${esc(shown)}</tspan>`;
        }).join("");
        body = `<text text-anchor="${anchor}" dominant-baseline="central" font-family="${font.family}" font-size="${font.size}" font-weight="${font.weight}" fill="${s.fill}" fill-opacity="${n(s.fillOpacity)}"${s.stroke !== "none" ? ` stroke="${s.stroke}" stroke-width="${n(s.strokeWidth)}" paint-order="stroke"` : ""}>${tspans}</text>`;
        break;
      }
      case "path":
        body = `<svg x="${n(cx - box.w / 2)}" y="${n(cy - box.h / 2)}" width="${n(box.w)}" height="${n(box.h)}" viewBox="${d.viewBox ?? `0 0 ${box.w} ${box.h}`}" overflow="visible"><path d="${esc(d.d ?? "")}" ${paintAttrs} stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        break;
      case "svg":
        body = `<svg x="${n(cx - box.w / 2)}" y="${n(cy - box.h / 2)}" width="${n(box.w)}" height="${n(box.h)}" viewBox="${d.viewBox ?? `0 0 ${box.w} ${box.h}`}" overflow="visible">${sanitize(d.svg ?? "")}</svg>`;
        break;
      case "video": {
        // Pre-extracted JPEG frames (see cli/clips.ts): the playhead `time` picks the frame.
        const clip = d.src ? c.clips?.[d.src] : undefined;
        const x = cx - s.w / 2, y = cy - s.h / 2, rx = n(o.radius ?? 0);
        const geo = `x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, s.w))}" height="${n(Math.max(0, s.h))}"`;
        const cid = `${prefix}-v-${id.replace(/[^\w-]/g, "_")}`;
        out.push(`<clipPath id="${cid}"><rect ${geo} rx="${rx}"/></clipPath>`);
        body = `<rect ${geo} rx="${rx}" fill="${s.fill}"${shadow}/>`;
        if (clip) {
          const i = Math.max(0, Math.min(clip.frames - 1, Math.floor(s.time * clip.fps + 1e-6)));
          body += `<image href="${clip.url}/${String(i + 1).padStart(5, "0")}.jpg" ${geo} preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/>`;
        }
        if (s.stroke !== "none" && s.strokeWidth > 0) body += `<rect ${geo} rx="${rx}" fill="none" stroke="${s.stroke}" stroke-width="${n(s.strokeWidth)}"/>`;
        break;
      }
      case "group":
        body = (d.children ?? []).map(node).join("");
        break;
      case "spotlight": {
        // Everything outside a rounded window, dimmed: a frame-filling path with the window cut out (evenodd).
        // Drawn well past the canvas so camera moves never reveal its edge. Its opacity is the amount.
        const x = cx - s.w / 2, y = cy - s.h / 2, w = Math.max(0, s.w), h = Math.max(0, s.h);
        const r = Math.min(o.radius ?? 18, w / 2, h / 2);
        const hole = `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`;
        body = `<path d="M${-W} ${-H}H${2 * W}V${2 * H}H${-W}Z${hole}" fill-rule="evenodd" fill="${s.fill}" fill-opacity="${n(s.fillOpacity)}"/>`;
        break;
      }
      case "chip": {
        // A pill with its words, and a leader line + anchor dot to what it names (drawn on with `draw`).
        const x = cx - s.w / 2, y = cy - s.h / 2, f = o.font!;
        const ink = s.stroke !== "none" ? s.stroke : s.fill;
        if (o.points) {
          const [[x1, y1], [x2, y2]] = o.points, t = Math.max(0, Math.min(1, s.draw));
          body += `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x1 + (x2 - x1) * t)}" y2="${n(y1 + (y2 - y1) * t)}" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`;
          // The anchor dot: 10 px, with a 3 px ring so it reads on light and dark UI alike.
          if (t > 0.98) body += `<circle cx="${n(x2)}" cy="${n(y2)}" r="5" fill="${ink}" stroke="${th.palette.bg}" stroke-width="3" paint-order="stroke"/>`;
        }
        body += `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, s.w))}" height="${n(Math.max(0, s.h))}" rx="${n(o.radius ?? s.h / 2)}" fill="${s.fill}" fill-opacity="${n(s.fillOpacity)}"${shadow}/>`;
        body += `<text x="${n(cx)}" y="${n(cy)}" text-anchor="middle" dominant-baseline="central" font-family="${f.family}" font-size="${f.size}" font-weight="${f.weight}" fill="${o.labelFill ?? th.palette.bg}">${esc(d.text ?? "")}</text>`;
        break;
      }
    }

    let clip = "";
    if (s.clip < 1) {
      const cid = `${prefix}-clip-${id.replace(/[^\w-]/g, "_")}`;
      const pad = 40, lx = cx - box.w / 2 - pad;
      out.push(`<clipPath id="${cid}"><rect x="${n(lx)}" y="${n(cy - box.h / 2 - pad)}" width="${n(Math.max(0, (box.w + 2 * pad) * s.clip))}" height="${n(box.h + 2 * pad)}"/></clipPath>`);
      clip = ` clip-path="url(#${cid})"`;
    }
    const op = s.opacity < 1 ? ` opacity="${n(s.opacity)}"` : "";
    const tr = tf.length ? ` transform="${tf.join(" ")}"` : "";
    return `<g data-id="${esc(id)}"${tr}${op}${clip}>${body}</g>`;
  }

  const cam = f.camera;
  const camTf = cam.scale !== 1 || cam.dx || cam.dy || cam.rotate
    ? ` transform="translate(${n(W / 2 + cam.dx)} ${n(H / 2 + cam.dy)}) rotate(${n(cam.rotate)}) scale(${n(cam.scale)}) translate(${-W / 2} ${-H / 2})"`
    : "";
  // HUD objects (`hud: true`) sit outside the camera, over the scene: a zoom never moves a caption.
  const scene = c.roots.filter((id) => !c.objects[id].def.hud).map(node).join("");
  const hud = c.roots.filter((id) => c.objects[id].def.hud).map(node).join("");
  const bd = paintBackdrop(th, W, H, f.t, prefix);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
    `<defs>`,
    `<filter id="${prefix}-sh" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#000" flood-opacity="0.4"/></filter>`,
    bd.defs,
    ...out,
    `</defs>`,
    bd.under,
    `<g${camTf}>${scene}</g>`,
    hud,
    bd.over,
    `</svg>`,
  ].join("");
}
