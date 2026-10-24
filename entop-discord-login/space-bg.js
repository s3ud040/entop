/* ============================================================
   ENTOP — خلفية فضائية متحركة (نجوم + سديم بنفسجي/أزرق)
   خفيفة جداً وسلسة على الكمبيوتر والجوال والآيباد (Canvas 2D).
   ثابتة خلف المحتوى، لا تعطّل أي زر، وتحترم إعدادات تقليل الحركة.
   ============================================================ */
(function () {
  "use strict";
  var canvas = document.getElementById("space");
  if (!canvas) return;

  var ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) { canvas.style.display = "none"; return; } // يبقى تدرّج CSS الاحتياطي

  var reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion:reduce)").matches; } catch (e) {}

  var isMobile = (function () {
    try { return matchMedia("(pointer:coarse)").matches || innerWidth < 760; }
    catch (e) { return innerWidth < 760; }
  })();

  var W = 0, H = 0, DPR = 1;
  var maxDPR = isMobile ? 1.5 : 2;

  /* ---------- النجوم ---------- */
  var stars = [];
  function buildStars() {
    stars.length = 0;
    var area = (W * H) / (DPR * DPR);
    var base = isMobile ? 9000 : 6500;
    var count = Math.min(Math.round(area / base), isMobile ? 180 : 420);
    for (var i = 0; i < count; i++) {
      var layer = Math.random();                 // 0..1 عمق
      var z = 0.35 + layer * layer * 1.65;        // أقرب = أكبر وأسرع
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: z,
        r: (0.5 + z * 0.9) * DPR,
        a: 0.35 + Math.random() * 0.6,
        tw: Math.random() * Math.PI * 2,
        tws: 0.6 + Math.random() * 1.6,
        c: Math.random() < 0.78 ? "255,255,255"
          : (Math.random() < 0.5 ? "170,150,255" : "150,200,255")
      });
    }
  }

  /* ---------- السديم (يُرسم مرة واحدة ثم يُحرّك) ---------- */
  var neb = document.createElement("canvas");
  var nctx = neb.getContext("2d");
  function buildNebula() {
    var S = 700;
    neb.width = S; neb.height = S;
    nctx.clearRect(0, 0, S, S);
    var blobs = [
      { x: 0.28, y: 0.22, r: 0.42, col: [122, 91, 240], a: 0.55 },
      { x: 0.74, y: 0.30, r: 0.46, col: [47, 120, 242], a: 0.50 },
      { x: 0.55, y: 0.72, r: 0.50, col: [86, 60, 220], a: 0.45 },
      { x: 0.16, y: 0.78, r: 0.34, col: [229, 31, 196], a: 0.26 },
      { x: 0.88, y: 0.82, r: 0.34, col: [40, 90, 230], a: 0.30 }
    ];
    nctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var cx = b.x * S, cy = b.y * S, rr = b.r * S;
      var g = nctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      var c = b.col;
      g.addColorStop(0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + b.a + ")");
      g.addColorStop(0.45, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (b.a * 0.35) + ")");
      g.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
      nctx.fillStyle = g;
      nctx.fillRect(0, 0, S, S);
    }
    nctx.globalCompositeOperation = "source-over";
  }

  /* ---------- الشهب ---------- */
  var shoot = null, nextShoot = 2.5 + Math.random() * 4;
  function spawnShoot() {
    var fromLeft = Math.random() < 0.5;
    shoot = {
      x: fromLeft ? -0.1 * W : W * (0.5 + Math.random() * 0.5),
      y: Math.random() * H * 0.5,
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 4) * DPR,
      vy: (2.2 + Math.random() * 1.6) * DPR,
      life: 0, max: 0.7 + Math.random() * 0.5
    };
  }

  /* ---------- القياس ---------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, maxDPR);
    var w = innerWidth, h = innerHeight;
    W = Math.round(w * DPR); H = Math.round(h * DPR);
    canvas.width = W; canvas.height = H;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    buildStars();
  }

  function paintBase() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#07061a");
    g.addColorStop(0.5, "#060a1e");
    g.addColorStop(1, "#04040c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  buildNebula();
  resize();
  addEventListener("resize", function () { resize(); if (reduce) renderStatic(); }, { passive: true });

  function drawNebula(t) {
    ctx.globalCompositeOperation = "lighter";
    var scale = Math.max(W, H) / neb.width * 1.6;
    var dw = neb.width * scale, dh = neb.height * scale;

    var ox1 = (Math.sin(t * 0.03) * 0.06 + 0.5) * (W - dw);
    var oy1 = (Math.cos(t * 0.025) * 0.06 + 0.5) * (H - dh);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(neb, ox1, oy1, dw, dh);

    var scale2 = scale * 1.25;
    var dw2 = neb.width * scale2, dh2 = neb.height * scale2;
    var ox2 = (Math.cos(t * 0.022 + 2) * 0.07 + 0.5) * (W - dw2);
    var oy2 = (Math.sin(t * 0.018 + 1) * 0.07 + 0.5) * (H - dh2);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(neb, ox2, oy2, dw2, dh2);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawStars(t, dt) {
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += s.z * 7 * dt;
      s.x += s.z * 2.2 * dt;
      if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
      if (s.x > W + 2) { s.x = -2; }

      var tw = 0.55 + 0.45 * Math.sin(t * s.tws + s.tw);
      var a = s.a * tw;
      ctx.fillStyle = "rgba(" + s.c + "," + a.toFixed(3) + ")";
      if (s.r > 1.6 * DPR) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      } else {
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawShoot(dt) {
    if (!shoot) return;
    shoot.life += dt / 60;
    shoot.x += shoot.vx; shoot.y += shoot.vy;
    var k = 1 - (shoot.life / shoot.max);
    if (k <= 0 || shoot.x < -0.2 * W || shoot.x > 1.2 * W || shoot.y > H) { shoot = null; return; }
    var tx = shoot.x - shoot.vx * 6, ty = shoot.y - shoot.vy * 6;
    var g = ctx.createLinearGradient(shoot.x, shoot.y, tx, ty);
    g.addColorStop(0, "rgba(200,220,255," + (0.9 * k).toFixed(3) + ")");
    g.addColorStop(1, "rgba(150,120,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 2 * DPR;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  function frame(t, dt) {
    paintBase();
    drawNebula(t);
    drawStars(t, dt);
    if (!isMobile) {
      nextShoot -= dt / 60;
      if (!shoot && nextShoot <= 0) { spawnShoot(); nextShoot = 4 + Math.random() * 6; }
      drawShoot(dt);
    }
  }

  function renderStatic() {
    paintBase();
    drawNebula(0);
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.fillStyle = "rgba(" + s.c + "," + s.a.toFixed(3) + ")";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /* ---------- الحلقة ---------- */
  var raf = 0, last = 0, running = true;
  function loop(now) {
    if (!running) return;
    if (!last) last = now;
    var dt = (now - last) / 1000;
    if (dt > 0.05) dt = 0.05;
    last = now;
    frame(now / 1000, dt * 60);
    raf = requestAnimationFrame(loop);
  }

  if (reduce) {
    renderStatic();
  } else {
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    });
  }
})();
