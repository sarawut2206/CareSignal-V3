/* ============================================================
   cs-ocr.js — อ่านตัวหนังสือบนแผงยา/ซองยาด้วย PaddleOCR (PP-OCRv4) ในเครื่อง
   ------------------------------------------------------------
   ทำไมไม่ใช้ Tesseract อย่างเดียว: Tesseract ออกแบบมาสำหรับเอกสารสแกน
   ตัวหนังสือบนฟอยล์แผงยา (มันวาว เอียง พิมพ์ซ้ำทุกเม็ด) อ่านแทบไม่ได้ — ทดสอบกับรูปจริงของผู้ใช้
   ได้แค่เศษคำ ส่วน PP-OCR มีตัวหา "กล่องข้อความ" ในภาพถ่าย (DB detector) แล้วค่อยอ่านทีละกล่อง
   จึงทนภาพเอียง แสงสะท้อน และพื้นหลังรก
   ขั้นตอน
     1. ตัวหากล่อง (det) → แผนที่ความน่าจะเป็นว่าเป็นตัวหนังสือ → แยกก้อน → กล่องเอียงตามแนวตัวหนังสือ
     2. ตัดแต่ละกล่องให้ตั้งตรง สูง 48 px → ตัวอ่าน (rec) → ถอดรหัส CTC
     3. ข้อความกลับหัว: อ่านทั้งสองทิศแล้วเลือกทิศที่มั่นใจกว่า
   ภาพไม่ออกจากเครื่อง · โหลดโมเดลครั้งแรกราว 25 MB แล้ว service worker เก็บไว้
   โมเดลอ่านอักษรจีน/อังกฤษ/ตัวเลขได้ดี แต่อ่านภาษาไทยไม่ได้ — ภาษาไทยยังใช้ Tesseract คู่กัน
   ============================================================ */
(function (g) {
  var ORT_VER = "1.20.1", MODELS = "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/";
  var S = { ort: null, det: null, rec: null, keys: null, loading: null };
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("load " + src)); }; document.head.appendChild(s); }); }
  async function load(say) {
    if (S.rec) return S;
    if (S.loading) return S.loading;
    S.loading = (async function () {
      if (!g.ort) { if (say) say("กำลังโหลดตัวอ่านฉลากรุ่นใหม่ (ครั้งแรกราว 25 MB)…"); await loadScript("https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/ort.min.js"); }
      S.ort = g.ort; S.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/";
      S.ort.env.wasm.numThreads = 1;   /* GitHub Pages ไม่มี cross-origin isolation จึงใช้หลายเธรดไม่ได้ */
      var opt = { executionProviders: ["wasm"] };
      if (say) say("กำลังโหลดโมเดลหาตัวหนังสือ…");
      S.det = await S.ort.InferenceSession.create(MODELS + "ch_PP-OCRv4_det_infer.onnx", opt);
      if (say) say("กำลังโหลดโมเดลอ่านตัวหนังสือ…");
      S.rec = await S.ort.InferenceSession.create(MODELS + "ch_PP-OCRv4_rec_infer.onnx", opt);
      var txt = await fetch(MODELS + "ppocr_keys_v1.txt").then(function (r) { return r.text(); });
      S.keys = txt.split(/\r?\n/); if (S.keys[S.keys.length - 1] === "") S.keys.pop(); S.keys.push(" ");
      return S;
    })();
    try { return await S.loading; } catch (e) { S.loading = null; throw e; }
  }

  /* ---------- 1. หากล่องข้อความ ---------- */
  function toCanvas(img, maxSide) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, sc = Math.min(1, maxSide / Math.max(W, H));
    var c = document.createElement("canvas"); c.width = Math.round(W * sc); c.height = Math.round(H * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c;
  }
  async function detect(src) {
    var lim = 960, sc = lim / Math.max(src.width, src.height);   /* ภาพเล็กขยายขึ้นด้วย ตัวหนังสือเล็กจะได้ไม่หลุด */
    var w = Math.max(32, Math.round(src.width * sc / 32) * 32), h = Math.max(32, Math.round(src.height * sc / 32) * 32);
    var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); x.drawImage(src, 0, 0, w, h);
    var px = x.getImageData(0, 0, w, h).data, n = w * h, f = new Float32Array(3 * n);
    var M = [0.485, 0.456, 0.406], SD = [0.229, 0.224, 0.225];
    for (var i = 0; i < n; i++) { var r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      f[i] = (b - M[0]) / SD[0]; f[n + i] = (gg - M[1]) / SD[1]; f[2 * n + i] = (r - M[2]) / SD[2]; }   /* PaddleOCR อ่านภาพแบบ BGR */
    var feeds = {}; feeds[S.det.inputNames[0]] = new S.ort.Tensor("float32", f, [1, 3, h, w]);
    var out = await S.det.run(feeds), prob = out[S.det.outputNames[0]].data;
    return boxesFrom(prob, w, h, src.width / w, src.height / h);
  }
  /* แผนที่ความน่าจะเป็น → ก้อนตัวหนังสือ → กล่องเอียง (PCA) ขยายขอบแบบ unclip */
  function boxesFrom(prob, w, h, sx, sy) {
    var seen = new Uint8Array(w * h), boxes = [], stack = [];
    for (var p = 0; p < w * h; p++) {
      if (seen[p] || prob[p] < 0.3) continue;
      var xs = [], ys = [], sum = 0; stack.push(p); seen[p] = 1;
      while (stack.length) {
        var q = stack.pop(), qx = q % w, qy = (q - qx) / w; xs.push(qx); ys.push(qy); sum += prob[q];
        var nb = [q - 1, q + 1, q - w, q + w];
        for (var k = 0; k < 4; k++) { var t = nb[k]; if (t < 0 || t >= w * h || seen[t] || prob[t] < 0.3) continue; if ((k === 0 && qx === 0) || (k === 1 && qx === w - 1)) continue; seen[t] = 1; stack.push(t); }
      }
      if (xs.length < 12 || sum / xs.length < 0.55) continue;
      var mx = 0, my = 0, N = xs.length, i; for (i = 0; i < N; i++) { mx += xs[i]; my += ys[i]; } mx /= N; my /= N;
      var cxx = 0, cyy = 0, cxy = 0; for (i = 0; i < N; i++) { var dx = xs[i] - mx, dy = ys[i] - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
      var th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(th), uy = Math.sin(th);
      var a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (i = 0; i < N; i++) { var u = (xs[i] - mx) * ux + (ys[i] - my) * uy, v = -(xs[i] - mx) * uy + (ys[i] - my) * ux; if (u < a0) a0 = u; if (u > a1) a1 = u; if (v < b0) b0 = v; if (v > b1) b1 = v; }
      var L = a1 - a0 + 1, Hh = b1 - b0 + 1; if (Math.min(L, Hh) < 3) continue;
      var d = (L * Hh * 1.6) / (2 * (L + Hh));   /* unclip ratio 1.6 เหมือน PaddleOCR */
      var cu = (a0 + a1) / 2, cv = (b0 + b1) / 2, cx = mx + cu * ux - cv * uy, cy = my + cu * uy + cv * ux;
      boxes.push({ cx: cx * sx, cy: cy * sy, len: (L + 2 * d) * Math.hypot(ux * sx, uy * sy), thick: (Hh + 2 * d) * Math.hypot(uy * sx, ux * sy), ang: Math.atan2(uy * sy, ux * sx), score: sum / N });
    }
    return boxes;
  }

  /* ---------- 2. อ่านแต่ละกล่อง ---------- */
  function crop(img, b, flip) {
    var H = 48, W = Math.max(16, Math.min(640, Math.round(H * b.len / Math.max(1, b.thick))));
    var c = document.createElement("canvas"); c.width = W; c.height = H; var x = c.getContext("2d");
    x.translate(W / 2, H / 2); if (flip) x.rotate(Math.PI); x.scale(W / b.len, H / b.thick); x.rotate(-b.ang); x.translate(-b.cx, -b.cy); x.drawImage(img, 0, 0);
    return c;
  }
  async function recog(c) {
    var W = c.width, H = c.height, px = c.getContext("2d").getImageData(0, 0, W, H).data, n = W * H, f = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) { f[i] = (px[i * 4 + 2] / 255 - 0.5) / 0.5; f[n + i] = (px[i * 4 + 1] / 255 - 0.5) / 0.5; f[2 * n + i] = (px[i * 4] / 255 - 0.5) / 0.5; }
    var feeds = {}; feeds[S.rec.inputNames[0]] = new S.ort.Tensor("float32", f, [1, 3, H, W]);
    var o = (await S.rec.run(feeds))[S.rec.outputNames[0]], T = o.dims[1], C = o.dims[2], d = o.data, text = "", conf = 0, cnt = 0, prev = 0;
    for (var t = 0; t < T; t++) {
      var bi = 0, bv = -1; for (var k = 0; k < C; k++) { var v = d[t * C + k]; if (v > bv) { bv = v; bi = k; } }
      if (bi !== 0 && bi !== prev) { text += S.keys[bi - 1] || ""; conf += bv; cnt++; }
      prev = bi;
    }
    return { text: text, conf: cnt ? conf / cnt : 0 };
  }
  /* ข้อความในภาพ → [{text, conf, box}] เรียงบนลงล่าง */
  async function read(src, say) {
    await load(say);
    var img = src instanceof HTMLCanvasElement ? src : toCanvas(src, 1600);
    if (say) say("กำลังหาตัวหนังสือในรูป…");
    var boxes = await detect(img), out = [];
    boxes.sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx; });
    for (var i = 0; i < boxes.length && i < 60; i++) {
      if (say) say("กำลังอ่านตัวหนังสือ " + (i + 1) + "/" + Math.min(60, boxes.length));
      var b = boxes[i]; if (b.thick > b.len * 1.3) { var t = b.len; b.len = b.thick; b.thick = t; b.ang += Math.PI / 2; }   /* ข้อความแนวตั้ง */
      var r1 = await recog(crop(img, b, false)), r2 = await recog(crop(img, b, true)), r = r2.conf > r1.conf + 0.05 ? r2 : r1;
      if (r.text.trim() && r.conf >= 0.5) out.push({ text: r.text.trim(), conf: r.conf, box: b });
    }
    return out;
  }
  g.CSOcr = { load: load, read: read, ready: function () { return !!S.rec; } };
})(typeof window !== "undefined" ? window : this);
