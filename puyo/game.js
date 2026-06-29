/* ぷよぷよ for iPad — タッチ操作対応の静的ぷよぷよ */
(() => {
  "use strict";

  // ===== 盤面定義 =====
  const COLS = 6;
  const ROWS = 12;          // 表示する行数
  const HIDDEN = 1;         // 上部の隠し行（出現スペース）
  const TOTAL_ROWS = ROWS + HIDDEN;
  const SPAWN_COL = 2;      // 軸ぷよの出現列

  // 色（0 は空）
  const COLORS = [
    null,
    "#ff4d6d", // 1 赤
    "#36d399", // 2 緑
    "#3aa0ff", // 3 青
    "#ffd23f", // 4 黄
    "#b072ff", // 5 紫
  ];
  const NUM_COLORS = 4; // 使用する色数（1..NUM_COLORS）

  // ===== DOM =====
  const boardCanvas = document.getElementById("board");
  const bctx = boardCanvas.getContext("2d");
  const nextCanvas = document.getElementById("next");
  const nctx = nextCanvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const chainEl = document.getElementById("chain");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");

  // ===== 状態 =====
  let grid;            // [TOTAL_ROWS][COLS] 0 または色番号
  let cell = 32;       // 1マスのピクセルサイズ（描画時に算出）
  let current = null;  // 操作中のぷよペア
  let nextPair = null; // 次のペア
  let score = 0;
  let bestScore = Number(localStorage.getItem("puyo_best") || 0);
  let maxChain = 0;
  let running = false;
  let gameOver = false;

  // 落下タイマー
  let dropTimer = 0;
  const DROP_INTERVAL = 700; // 通常落下間隔(ms)
  const SOFT_INTERVAL = 50;  // ソフト中
  let softDropping = false;
  let lastTime = 0;

  // 連鎖アニメーション制御
  let resolving = false;

  bestEl.textContent = bestScore;

  // ===== ユーティリティ =====
  function emptyGrid() {
    return Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(0));
  }

  function randColor() {
    return 1 + Math.floor(Math.random() * NUM_COLORS);
  }

  function makePair() {
    return { axis: randColor(), child: randColor() };
  }

  // 回転状態 rot: 0=child上, 1=child右, 2=child下, 3=child左
  function childOffset(rot) {
    switch (rot & 3) {
      case 0: return { dx: 0, dy: -1 };
      case 1: return { dx: 1, dy: 0 };
      case 2: return { dx: 0, dy: 1 };
      case 3: return { dx: -1, dy: 0 };
    }
  }

  function spawn() {
    const pair = nextPair || makePair();
    nextPair = makePair();
    current = {
      x: SPAWN_COL,
      y: HIDDEN, // 軸ぷよを最上段（表示先頭行）に配置
      rot: 0,
      axis: pair.axis,
      child: pair.child,
    };
    drawNext();
    // 出現位置が埋まっていたらゲームオーバー
    if (!valid(current.x, current.y, current.rot)) {
      endGame();
    }
  }

  function childPos(c) {
    const o = childOffset(c.rot);
    return { x: c.x + o.dx, y: c.y + o.dy };
  }

  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < TOTAL_ROWS;
  }

  function isFree(x, y) {
    // 上方向の隠し行ははみ出し許容
    if (y < 0) return x >= 0 && x < COLS;
    return inBounds(x, y) && grid[y][x] === 0;
  }

  function valid(x, y, rot) {
    const o = childOffset(rot);
    const cx = x + o.dx;
    const cy = y + o.dy;
    return isFree(x, y) && isFree(cx, cy);
  }

  // ===== 操作 =====
  function move(dx) {
    if (!current || resolving) return;
    if (valid(current.x + dx, current.y, current.rot)) {
      current.x += dx;
    }
  }

  function rotate(dir) {
    if (!current || resolving) return;
    const newRot = (current.rot + dir + 4) & 3;
    // 通常回転
    if (valid(current.x, current.y, newRot)) {
      current.rot = newRot;
      return;
    }
    // 壁蹴り：左右にずらして再試行
    for (const kick of [-1, 1, -2, 2]) {
      if (valid(current.x + kick, current.y, newRot)) {
        current.x += kick;
        current.rot = newRot;
        return;
      }
    }
    // 上方向へのずらし（床際での回転）
    if (valid(current.x, current.y - 1, newRot)) {
      current.y -= 1;
      current.rot = newRot;
    }
  }

  function softDrop(on) {
    softDropping = on;
  }

  function hardDrop() {
    if (!current || resolving) return;
    while (valid(current.x, current.y + 1, current.rot)) {
      current.y += 1;
    }
    lockPair();
  }

  // ペアを盤面へ固定
  function lockPair() {
    if (!current) return;
    const cp = childPos(current);
    if (current.y >= 0) grid[current.y][current.x] = current.axis;
    if (cp.y >= 0) grid[cp.y][cp.x] = current.child;
    current = null;
    resolveBoard();
  }

  // ===== 重力・消去・連鎖 =====
  function applyGravity() {
    let moved = false;
    for (let x = 0; x < COLS; x++) {
      let write = TOTAL_ROWS - 1;
      for (let y = TOTAL_ROWS - 1; y >= 0; y--) {
        if (grid[y][x] !== 0) {
          if (write !== y) {
            grid[write][x] = grid[y][x];
            grid[y][x] = 0;
            moved = true;
          }
          write--;
        }
      }
    }
    return moved;
  }

  // 4つ以上つながった色を探して消す。消したぷよ数と色種類数を返す
  function clearGroups() {
    const seen = Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(false));
    const toClear = [];
    const colorsCleared = new Set();

    for (let y = 0; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] === 0 || seen[y][x]) continue;
        const color = grid[y][x];
        const group = [];
        const stack = [[x, y]];
        seen[y][x] = true;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          group.push([cx, cy]);
          const nbrs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbrs) {
            if (inBounds(nx, ny) && !seen[ny][nx] && grid[ny][nx] === color) {
              seen[ny][nx] = true;
              stack.push([nx, ny]);
            }
          }
        }
        if (group.length >= 4) {
          toClear.push(...group);
          colorsCleared.add(color);
        }
      }
    }

    for (const [cx, cy] of toClear) grid[cy][cx] = 0;
    return { count: toClear.length, colors: colorsCleared.size };
  }

  // 連鎖ボーナステーブル（簡易版）
  const CHAIN_BONUS = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
  const COLOR_BONUS = [0, 0, 3, 6, 12, 24];

  // 盤面を落ち着かせて連鎖処理（アニメーション付き）
  function resolveBoard() {
    resolving = true;
    let chain = 0;

    function step() {
      applyGravity();
      const { count, colors } = clearGroups();
      if (count > 0) {
        chain++;
        // スコア計算
        const chainBonus = CHAIN_BONUS[Math.min(chain, CHAIN_BONUS.length - 1)];
        const colorBonus = COLOR_BONUS[Math.min(colors, COLOR_BONUS.length - 1)];
        let bonus = chainBonus + colorBonus;
        if (bonus < 1) bonus = 1;
        score += count * 10 * bonus;
        if (chain > maxChain) maxChain = chain;
        updateHud(chain);
        draw();
        // 連鎖が続くか少し待つ
        setTimeout(step, 220);
      } else {
        // 連鎖終了
        applyGravity();
        draw();
        resolving = false;
        finalizeTurn();
      }
    }

    step();
  }

  function finalizeTurn() {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem("puyo_best", String(bestScore));
      bestEl.textContent = bestScore;
    }
    if (gameOver) return;
    spawn();
    dropTimer = 0;
  }

  // ===== ゲーム進行 =====
  function update(dt) {
    if (!running || resolving || !current) return;
    dropTimer += dt;
    const interval = softDropping ? SOFT_INTERVAL : DROP_INTERVAL;
    if (dropTimer >= interval) {
      dropTimer = 0;
      if (valid(current.x, current.y + 1, current.rot)) {
        current.y += 1;
      } else {
        lockPair();
      }
    }
  }

  function loop(t) {
    const dt = t - lastTime;
    lastTime = t;
    if (running) {
      update(dt);
      draw();
    }
    requestAnimationFrame(loop);
  }

  // ===== 描画 =====
  function resize() {
    const wrap = boardCanvas.parentElement;
    const availH = wrap.clientHeight || window.innerHeight * 0.7;
    const availW = wrap.clientWidth || window.innerWidth * 0.6;
    const cellH = Math.floor(availH / ROWS);
    const cellW = Math.floor(availW / COLS);
    cell = Math.max(16, Math.min(cellH, cellW));
    const dpr = window.devicePixelRatio || 1;
    boardCanvas.width = COLS * cell * dpr;
    boardCanvas.height = ROWS * cell * dpr;
    boardCanvas.style.width = COLS * cell + "px";
    boardCanvas.style.height = ROWS * cell + "px";
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function drawPuyo(ctx, gx, gy, color, size) {
    if (!color) return;
    const r = size / 2;
    const cx = gx + r;
    const cy = gy + r;
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.25, COLORS[color]);
    grad.addColorStop(1, COLORS[color]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    // 目
    ctx.fillStyle = "#fff";
    const eo = r * 0.32;
    const er = r * 0.22;
    ctx.beginPath();
    ctx.arc(cx - eo, cy - r * 0.1, er, 0, Math.PI * 2);
    ctx.arc(cx + eo, cy - r * 0.1, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(cx - eo, cy - r * 0.05, er * 0.5, 0, Math.PI * 2);
    ctx.arc(cx + eo, cy - r * 0.05, er * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    const w = COLS * cell;
    const h = ROWS * cell;
    bctx.clearRect(0, 0, w, h);
    // 背景
    bctx.fillStyle = "#0a0b18";
    bctx.fillRect(0, 0, w, h);
    bctx.strokeStyle = "rgba(255,255,255,0.05)";
    bctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      bctx.beginPath();
      bctx.moveTo(x * cell, 0);
      bctx.lineTo(x * cell, h);
      bctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      bctx.beginPath();
      bctx.moveTo(0, y * cell);
      bctx.lineTo(w, y * cell);
      bctx.stroke();
    }
    // 固定ぷよ（隠し行は描かない）
    for (let y = HIDDEN; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x]) {
          drawPuyo(bctx, x * cell, (y - HIDDEN) * cell, grid[y][x], cell);
        }
      }
    }
    // 操作中ペア
    if (current) {
      const cp = childPos(current);
      if (current.y >= HIDDEN) drawPuyo(bctx, current.x * cell, (current.y - HIDDEN) * cell, current.axis, cell);
      if (cp.y >= HIDDEN) drawPuyo(bctx, cp.x * cell, (cp.y - HIDDEN) * cell, current.child, cell);
    }
  }

  function drawNext() {
    const size = 56;
    nextCanvas.width = size;
    nextCanvas.height = size * 2;
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPair) return;
    drawPuyo(nctx, (nextCanvas.width - size) / 2, 0, nextPair.child, size);
    drawPuyo(nctx, (nextCanvas.width - size) / 2, size, nextPair.axis, size);
  }

  function updateHud(chain) {
    scoreEl.textContent = score;
    chainEl.textContent = chain || 0;
  }

  // ===== ゲーム開始・終了 =====
  function startGame() {
    grid = emptyGrid();
    score = 0;
    maxChain = 0;
    gameOver = false;
    resolving = false;
    current = null;
    nextPair = makePair();
    updateHud(0);
    overlay.classList.add("hidden");
    running = true;
    resize();
    spawn();
  }

  function endGame() {
    gameOver = true;
    running = false;
    current = null;
    overlayTitle.textContent = "ゲームオーバー";
    overlayText.innerHTML = `スコア: ${score}　最大連鎖: ${maxChain}<br />もう一度挑戦しよう！`;
    startBtn.textContent = "リトライ";
    overlay.classList.remove("hidden");
  }

  // ===== 入力 =====
  const actions = {
    left: () => move(-1),
    right: () => move(1),
    rotateCw: () => rotate(1),
    rotateCcw: () => rotate(-1),
    drop: () => hardDrop(),
  };

  document.querySelectorAll(".ctrl").forEach((btn) => {
    const action = btn.dataset.action;
    const handler = (e) => {
      e.preventDefault();
      if (actions[action]) actions[action]();
    };
    btn.addEventListener("touchstart", handler, { passive: false });
    btn.addEventListener("mousedown", handler);
  });

  // キーボード（PC確認用）
  document.addEventListener("keydown", (e) => {
    if (!running) return;
    switch (e.key) {
      case "ArrowLeft": move(-1); break;
      case "ArrowRight": move(1); break;
      case "ArrowUp": case "x": rotate(1); break;
      case "z": rotate(-1); break;
      case "ArrowDown": softDrop(true); break;
      case " ": e.preventDefault(); hardDrop(); break;
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "ArrowDown") softDrop(false);
  });

  // 盤面スワイプ操作
  let touchStart = null;
  boardCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
  }, { passive: false });

  boardCanvas.addEventListener("touchmove", (e) => {
    if (!touchStart || !running || resolving) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const threshold = cell * 0.8;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      move(dx > 0 ? 1 : -1);
      touchStart.x = t.clientX;
      touchStart.moved = true;
    } else if (dy > threshold) {
      softDrop(true);
      touchStart.y = t.clientY;
      touchStart.moved = true;
    }
  }, { passive: false });

  boardCanvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    softDrop(false);
    if (touchStart && !touchStart.moved) {
      const dt = Date.now() - touchStart.t;
      if (dt < 250) {
        if (!running && !gameOver) startGame();
        else if (running) rotate(1); // タップで回転
      }
    }
    touchStart = null;
  }, { passive: false });

  startBtn.addEventListener("click", (e) => {
    e.preventDefault();
    startGame();
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  // 初期化
  grid = emptyGrid();
  resize();
  drawNext();
  requestAnimationFrame(loop);
})();
