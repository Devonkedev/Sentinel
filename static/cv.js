// Asset integrity computer vision - runs fully in the browser on a <canvas>.
// Detects: abrasions/scratches (edge density), discolouration (dark, warm-shifted
// tiles), and change vs. an optional reference photo of the same panel.
const CV = (() => {
  const MAX_W = 640;
  const TILE = 16;

  function toCanvas(src, w, h) {
    const c = document.createElement("canvas");
    const scale = w ? 1 : Math.min(1, MAX_W / src.width);
    c.width = w || Math.round(src.width * scale);
    c.height = h || Math.round(src.height * scale);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function median(arr) {
    const s = Float64Array.from(arr).sort();
    return s.length ? s[s.length >> 1] : 0;
  }

  function sobel(gray, w, h) {
    const mag = new Float32Array(w * h), axis = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        mag[i] = Math.hypot(gx, gy);
        // axis-aligned gradients belong to man-made structure (grilles, panel seams)
        axis[i] = mag[i] > 0 && (Math.abs(gx) / mag[i] > 0.97 || Math.abs(gy) / mag[i] > 0.97) ? 1 : 0;
      }
    }
    return { mag, axis };
  }

  // Group flagged tiles into connected regions -> bounding boxes
  function regions(flags, tw, th) {
    const seen = new Uint8Array(flags.length);
    const out = [];
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i] || seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      while (stack.length) {
        const j = stack.pop();
        const x = j % tw, y = (j / tw) | 0;
        n++;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
          const k = ny * tw + nx;
          if (flags[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      out.push({ x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE, tiles: n });
    }
    return out.sort((a, b) => b.tiles - a.tiles);
  }

  function where(r, w, h) {
    const cx = (r.x + r.w / 2) / w, cy = (r.y + r.h / 2) / h;
    const v = cy < 0.33 ? "upper" : cy > 0.66 ? "lower" : "middle";
    const hz = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "centre";
    return `${v} ${hz}`;
  }

  function analyze(image, reference) {
    const base = toCanvas(image);
    const w = base.width, h = base.height;
    const px = base.getContext("2d").getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const { mag, axis } = sobel(gray, w, h);

    let ref = null;
    if (reference) ref = toCanvas(reference, w, h).getContext("2d").getImageData(0, 0, w, h).data;

    const tw = Math.floor(w / TILE), th = Math.floor(h / TILE);
    const tiles = [];
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        let L = 0, warm = 0, edges = 0, axial = 0, diff = 0;
        for (let y = ty * TILE; y < (ty + 1) * TILE; y++) {
          for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
            const i = y * w + x, p = i * 4;
            L += gray[i];
            warm += px[p] - px[p + 2];
            if (mag[i] > 60) { edges++; axial += axis[i]; }
            if (ref && (Math.abs(px[p] - ref[p]) + Math.abs(px[p + 1] - ref[p + 1]) + Math.abs(px[p + 2] - ref[p + 2])) / 3 > 30) diff++;
          }
        }
        const n = TILE * TILE;
        tiles.push({ L: L / n, warm: warm / n, ed: edges / n, axial: edges ? axial / edges : 0, diff: diff / n });
      }
    }

    const mL = median(tiles.map(t => t.L));
    const madL = median(tiles.map(t => Math.abs(t.L - mL))) || 1;
    const mW = median(tiles.map(t => t.warm));
    const mE = median(tiles.map(t => t.ed));
    const madE = median(tiles.map(t => Math.abs(t.ed - mE))) || 0.01;

    // discolouration: darker and warm-shifted, or a strong warm (brown/scorch) cast that isn't brighter
    const disc = tiles.map(t => ((mL - t.L > Math.max(12, 2.5 * madL) && t.warm - mW > 3) ||
      (t.warm - mW > 25 && t.L < mL + 5)) ? 1 : 0);
    // scratches: dense, randomly oriented edges; with a reference, only edges that are new
    const abr = tiles.map((t, i) => (!disc[i] && t.ed > Math.max(0.05, mE + 4 * madE) && t.axial < 0.55 &&
      (!ref || t.diff > 0.02)) ? 1 : 0);
    const chg = tiles.map((t, i) => (ref && !disc[i] && !abr[i] && t.diff > 0.06) ? 1 : 0);

    const pct = f => (100 * f.reduce((a, b) => a + b, 0)) / f.length;
    const discR = regions(disc, tw, th).filter(r => r.tiles >= 2);
    const abrR = regions(abr, tw, th).filter(r => r.tiles >= 2);
    const chgR = regions(chg, tw, th).filter(r => r.tiles >= 2);
    const metrics = {
      discolouration_pct: +pct(disc).toFixed(1),
      abrasion_pct: +pct(abr).toFixed(1),
      change_vs_reference_pct: ref ? +pct(chg).toFixed(1) : null,
      regions: discR.length + abrR.length + chgR.length,
      resolution: `${w}x${h}`,
    };
    const score = Math.min(100, Math.round(metrics.discolouration_pct * 6 + metrics.abrasion_pct * 3 +
      (metrics.change_vs_reference_pct || 0) * 1.5 + metrics.regions * 2));

    const findings = [];
    discR.slice(0, 3).forEach(r => findings.push({
      kind: "discolouration", box: r,
      text: `Localised darkening, warm-shifted, ${where(r, w, h)} (${r.tiles} tiles). Consistent with heat exposure - not by itself proof of arcing.`,
    }));
    abrR.slice(0, 3).forEach(r => findings.push({
      kind: "abrasion", box: r,
      text: `Dense fine edges (scratches/abrasions), ${where(r, w, h)} (${r.tiles} tiles).`,
    }));
    chgR.slice(0, 3).forEach(r => findings.push({
      kind: "change", box: r,
      text: `Differs from reference photo, ${where(r, w, h)} (${r.tiles} tiles) - new damage or displacement.`,
    }));
    if (!findings.length) findings.push({ kind: "clear", text: "No significant surface anomalies detected." });

    // Overlay
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    ctx.drawImage(base, 0, 0);
    const colors = { discolouration: "#ee7a2f", abrasion: "#e0a526", change: "#b38cff" };
    ctx.lineWidth = 2;
    ctx.font = "600 11px -apple-system, sans-serif";
    for (const f of findings) {
      if (!f.box) continue;
      const c = colors[f.kind];
      ctx.strokeStyle = c;
      ctx.fillStyle = c + "22";
      ctx.fillRect(f.box.x, f.box.y, f.box.w, f.box.h);
      ctx.strokeRect(f.box.x + 1, f.box.y + 1, f.box.w - 2, f.box.h - 2);
      const label = f.kind.toUpperCase();
      const tw2 = ctx.measureText(label).width + 8;
      ctx.fillStyle = c;
      ctx.fillRect(f.box.x, Math.max(0, f.box.y - 16), tw2, 16);
      ctx.fillStyle = "#0b0f17";
      ctx.fillText(label, f.box.x + 4, Math.max(12, f.box.y - 4));
    }

    const thumb = toCanvas(out, 240, Math.round(240 * h / w)).toDataURL("image/jpeg", 0.7);
    return { overlay: out, metrics, findings: findings.map(({ kind, text }) => ({ kind, text })), score, thumbnail: thumb };
  }

  // Synthetic cabinet side-panel for demos (the report photos are redacted)
  function sample(damaged) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const c = document.createElement("canvas");
    c.width = 640; c.height = 480;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 640, 480);
    g.addColorStop(0, "#3a4660"); g.addColorStop(1, "#2c364c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 480);
    const img = ctx.getImageData(0, 0, 640, 480);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 10;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    // ventilation grille
    ctx.fillStyle = "#232b3c";
    for (let i = 0; i < 9; i++) ctx.fillRect(70, 70 + i * 16, 150, 7);
    // access panel + fasteners
    const off = damaged ? 6 : 0;
    ctx.strokeStyle = "#1e2533"; ctx.lineWidth = 3;
    ctx.strokeRect(160 + off, 300, 320, 140);
    ctx.fillStyle = "#8a93a6";
    for (const [x, y] of [[175 + off, 315], [465 + off, 315], [175 + off, 425], [465 + off, 425]]) {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }
    // logo strip
    ctx.fillStyle = "#c33b5c"; ctx.fillRect(380, 70, 190, 34);
    ctx.fillStyle = "#f3d3dc"; ctx.font = "bold 18px sans-serif"; ctx.fillText("RECKONING V", 400, 94);
    if (damaged) {
      // scorch near the vent
      const s = ctx.createRadialGradient(240, 150, 4, 240, 150, 62);
      s.addColorStop(0, "rgba(40,18,6,0.95)"); s.addColorStop(0.5, "rgba(92,48,18,0.7)"); s.addColorStop(1, "rgba(92,48,18,0)");
      ctx.fillStyle = s; ctx.beginPath(); ctx.arc(240, 150, 62, 0, Math.PI * 2); ctx.fill();
      // abrasions on the right side
      ctx.lineCap = "round";
      for (let i = 0; i < 70; i++) {
        const x = 500 + rnd() * 110, y = 170 + rnd() * 200, len = 12 + rnd() * 40, a = -0.5 + rnd() * 0.4;
        ctx.strokeStyle = `rgba(210,218,232,${0.35 + rnd() * 0.5})`; ctx.lineWidth = 0.6 + rnd();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
      }
      // scuffing near lower access panel
      for (let i = 0; i < 30; i++) {
        const x = 200 + rnd() * 120, y = 445 + rnd() * 25;
        ctx.strokeStyle = `rgba(200,205,215,${0.3 + rnd() * 0.4})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8 + rnd() * 18, y + (rnd() - 0.5) * 4); ctx.stroke();
      }
    }
    return c;
  }

  return { analyze, sample };
})();
