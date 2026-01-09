(() => {
  // =========================================================
  // ASSETS (MATCH YOUR CURRENT NAMES/FOLDERS)
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
    coverPerUniqueProduct: 1000
  };

  // =========================================================
  // SIZE / FEEL
  // =========================================================
  const SIZE = {
    trolleyScale: 0.80,
    productScale: 1.10
  };

  // Trolley can go off-screen by this margin (portion of trolley width)
  const TROLLEY_OFFSCREEN_MARGIN = 0.70; // 70% of trolley width off-screen is allowed

  // Items can spawn partly off-screen (fraction of item size)
  const ITEM_OFFSCREEN_FRAC = 0.55; // allow half the item to start off-screen

  // Basket tuning for your trolley PNG (relative to trolley draw rect)
  const BASKET = { x: 0.05, y: 0.20, w: 0.72, h: 0.32 };
  const CATCH  = { xPadFrac: 0.10, yPadFrac: 0.10, hFrac: 0.75 };

  // =========================================================
  // DIFFICULTY
  // - Level 1 starts fairly challenging.
  // - Gets harder per month.
  // - Also ramps slightly within a month as you approach 20/20.
  // =========================================================
  function baseDifficulty(levelIdx) {
    const t = Math.min(1, Math.max(0, levelIdx / 11));
    const ramp = t * t; // smoother early, stronger later

    // Level 1 already challenging:
    const spawnIntervalMs = Math.round(720 - ramp * 220); // 720 -> 500
    const bombChance      = 0.18 + ramp * 0.18;           // 18% -> 36%
    const minFallSpeed    = 170 + ramp * 120;             // 170 -> 290
    const maxFallSpeed    = 340 + ramp * 220;             // 340 -> 560

    // duplicates control (still allow, but bias toward unseen)
    const unseenBias      = 0.76 - ramp * 0.10;           // 76% -> 66%

    return { spawnIntervalMs, bombChance, minFallSpeed, maxFallSpeed, unseenBias };
  }

  function runtimeDifficulty(levelIdx, caughtCount, totalProducts) {
    const base = baseDifficulty(levelIdx);

    // In-level ramp: slightly harder near the end
    const p = totalProducts <= 0 ? 0 : Math.min(1, Math.max(0, caughtCount / totalProducts));
    const ease = p * p;

    const spawnIntervalMs = Math.max(430, Math.round(base.spawnIntervalMs - ease * 70));
    const bombChance      = Math.min(0.48, base.bombChance + ease * 0.08);
    const minFallSpeed    = base.minFallSpeed + ease * 35;
    const maxFallSpeed    = base.maxFallSpeed + ease * 60;

    return {
      spawnIntervalMs,
      bombChance,
      minFallSpeed,
      maxFallSpeed,
      unseenBias: base.unseenBias
    };
  }

  // =========================================================
  // DOM
  // =========================================================
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

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
  const levelCoverEl = document.getElementById("levelCover");
  const levelMonthEl = document.getElementById("levelMonth");

  const howBtn = document.getElementById("howBtn");
  const closeHowBtn = document.getElementById("closeHowBtn");

  // =========================================================
  // STATE
  // =========================================================
  let W = 0, H = 0, DPR = 1;

  let levelIndex = 0;
  let running = false;
  let lastFrameTs = 0;

  let spawnTimerMs = 0;
  let spawnIntervalMs = 720;

  const falling = [];
  const caughtSet = new Set();
  const caughtList = []; // {src, img}

  const flyIns = []; // { img, fromX, fromY, startMs, durationMs, size, targetX, targetY }

  let bombsCaught = 0;

  // Reduce “same product spam” even when duplicates exist
  let lastSpawnSrc = "";
  let sameInRow = 0;

  // Trolley
  const trolley = { x: 0, y: 0, w: 0, h: 0, dragging: false, dragOffsetX: 0 };

  const images = { background: null, trolley: null, bomb: null, products: [] };

  // =========================================================
  // HELPERS
  // =========================================================
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const currency = (n) => "R" + n.toLocaleString("en-ZA");
  const show = (el) => el.classList.add("show");
  const hide = (el) => el.classList.remove("show");

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // Encode each segment so spaces + apostrophes work on GitHub Pages
  function toSafeUrl(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.error("❌ Image failed:", src, "=>", toSafeUrl(src));
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

    let baseW = Math.max(260, Math.min(520, W * 0.48));
    baseW *= SIZE.trolleyScale;

    trolley.w = baseW;
    trolley.h = trolley.w * 0.55;
    trolley.y = H - trolley.h - Math.max(10, H * 0.03);

    if (!trolley.x) trolley.x = W / 2;

    // Allow trolley to go off-screen
    const margin = trolley.w * TROLLEY_OFFSCREEN_MARGIN;
    trolley.x = clamp(trolley.x, -margin, W + margin);
  }

  // =========================================================
  // HUD
  // =========================================================
  function updateHUD() {
    const month = MONTHS[levelIndex % MONTHS.length];
    const cover = caughtSet.size * RULES.coverPerUniqueProduct;

    monthNameEl.textContent = month;
    coverValueEl.textContent = currency(cover);
    productsCountEl.textContent = `${caughtSet.size}/${ASSETS.products.length}`;
    bombsCountEl.textContent = `${bombsCaught}/${RULES.bombsAllowed}`;
  }

  // =========================================================
  // LEVEL RESET
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

    // start interval from current base difficulty
    spawnIntervalMs = baseDifficulty(levelIndex).spawnIntervalMs;

    updateHUD();
  }

  function gameOver(reason) {
    running = false;
    gameOverTitle.textContent = "Game Over";
    gameOverReason.textContent = reason;
    show(gameOverOverlay);
  }

  function levelComplete() {
    running = false;
    const month = MONTHS[levelIndex % MONTHS.length];
    levelMonthEl.textContent = month;
    levelCoverEl.textContent = currency(ASSETS.products.length * RULES.coverPerUniqueProduct);
    show(levelOverlay);
  }

  // =========================================================
  // DRAW HELPERS (contain) + trolley draw rect for accurate basket
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
    const bx = tr.dx + tr.dw * BASKET.x;
    const by = tr.dy + tr.dh * BASKET.y;
    const bw = tr.dw * BASKET.w;
    const bh = tr.dh * BASKET.h;
    return { bx, by, bw, bh };
  }

  function getCatchRect() {
    const { bx, by, bw, bh } = getBasketRect();
    const xPad = bw * CATCH.xPadFrac;
    const yPad = bh * CATCH.yPadFrac;

    const cx = bx + xPad;
    const cy = by + yPad;
    const cw = bw - xPad * 2;
    const ch = (bh - yPad) * CATCH.hFrac;

    return { x: cx, y: cy, w: cw, h: ch };
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
      { x: 0.74, y: 0.76, s: 0.60, r:  0.03 },
    ];

    const base = spots[i % spots.length];
    const jx = (((i * 17) % 7) - 3) * 0.006;
    const jy = (((i * 29) % 7) - 3) * 0.006;
    const jr = (((i * 13) % 7) - 3) * 0.004;

    const x = clamp(base.x + jx, 0.10, 0.90);
    const y = base.y + jy;

    return { x, y, s: base.s, r: base.r + jr };
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

    // prevent same product repeating too many times in a row
    for (let attempts = 0; attempts < 4; attempts++) {
      const src = ASSETS.products[idx];
      if (src !== lastSpawnSrc) break;
      if (sameInRow < 2) break; // allow up to 2 repeats
      idx = useUnseen
        ? unseen[Math.floor(Math.random() * unseen.length)]
        : Math.floor(Math.random() * total);
    }

    return idx;
  }

  // =========================================================
  // SPAWN (items can be partly off-screen)
  // =========================================================
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

  // =========================================================
  // LOOP
  // =========================================================
  function tick(ts) {
    if (!lastFrameTs) lastFrameTs = ts;
    const dt = Math.min(0.033, (ts - lastFrameTs) / 1000);
    lastFrameTs = ts;

    if (running) {
      const diff = runtimeDifficulty(levelIndex, caughtSet.size, ASSETS.products.length);

      // Smoothly adapt spawn interval as difficulty changes
      spawnIntervalMs = diff.spawnIntervalMs;

      spawnTimerMs += dt * 1000;
      if (spawnTimerMs >= spawnIntervalMs) {
        spawnTimerMs = 0;
        spawnItem(diff);
      }

      // Catch rect is based on trolley position (even if trolley off-screen)
      const catchRect = getCatchRect();

      for (let i = falling.length - 1; i >= 0; i--) {
        const it = falling[i];
        it.y += it.vy * dt;

        const itemRect = {
          x: it.x - it.size / 2,
          y: it.y - it.size / 2,
          w: it.size,
          h: it.size
        };

        // Catch check
        if (aabb(catchRect.x, catchRect.y, catchRect.w, catchRect.h, itemRect.x, itemRect.y, itemRect.w, itemRect.h)) {
          if (it.type === "bomb") {
            bombsCaught++;
            falling.splice(i, 1);
            updateHUD();

            if (bombsCaught >= RULES.bombsAllowed) {
              gameOver("3 bomb hits. Restart the month.");
              break;
            }
          } else {
            // Unique -> stack + progress. Duplicate -> just disappears.
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
                levelComplete();
                break;
              }
            }
            falling.splice(i, 1);
          }
          continue;
        }

        // Remove items that fall beyond the bottom (no penalty at all)
        if (it.y - it.size / 2 > H + 80) {
          falling.splice(i, 1);
        }
      }
    }

    // Render order
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawFalling();
    drawFlyIns(ts);
    drawStackedInTrolley();
    drawTrolley();

    requestAnimationFrame(tick);
  }

  // =========================================================
  // INPUT (drag trolley) — allow off-screen travel
  // =========================================================
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const p = pointerPos(e);
    const tx = trolley.x - trolley.w / 2;
    const ty = trolley.y;

    // You can grab where the trolley would be (even partly off-screen)
    if (p.y >= ty && p.y <= ty + trolley.h + 30) {
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
  startBtn.addEventListener("click", () => {
    hide(startOverlay);
    hide(gameOverOverlay);
    hide(levelOverlay);
    resetLevelState();
    running = true;
  });

  restartBtn.addEventListener("click", () => {
    hide(gameOverOverlay);
    resetLevelState();
    running = true;
  });

  nextLevelBtn.addEventListener("click", () => {
    hide(levelOverlay);
    levelIndex++;
    resetLevelState();
    running = true;
  });

  howBtn.addEventListener("click", () => show(howOverlay));
  closeHowBtn.addEventListener("click", () => hide(howOverlay));

  // =========================================================
  // PRELOAD
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

  // =========================================================
  // INIT
  // =========================================================
  window.addEventListener("resize", resize);

  (async function init() {
    resize();
    updateHUD();
    await preload();
    requestAnimationFrame(tick);
  })();
})();
