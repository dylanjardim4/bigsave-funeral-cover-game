(() => {
  // =========================================================
  // ASSETS (MATCH YOUR CURRENT FILE NAMES)
  // =========================================================
  const ASSETS = {
    background: "assets/background.jpg",
    trolley: "assets/Trolley.png",
    bomb: "assets/bomb.png",
    products: [
      "assets/Products/Big Save Baked Beans 410g.png",
      "assets/Products/Big Save Brown Sugar 10kg.png",
      "assets/Products/Big Save Cake Flour 12.5kg.png",
      "assets/Products/Big Save Corn Flakes 1kg.png",
      "assets/Products/Big Save Eggs 60's.png",
      "assets/Products/Big Save IQF 2kg.png",
      "assets/Products/Big Save Jungle Dairy 4lt Mango.png",
      "assets/Products/Big Save Mabela 10kg.png",
      "assets/Products/Big Save Maize Meal 12.5kg.png",
      "assets/Products/Big Save Mayonnaise 750ml.png",
      "assets/Products/Big Save Oil 2lt.png",
      "assets/Products/Big Save Oil 5lt.png",
      "assets/Products/Big Save Pilchards in Chilli Sauce.png",
      "assets/Products/Big Save Pilchards in Tomato Sauce.png",
      "assets/Products/Big Save Rice 10kg.png",
      "assets/Products/Big Save Samp 10kg (2).png",
      "assets/Products/Big Save Still Water 5lt.png",
      "assets/Products/Big Save Superteng 10kg.png",
      "assets/Products/Big Save Tomato Sauce 1lt.png",
      "assets/Products/Big Save Washing Powder 2kg.png"
    ]
  };

  const MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  const RULES = {
    bombsAllowed: 3,
    coverPerUniqueProduct: 1000 // in-game only
  };

  // =========================================================
  // VISUAL / SIZE
  // =========================================================
  const SIZE = {
    trolleyScale: 0.80, // trolley slightly smaller than earlier big one
    productScale: 1.10  // products slightly bigger
  };

  // trolley off-screen allowance
  const TROLLEY_OFFSCREEN_MARGIN = 0.70;

  // items can spawn partially off-screen
  const ITEM_OFFSCREEN_FRAC = 0.55;

  // basket tuning for your trolley PNG (relative to trolley draw rect)
  const BASKET = { x: 0.05, y: 0.20, w: 0.72, h: 0.32 };
  const CATCH  = { xPadFrac: 0.10, yPadFrac: 0.10, hFrac: 0.75 };

  // =========================================================
  // DIFFICULTY (Level 1 challenging, ramps)
  // duplicates exist but not too many
  // =========================================================
  function baseDifficulty(levelIdx) {
    const t = Math.min(1, Math.max(0, levelIdx / 11));
    const ramp = t * t;

    return {
      spawnIntervalMs: Math.round(720 - ramp * 220), // 720 -> 500
      bombChance:      0.18 + ramp * 0.18,          // 18% -> 36%
      minFallSpeed:    170 + ramp * 120,            // 170 -> 290
      maxFallSpeed:    340 + ramp * 220,            // 340 -> 560
      unseenBias:      0.76 - ramp * 0.10           // duplicates exist, but not too many
    };
  }

  function runtimeDifficulty(levelIdx, caughtCount, totalProducts) {
    const base = baseDifficulty(levelIdx);
    const p = totalProducts <= 0 ? 0 : Math.min(1, Math.max(0, caughtCount / totalProducts));
    const ease = p * p;

    return {
      spawnIntervalMs: Math.max(430, Math.round(base.spawnIntervalMs - ease * 70)),
      bombChance:      Math.min(0.48, base.bombChance + ease * 0.08),
      minFallSpeed:    base.minFallSpeed + ease * 35,
      maxFallSpeed:    base.maxFallSpeed + ease * 60,
      unseenBias:      base.unseenBias
    };
  }

  // =========================================================
  // DOM
  // =========================================================
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const confettiCanvas = document.getElementById("confettiCanvas");
  const confettiCtx = confettiCanvas.getContext("2d");

  const monthNameEl = document.getElementById("monthName");
  const coverValueEl = document.getElementById("coverValue");
  const productsCountEl = document.getElementById("productsCount");
  const bombsCountEl = document.getElementById("bombsCount");

  const startOverlay = document.getElementById("startOverlay");
  const gameOverOverlay = document.getElementById("gameOverOverlay");
  const levelOverlay = document.getElementById("levelOverlay");
  const howOverlay = document.getElementById("howOverlay");

  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");
  const nextLevelBtn = document.getElementById("nextLevelBtn");

  const gameOverTitle = document.getElementById("gameOverTitle");
  const gameOverReason = document.getElementById("gameOverReason");

  const howBtn = document.getElementById("howBtn");
  const closeHowBtn = document.getElementById("closeHowBtn");
  const coverBtn = document.getElementById("coverBtn");

  // =========================================================
  // STATE
  // =========================================================
  let W = 0, H = 0, DPR = 1;
  let levelIndex = 0;
  let running = false;
  let lastFrameTs = 0;
  let spawnTimerMs = 0;

  const falling = [];
  const caughtSet = new Set();
  const caughtList = [];
  const flyIns = [];

  let bombsCaught = 0;

  // duplicate reducer
  let lastSpawnSrc = "";
  let sameInRow = 0;

  // trolley
  const trolley = { x: 0, y: 0, w: 0, h: 0, dragging: false, dragOffsetX: 0 };

  // images
  const images = { background: null, trolley: null, bomb: null, products: [] };

  // confetti
  const confetti = [];
  let confettiUntilMs = 0;

  // bomb explosion particles
  const explosions = []; // {x,y,msLeft,parts:[{x,y,vx,vy,size,life,ttl}]}

  // bomb flash ring
  const flashRings = []; // {x,y,life,ttl}

  // screen shake
  let shakeMs = 0;
  let shakeAmp = 0;

  // =========================================================
  // HELPERS
  // =========================================================
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);

  const show = (el) => el && el.classList.add("show");
  const hide = (el) => el && el.classList.remove("show");

  function formatRand(n) {
    return "R" + n.toLocaleString("en-ZA");
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function toSafeUrl(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.error("❌ Image failed to load:", src);
        resolve(null);
      };
      img.src = toSafeUrl(src);
    });
  }

  // =========================================================
  // RESIZE
  // =========================================================
  function resize() {
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);

    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    confettiCanvas.width = Math.floor(W * DPR);
    confettiCanvas.height = Math.floor(H * DPR);
    confettiCanvas.style.width = W + "px";
    confettiCanvas.style.height = H + "px";
    confettiCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

    let baseW = Math.max(260, Math.min(520, W * 0.48));
    baseW *= SIZE.trolleyScale;

    trolley.w = baseW;
    trolley.h = trolley.w * 0.55;
    trolley.y = H - trolley.h - Math.max(10, H * 0.03);

    if (!trolley.x) trolley.x = W / 2;

    const margin = trolley.w * TROLLEY_OFFSCREEN_MARGIN;
    trolley.x = clamp(trolley.x, -margin, W + margin);
  }

  // =========================================================
  // HUD
  // =========================================================
  function updateHUD() {
    const month = MONTHS[levelIndex % MONTHS.length];
    const cover = caughtSet.size * RULES.coverPerUniqueProduct;

    if (monthNameEl) monthNameEl.textContent = month;
    if (coverValueEl) coverValueEl.textContent = formatRand(cover);
    if (productsCountEl) productsCountEl.textContent = `${caughtSet.size}/${ASSETS.products.length}`;
    if (bombsCountEl) bombsCountEl.textContent = `${bombsCaught}/${RULES.bombsAllowed}`;
  }

  // =========================================================
  // RESET / OVERLAYS
  // =========================================================
  function resetLevelState() {
    falling.length = 0;
    flyIns.length = 0;
    caughtSet.clear();
    caughtList.length = 0;

    bombsCaught = 0;
    spawnTimerMs = 0;

    lastSpawnSrc = "";
    sameInRow = 0;

    confetti.length = 0;
    confettiUntilMs = 0;

    explosions.length = 0;
    flashRings.length = 0;
    shakeMs = 0;
    shakeAmp = 0;

    updateHUD();
  }

  function gameOver(reason) {
    running = false;
    if (gameOverTitle) gameOverTitle.textContent = "Game Over";
    if (gameOverReason) gameOverReason.textContent = reason;
    show(gameOverOverlay);
  }

  function startConfetti(nowMs) {
    confetti.length = 0;
    confettiUntilMs = nowMs + 1800;

    const originX = W * 0.5;
    const originY = H * 0.28;
    const count = Math.max(80, Math.min(160, Math.floor(W * 0.20)));

    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const speed = rand(220, 650);

      confetti.push({
        x: originX + rand(-35, 35),
        y: originY + rand(-10, 10),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: rand(0, Math.PI * 2),
        vr: rand(-8, 8),
        size: rand(5, 10),
        life: 0,
        ttl: rand(1.0, 2.0),
        hue: (i * 29) % 360
      });
    }
  }

  function levelComplete(nowMs) {
    running = false;
    startConfetti(nowMs);
    show(levelOverlay);
  }

  // =========================================================
  // BOMB FEEDBACK: VIBRATE + SHAKE + EXPLOSION + FLASH RING
  // =========================================================
  function triggerBombFlash(x, y) {
    flashRings.push({ x, y, life: 0, ttl: 0.12 }); // 120ms pop
  }

  function triggerBombFeedback(x, y) {
    triggerBombFlash(x, y);

    // Vibration (works well on Android; iOS may ignore)
    try {
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    } catch {}

    // Bigger + longer shake
    shakeMs = 260;
    shakeAmp = Math.max(10, Math.min(26, W * 0.035));

    // Bigger explosion spray
    const parts = [];
    const count = 26;

    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(240, 820);
      parts.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: rand(4, 10),
        life: 0,
        ttl: rand(0.28, 0.55)
      });
    }

    explosions.push({ x, y, msLeft: 520, parts });
  }

  // =========================================================
  // DRAW HELPERS (contain)
  // =========================================================
  function getContainRect(img, boxX, boxY, boxW, boxH) {
    if (!img) return { dx: boxX, dy: boxY, dw: boxW, dh: boxH };
    const iw = img.width || 1;
    const ih = img.height || 1;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = boxX + (boxW - dw) / 2;
    const dy = boxY + (boxH - dh) / 2;
    return { dx, dy, dw, dh };
  }

  function drawImageContain(img, boxX, boxY, boxW, boxH) {
    if (!img) return;
    const { dx, dy, dw, dh } = getContainRect(img, boxX, boxY, boxW, boxH);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function getTrolleyDrawRect() {
    const boxX = trolley.x - trolley.w / 2;
    const boxY = trolley.y;
    return getContainRect(images.trolley, boxX, boxY, trolley.w, trolley.h);
  }

  function getBasketRect() {
    const tr = getTrolleyDrawRect();
    return {
      bx: tr.dx + tr.dw * BASKET.x,
      by: tr.dy + tr.dh * BASKET.y,
      bw: tr.dw * BASKET.w,
      bh: tr.dh * BASKET.h
    };
  }

  function getCatchRect() {
    const { bx, by, bw, bh } = getBasketRect();
    const xPad = bw * CATCH.xPadFrac;
    const yPad = bh * CATCH.yPadFrac;

    return {
      x: bx + xPad,
      y: by + yPad,
      w: bw - xPad * 2,
      h: (bh - yPad) * CATCH.hFrac
    };
  }

  // =========================================================
  // PILE SPOTS (inside trolley)
  // =========================================================
  function getPileSpot(i) {
    const spots = [
      { x: 0.22, y: 1.02, s: 0.82, r: -0.02 },
      { x: 0.52, y: 1.05, s: 0.86, r:  0.02 },
      { x: 0.74, y: 1.03, s: 0.82, r:  0.03 },
      { x: 0.30, y: 0.88, s: 0.70, r: -0.02 },
      { x: 0.58, y: 0.90, s: 0.72, r:  0.01 },
      { x: 0.22, y: 0.74, s: 0.60, r: -0.03 },
      { x: 0.50, y: 0.76, s: 0.62, r:  0.00 },
      { x: 0.74, y: 0.76, s: 0.60, r:  0.03 }
    ];

    const base = spots[i % spots.length];
    const jx = (((i * 17) % 7) - 3) * 0.006;
    const jy = (((i * 29) % 7) - 3) * 0.006;
    const jr = (((i * 13) % 7) - 3) * 0.004;

    return {
      x: clamp(base.x + jx, 0.10, 0.90),
      y: base.y + jy,
      s: base.s,
      r: base.r + jr
    };
  }

  // =========================================================
  // PRODUCT PICKING (duplicates allowed, not too many)
  // =========================================================
  function pickProductIndex(unseenBias) {
    const total = ASSETS.products.length;

    const unseen = [];
    for (let i = 0; i < total; i++) {
      const src = ASSETS.products[i];
      if (!caughtSet.has(src)) unseen.push(i);
    }

    const useUnseen = unseen.length > 0 && Math.random() < unseenBias;
    let idx = useUnseen
      ? unseen[Math.floor(Math.random() * unseen.length)]
      : Math.floor(Math.random() * total);

    // avoid same product spam 3+ in a row
    for (let attempts = 0; attempts < 4; attempts++) {
      const src = ASSETS.products[idx];
      if (src !== lastSpawnSrc) break;
      if (sameInRow < 2) break;

      idx = useUnseen
        ? unseen[Math.floor(Math.random() * unseen.length)]
        : Math.floor(Math.random() * total);
    }

    return idx;
  }

  function spawnXForItem(size) {
    const off = size * ITEM_OFFSCREEN_FRAC;
    return rand(-off, W + off);
  }

  function spawnItem(diff) {
    const isBomb = Math.random() < diff.bombChance;

    if (isBomb) {
      const size = Math.max(46, Math.min(84, W * 0.095));
      falling.push({
        type: "bomb",
        img: images.bomb,
        x: spawnXForItem(size),
        y: -size,
        vy: rand(diff.minFallSpeed, diff.maxFallSpeed),
        size
      });
      return;
    }

    let size = Math.max(56, Math.min(96, W * 0.105));
    size *= SIZE.productScale;

    const idx = pickProductIndex(diff.unseenBias);
    const src = ASSETS.products[idx];

    if (src === lastSpawnSrc) sameInRow++;
    else sameInRow = 0;
    lastSpawnSrc = src;

    falling.push({
      type: "product",
      src,
      img: images.products[idx],
      x: spawnXForItem(size),
      y: -size,
      vy: rand(diff.minFallSpeed, diff.maxFallSpeed),
      size
    });
  }

  // =========================================================
  // DRAW
  // =========================================================
  function drawBackground() {
    const img = images.background;
    if (!img) return;

    const iw = img.width, ih = img.height;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawFalling() {
    for (const it of falling) {
      drawImageContain(it.img, it.x - it.size / 2, it.y - it.size / 2, it.size, it.size);
    }
  }

  function drawFlyIns(nowMs) {
    for (let i = flyIns.length - 1; i >= 0; i--) {
      const f = flyIns[i];
      const t = clamp((nowMs - f.startMs) / f.durationMs, 0, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      const x = f.fromX + (f.targetX - f.fromX) * ease;
      const y = f.fromY + (f.targetY - f.fromY) * ease;

      const boxSize = f.size * (1 - 0.45 * ease);
      drawImageContain(f.img, x - boxSize / 2, y - boxSize / 2, boxSize, boxSize);

      if (t >= 1) flyIns.splice(i, 1);
    }
  }

  function drawStackedInTrolley() {
    const { bx, by, bw, bh } = getBasketRect();

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();

    for (let i = 0; i < caughtList.length; i++) {
      const item = caughtList[i];
      if (!item.img) continue;

      const spot = getPileSpot(i);
      const centerX = bx + bw * spot.x;
      const baseY = by + bh * spot.y;

      const boxW = bw * spot.s;
      const boxH = bh * spot.s;

      ctx.save();
      ctx.translate(centerX, baseY);
      ctx.rotate(spot.r);
      drawImageContain(item.img, -boxW / 2, -boxH, boxW, boxH);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawTrolley() {
    const boxX = trolley.x - trolley.w / 2;
    const boxY = trolley.y;
    drawImageContain(images.trolley, boxX, boxY, trolley.w, trolley.h);
  }

  function drawExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
      const ex = explosions[i];
      ex.msLeft -= dt * 1000;

      for (let j = ex.parts.length - 1; j >= 0; j--) {
        const p = ex.parts[j];
        p.life += dt;

        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.life > p.ttl) {
          ex.parts.splice(j, 1);
          continue;
        }

        const a = 1 - (p.life / p.ttl);
        ctx.save();
        ctx.globalAlpha = a;

        // warm explosion colors
        const hot = Math.floor(200 + 55 * a);
        ctx.fillStyle = `rgb(${hot}, ${Math.floor(120 + 80*a)}, ${Math.floor(20 + 40*a)})`;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (ex.msLeft <= 0 || ex.parts.length === 0) explosions.splice(i, 1);
    }
  }

  function drawFlashRings(dt) {
    for (let i = flashRings.length - 1; i >= 0; i--) {
      const r = flashRings[i];
      r.life += dt;

      if (r.life >= r.ttl) {
        flashRings.splice(i, 1);
        continue;
      }

      const t = r.life / r.ttl;     // 0 -> 1
      const a = 1 - t;              // fade out
      const radius = 12 + t * 92;   // bigger ring
      const lineW = 12 - t * 10;    // thick -> thin

      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = "white";
      ctx.lineWidth = Math.max(1, lineW);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawConfetti(nowMs, dt) {
    confettiCtx.clearRect(0, 0, W, H);
    if (confettiUntilMs <= 0 && confetti.length === 0) return;

    const gravity = 1200;

    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.life += dt;

      c.vy += gravity * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;

      if (c.life > c.ttl || c.y > H + 90) {
        confetti.splice(i, 1);
        continue;
      }

      confettiCtx.save();
      confettiCtx.translate(c.x, c.y);
      confettiCtx.rotate(c.rot);

      const a = 1 - (c.life / c.ttl);
      confettiCtx.globalAlpha = Math.max(0, Math.min(1, a));
      confettiCtx.fillStyle = `hsl(${c.hue}, 90%, 60%)`;
      confettiCtx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.7);

      confettiCtx.restore();
    }

    if (nowMs > confettiUntilMs) confettiUntilMs = 0;
  }

  // =========================================================
  // LOOP
  // =========================================================
  function tick(ts) {
    if (!lastFrameTs) lastFrameTs = ts;
    const dt = Math.min(0.033, (ts - lastFrameTs) / 1000);
    lastFrameTs = ts;

    if (running) {
      const diff = runtimeDifficulty(levelIndex, caughtSet.size, ASSETS.products.length);

      spawnTimerMs += dt * 1000;
      if (spawnTimerMs >= diff.spawnIntervalMs) {
        spawnTimerMs = 0;
        spawnItem(diff);
      }

      const catchRect = getCatchRect();

      for (let i = falling.length - 1; i >= 0; i--) {
        const it = falling[i];
        it.y += it.vy * dt;

        const itemRect = { x: it.x - it.size / 2, y: it.y - it.size / 2, w: it.size, h: it.size };

        // catch check
        if (aabb(catchRect.x, catchRect.y, catchRect.w, catchRect.h, itemRect.x, itemRect.y, itemRect.w, itemRect.h)) {
          if (it.type === "bomb") {
            triggerBombFeedback(it.x, it.y);

            bombsCaught++;
            falling.splice(i, 1);
            updateHUD();

            if (bombsCaught >= RULES.bombsAllowed) {
              gameOver("3 bomb hits. Restart the month.");
              break;
            }
          } else {
            if (!caughtSet.has(it.src)) {
              caughtSet.add(it.src);
              caughtList.push({ src: it.src, img: it.img });

              const { bx, by, bw, bh } = getBasketRect();
              flyIns.push({
                img: it.img,
                fromX: it.x,
                fromY: it.y,
                startMs: ts,
                durationMs: 220,
                size: it.size,
                targetX: bx + bw * 0.55,
                targetY: by + bh * 0.95
              });

              updateHUD();

              if (caughtSet.size >= ASSETS.products.length) {
                falling.splice(i, 1);
                levelComplete(ts);
                break;
              }
            }

            falling.splice(i, 1);
          }
          continue;
        }

        // no missed penalty
        if (it.y - it.size / 2 > H + 90) {
          falling.splice(i, 1);
        }
      }
    }

    // screen shake calc (punchy)
    let shakeX = 0, shakeY = 0;
    if (shakeMs > 0) {
      shakeMs -= dt * 1000;
      const t = clamp(shakeMs / 260, 0, 1);
      const amp = shakeAmp * (t * t);
      shakeX = rand(-amp, amp);
      shakeY = rand(-amp, amp);
      if (shakeMs <= 0) { shakeMs = 0; shakeAmp = 0; }
    }

    // render
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawBackground();
    drawFalling();
    drawFlyIns(ts);
    drawStackedInTrolley();
    drawTrolley();
    drawExplosions(dt);
    drawFlashRings(dt);

    ctx.restore();

    drawConfetti(ts, dt);

    requestAnimationFrame(tick);
  }

  // =========================================================
  // INPUT (drag trolley; trolley can go off-screen)
  // =========================================================
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const p = pointerPos(e);
    if (p.y >= trolley.y && p.y <= trolley.y + trolley.h + 30) {
      trolley.dragging = true;
      trolley.dragOffsetX = p.x - trolley.x;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!trolley.dragging) return;
    const p = pointerPos(e);
    const margin = trolley.w * TROLLEY_OFFSCREEN_MARGIN;
    trolley.x = clamp(p.x - trolley.dragOffsetX, -margin, W + margin);
  });

  canvas.addEventListener("pointerup", (e) => {
    trolley.dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });

  canvas.addEventListener("pointercancel", () => {
    trolley.dragging = false;
  });

  // =========================================================
  // BUTTONS
  // =========================================================
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      hide(startOverlay);
      hide(gameOverOverlay);
      hide(levelOverlay);
      resetLevelState();
      running = true;
    });
  }

  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      hide(gameOverOverlay);
      resetLevelState();
      running = true;
    });
  }

  if (nextLevelBtn) {
    nextLevelBtn.addEventListener("click", () => {
      hide(levelOverlay);
      levelIndex++;
      resetLevelState();
      running = true;
    });
  }

  if (howBtn) howBtn.addEventListener("click", () => show(howOverlay));
  if (closeHowBtn) closeHowBtn.addEventListener("click", () => hide(howOverlay));

  if (coverBtn) {
    coverBtn.addEventListener("click", () => {
      window.open("https://bigsave.co.za/big-save-funeral-cover/", "_blank", "noopener,noreferrer");
    });
  }

  // =========================================================
  // PRELOAD / INIT
  // =========================================================
  async function preload() {
    images.background = await loadImage(ASSETS.background);
    images.trolley = await loadImage(ASSETS.trolley);
    images.bomb = await loadImage(ASSETS.bomb);

    images.products = [];
    for (const p of ASSETS.products) {
      images.products.push(await loadImage(p));
    }
  }

  window.addEventListener("resize", resize);

  (async function init() {
    resize();
    updateHUD();
    await preload();
    requestAnimationFrame(tick);
  })();
})();
