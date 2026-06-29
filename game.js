"use strict";

// ---- Board configuration ----
const COLS = 10;
const ROWS = 20;

// Tetromino definitions (SRS spawn states) and colors.
const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

const COLORS = {
  I: "#2ee6e6",
  O: "#f4d03f",
  T: "#a569bd",
  S: "#52be80",
  Z: "#ec7063",
  J: "#5dade2",
  L: "#e59866",
};

const TYPES = Object.keys(SHAPES);

// ---- Canvas / DOM ----
const boardCanvas = document.getElementById("board");
const bctx = boardCanvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nctx = nextCanvas.getContext("2d");
const holdCanvas = document.getElementById("hold");
const hctx = holdCanvas.getContext("2d");

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const startBtn = document.getElementById("start-btn");

let cell = 24; // pixel size of one cell, computed responsively

// ---- Game state ----
let grid, current, nextQueue, holdType, canHold;
let score, lines, level;
let dropInterval, dropTimer, lastTime;
let running = false;
let paused = false;
let rafId = null;

function emptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// 7-bag randomizer
let bag = [];
function nextFromBag() {
  if (bag.length === 0) {
    bag = [...TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

function makePiece(type) {
  return {
    type,
    cells: SHAPES[type].map(([x, y]) => [x, y]),
    x: type === "I" || type === "O" ? 3 : 3,
    y: 0,
  };
}

// Rotate cells around a center. Uses a simple bounding-box rotation that
// works well for casual play (clockwise / counter-clockwise).
function rotateCells(cells, type, dir) {
  if (type === "O") return cells.map((c) => [...c]);
  // I uses a 4x4 box, others a 3x3 box.
  const size = type === "I" ? 4 : 3;
  return cells.map(([x, y]) => {
    if (dir > 0) return [size - 1 - y, x];
    return [y, size - 1 - x];
  });
}

function collides(piece, grid, offX = 0, offY = 0, cells = piece.cells) {
  for (const [cx, cy] of cells) {
    const x = piece.x + cx + offX;
    const y = piece.y + cy + offY;
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && grid[y][x]) return true;
  }
  return false;
}

function spawn(type) {
  current = makePiece(type);
  current.y = -1;
  // If it collides immediately -> game over.
  if (collides(current, grid)) {
    gameOver();
    return;
  }
  canHold = true;
}

function lockPiece() {
  for (const [cx, cy] of current.cells) {
    const x = current.x + cx;
    const y = current.y + cy;
    if (y >= 0) grid[y][x] = current.type;
  }
  clearLines();
  const type = nextQueue.shift();
  nextQueue.push(nextFromBag());
  spawn(type);
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (grid[y].every((c) => c)) {
      grid.splice(y, 1);
      grid.unshift(Array(COLS).fill(null));
      cleared++;
      y++; // recheck the same row index
    }
  }
  if (cleared > 0) {
    const points = [0, 100, 300, 500, 800][cleared] * level;
    score += points;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(80, 1000 - (level - 1) * 80);
    updateStats();
  }
}

function move(dx, dy) {
  if (!running || paused) return false;
  if (!collides(current, grid, dx, dy)) {
    current.x += dx;
    current.y += dy;
    return true;
  }
  return false;
}

function rotate(dir) {
  if (!running || paused) return;
  const rotated = rotateCells(current.cells, current.type, dir);
  // Wall kicks: try a few horizontal/vertical nudges.
  const kicks = [0, -1, 1, -2, 2];
  for (const kx of kicks) {
    if (!collides(current, grid, kx, 0, rotated)) {
      current.cells = rotated;
      current.x += kx;
      return;
    }
    if (!collides(current, grid, kx, -1, rotated)) {
      current.cells = rotated;
      current.x += kx;
      current.y -= 1;
      return;
    }
  }
}

function softDrop() {
  if (move(0, 1)) {
    score += 1;
    updateStats();
    dropTimer = 0;
  }
}

function hardDrop() {
  if (!running || paused) return;
  let dist = 0;
  while (!collides(current, grid, 0, 1)) {
    current.y += 1;
    dist++;
  }
  score += dist * 2;
  updateStats();
  lockPiece();
  dropTimer = 0;
}

function hold() {
  if (!running || paused || !canHold) return;
  const cur = current.type;
  if (holdType === null) {
    holdType = cur;
    const type = nextQueue.shift();
    nextQueue.push(nextFromBag());
    spawn(type);
  } else {
    const swap = holdType;
    holdType = cur;
    spawn(swap);
  }
  canHold = false;
  drawHold();
}

// ---- Rendering ----
function resize() {
  const wrap = boardCanvas.parentElement;
  const availH = wrap.clientHeight || window.innerHeight * 0.6;
  // Fit by height primarily; cell is integer for crisp grid.
  const maxCellByH = Math.floor(availH / ROWS);
  const maxCellByW = Math.floor((window.innerWidth * 0.6) / COLS);
  cell = Math.max(12, Math.min(maxCellByH, maxCellByW, 40));
  boardCanvas.width = COLS * cell;
  boardCanvas.height = ROWS * cell;
  draw();
}

function drawCell(ctx, x, y, type, size, alpha = 1) {
  const color = COLORS[type];
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * size, y * size, size, size);
  // bevel
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x * size, y * size, size, size * 0.18);
  ctx.fillStyle = "#000000";
  ctx.fillRect(x * size, y * size + size * 0.82, size, size * 0.18);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
}

function draw() {
  bctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  // grid lines
  bctx.strokeStyle = "rgba(255,255,255,0.04)";
  bctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    bctx.beginPath();
    bctx.moveTo(x * cell + 0.5, 0);
    bctx.lineTo(x * cell + 0.5, ROWS * cell);
    bctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    bctx.beginPath();
    bctx.moveTo(0, y * cell + 0.5);
    bctx.lineTo(COLS * cell, y * cell + 0.5);
    bctx.stroke();
  }

  // settled blocks
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x]) drawCell(bctx, x, y, grid[y][x], cell);
    }
  }

  if (current) {
    // ghost piece
    let ghostY = 0;
    while (!collides(current, grid, 0, ghostY + 1)) ghostY++;
    for (const [cx, cy] of current.cells) {
      const gy = current.y + cy + ghostY;
      if (gy >= 0) drawCell(bctx, current.x + cx, gy, current.type, cell, 0.22);
    }
    // active piece
    for (const [cx, cy] of current.cells) {
      const y = current.y + cy;
      if (y >= 0) drawCell(bctx, current.x + cx, y, current.type, cell);
    }
  }
}

function drawMini(ctx, canvas, type, originY = 0) {
  const size = 22;
  if (!type) return;
  const cells = SHAPES[type];
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = (maxX - minX + 1) * size;
  const h = (maxY - minY + 1) * size;
  const offX = (canvas.width - w) / 2 / size - minX;
  const offY = originY + (96 - h) / 2 / size - minY;
  for (const [cx, cy] of cells) {
    drawCell(ctx, cx + offX, cy + offY, type, size);
  }
}

function drawNext() {
  nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  for (let i = 0; i < 3 && i < nextQueue.length; i++) {
    drawMini(nctx, nextCanvas, nextQueue[i], i * 96 / 22);
  }
}

function drawHold() {
  hctx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  drawMini(hctx, holdCanvas, holdType, 0);
}

function updateStats() {
  scoreEl.textContent = score;
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// ---- Game loop ----
function loop(time) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  if (paused) {
    lastTime = time;
    return;
  }
  const delta = time - lastTime;
  lastTime = time;
  dropTimer += delta;
  if (dropTimer >= dropInterval) {
    dropTimer = 0;
    if (!move(0, 1)) {
      lockPiece();
    }
  }
  draw();
  drawNext();
}

function startGame() {
  grid = emptyGrid();
  bag = [];
  nextQueue = [nextFromBag(), nextFromBag(), nextFromBag()];
  holdType = null;
  canHold = true;
  score = 0;
  lines = 0;
  level = 1;
  dropInterval = 1000;
  dropTimer = 0;
  lastTime = performance.now();
  running = true;
  paused = false;
  updateStats();
  drawHold();
  spawn(nextQueue.shift());
  nextQueue.push(nextFromBag());
  overlay.classList.add("hidden");
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function gameOver() {
  running = false;
  overlayTitle.textContent = "ゲームオーバー";
  overlayText.textContent = `スコア: ${score} / ライン: ${lines}`;
  startBtn.textContent = "もう一度";
  overlay.classList.remove("hidden");
}

// ---- Input: buttons ----
function handleAction(action) {
  switch (action) {
    case "left":
      move(-1, 0);
      break;
    case "right":
      move(1, 0);
      break;
    case "rotate":
      rotate(1);
      break;
    case "softdrop":
      softDrop();
      break;
    case "harddrop":
      hardDrop();
      break;
    case "hold":
      hold();
      break;
  }
  draw();
}

document.querySelectorAll(".ctrl").forEach((btn) => {
  const action = btn.dataset.action;
  // Use pointerdown for snappy response; prevent the synthetic click/zoom.
  btn.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      handleAction(action);
    },
    { passive: false }
  );
});

startBtn.addEventListener("click", startGame);

// ---- Input: keyboard (for desktop testing) ----
window.addEventListener("keydown", (e) => {
  if (!running) {
    if (e.key === "Enter" || e.key === " ") startGame();
    return;
  }
  switch (e.key) {
    case "ArrowLeft":
      handleAction("left");
      break;
    case "ArrowRight":
      handleAction("right");
      break;
    case "ArrowDown":
      handleAction("softdrop");
      break;
    case "ArrowUp":
    case "x":
      handleAction("rotate");
      break;
    case " ":
      e.preventDefault();
      handleAction("harddrop");
      break;
    case "Shift":
    case "c":
      handleAction("hold");
      break;
    case "p":
      paused = !paused;
      break;
  }
});

// ---- Input: swipe gestures on the board ----
let touchStart = null;
let lastMoveX = 0;
let lastMoveY = 0;
let moved = false;

boardCanvas.addEventListener(
  "pointerdown",
  (e) => {
    if (!running) {
      startGame();
      return;
    }
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    moved = false;
  },
  { passive: true }
);

boardCanvas.addEventListener(
  "pointermove",
  (e) => {
    if (!touchStart) return;
    const stepX = cell * 1.1;
    const stepY = cell * 1.1;
    // Horizontal incremental moves
    while (e.clientX - lastMoveX > stepX) {
      handleAction("right");
      lastMoveX += stepX;
      moved = true;
    }
    while (lastMoveX - e.clientX > stepX) {
      handleAction("left");
      lastMoveX -= stepX;
      moved = true;
    }
    // Downward incremental soft drop
    while (e.clientY - lastMoveY > stepY) {
      handleAction("softdrop");
      lastMoveY += stepY;
      moved = true;
    }
  },
  { passive: true }
);

boardCanvas.addEventListener(
  "pointerup",
  (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    const dt = performance.now() - touchStart.t;
    const dist = Math.hypot(dx, dy);
    if (!moved && dist < cell * 0.6 && dt < 250) {
      // tap -> rotate
      handleAction("rotate");
    } else if (!moved && dy > cell * 3 && dt < 220 && Math.abs(dx) < dy) {
      // fast swipe down -> hard drop
      handleAction("harddrop");
    } else if (dy < -cell * 2 && Math.abs(dx) < Math.abs(dy)) {
      // swipe up -> hold
      handleAction("hold");
    }
    touchStart = null;
  },
  { passive: true }
);

// Prevent double-tap zoom and pull-to-refresh interfering with play.
document.addEventListener(
  "touchmove",
  (e) => {
    if (running) e.preventDefault();
  },
  { passive: false }
);

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 200));

// Initial paint
grid = emptyGrid();
nextQueue = [];
holdType = null;
score = 0;
lines = 0;
level = 1;
resize();
updateStats();
overlay.classList.remove("hidden");
