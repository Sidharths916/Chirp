// ============================================================
//  CHIRP — Sprite Engine v2.0
//  Full-screen transparent desktop overlay
//  Canvas fills the screen, bird walks on top of everything
// ============================================================

const canvas = document.getElementById('pet-canvas');
const ctx    = canvas.getContext('2d');

// Fill the whole screen — window is already full-screen transparent
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Config ────────────────────────────────────────────────
const ANIMAL      = 'sparrow';
const SPRITE_SIZE = 150;       // render size in px on screen
const FPS_IDLE    = 6;
const FPS_FLAP    = 9;
const WALK_SPEED  = 1.2;
const FLY_SPEED   = 3.5;

// ── State ─────────────────────────────────────────────────
let sheets    = {};            // { front, back, left, right }
let direction = 'front';
let state     = 'idle';        // 'idle' | 'walk' | 'fly'
let frameIdx  = 0;
let frameAccum = 0;
let lastTimestamp = 0;
let loaded    = false;

// Position — start centre-bottom (like it's standing on the taskbar)
let birdX, birdY;
let targetX = null, targetY = null;

// ── SpriteSheet ───────────────────────────────────────────
class SpriteSheet {
  constructor(img, frames) {
    this.img  = img;
    const midY = img.naturalHeight / 2;
    this.idle = frames.filter(f => f.y + f.h / 2 < midY);
    this.flap = frames.filter(f => f.y + f.h / 2 >= midY);
    if (!this.flap.length) this.flap = this.idle;
  }

  draw(anim, idx, cx, cy, flipH = false) {
    const bank = anim === 'fly' ? this.flap : this.idle;
    if (!bank.length) return;
    const f  = bank[idx % bank.length];

    // Scale frame to SPRITE_SIZE on its longest side
    const scale = SPRITE_SIZE / Math.max(f.w, f.h);
    const dw = f.w * scale;
    const dh = f.h * scale;
    const dx = cx - dw / 2;
    const dy = cy - dh / 2;

    ctx.save();
    if (flipH) {
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    ctx.restore();
  }

  frameCount(anim) {
    return (anim === 'fly' ? this.flap : this.idle).length;
  }
}

// ── Frame detection ───────────────────────────────────────
function detectFrames(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const off  = new OffscreenCanvas(W, H);
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0);
  const data = octx.getImageData(0, 0, W, H).data;

  function isContent(px) {
    const i = px * 4;
    if (data[i+3] < 30) return false;
    if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) return false;
    return true;
  }

  const rowHas = new Uint8Array(H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (isContent(y * W + x)) { rowHas[y] = 1; break; }

  const frames = [];
  for (const [ry1, ry2] of findRuns(rowHas, H)) {
    const colInBand = new Uint8Array(W);
    for (let y = ry1; y < ry2; y++)
      for (let x = 0; x < W; x++)
        if (isContent(y * W + x)) colInBand[x] = 1;
    for (const [cx1, cx2] of findRuns(colInBand, W))
      frames.push({ x: cx1, y: ry1, w: cx2 - cx1, h: ry2 - ry1 });
  }
  return frames;
}

function findRuns(arr, len, minGap = 12) {
  const runs = [];
  let inRun = false, start = 0;
  for (let i = 0; i <= len; i++) {
    if (i < len && arr[i]) {
      if (!inRun) { inRun = true; start = i; }
    } else if (inRun) {
      inRun = false;
      if (runs.length && start - runs[runs.length-1][1] < minGap)
        runs[runs.length-1][1] = i;
      else
        runs.push([start, i]);
    }
  }
  return runs;
}

// ── Load animal ───────────────────────────────────────────
async function loadAnimal(name) {
  const dirs   = ['front', 'back', 'left', 'right'];
  const result = {};
  await Promise.all(dirs.map(dir => new Promise(resolve => {
    const img = new Image();
    img.src = `animals/${name}/${name} ${dir}.png`;
    img.onload = () => {
      result[dir] = new SpriteSheet(img, detectFrames(img));
      console.log(`[chirp] ${name}/${dir}: ${result[dir].idle.length} idle, ${result[dir].flap.length} flap`);
      resolve();
    };
    img.onerror = () => { console.warn(`[chirp] missing ${dir}`); resolve(); };
  })));
  for (const dir of dirs)
    if (!result[dir] && result['front']) result[dir] = result['front'];
  return result;
}

// ── Movement / AI ─────────────────────────────────────────
function chooseNewTarget() {
  const W = canvas.width, H = canvas.height;
  const pad = 80;
  if (state === 'fly') {
    targetX = pad + Math.random() * (W - pad*2);
    targetY = pad + Math.random() * (H * 0.7);  // fly in upper 70%
  } else {
    // Walk along bottom third of screen (like the desktop floor)
    targetX = pad + Math.random() * (W - pad*2);
    targetY = H * 0.75 + Math.random() * (H * 0.2);
  }
}

function updateMovement(dt) {
  if (targetX === null) chooseNewTarget();

  const dx   = targetX - birdX;
  const dy   = targetY - birdY;
  const dist = Math.hypot(dx, dy);

  if (dist < 4) {
    targetX = null;
    if (state === 'fly') {
      state = 'idle';
      frameIdx = 0;
    }
    return;
  }

  const speed = state === 'fly' ? FLY_SPEED : WALK_SPEED;
  const step  = Math.min(speed, dist);
  birdX += (dx / dist) * step;
  birdY += (dy / dist) * step;

  // Direction
  if (Math.abs(dx) >= Math.abs(dy)) {
    direction = dx > 0 ? 'right' : 'left';
  } else {
    direction = dy > 0 ? 'front' : 'back';
  }

  // State transitions
  if (state === 'idle' && dist > 30) {
    state = 'walk';
  }
  // Randomly take flight
  if (state === 'walk' && Math.random() < 0.002) {
    state = 'fly';
    chooseNewTarget();
  }
}

// ── Render loop ───────────────────────────────────────────
const frameDur = { idle: 1000/FPS_IDLE, walk: 1000/FPS_IDLE, fly: 1000/FPS_FLAP };

function tick(timestamp) {
  requestAnimationFrame(tick);
  if (!loaded) return;

  const dt = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  updateMovement(dt);

  // Advance animation frame
  frameAccum += dt;
  const dur = frameDur[state] || 150;
  if (frameAccum >= dur) {
    frameAccum -= dur;
    const anim  = state === 'fly' ? 'fly' : 'idle';
    const count = sheets[direction]?.frameCount(anim) || 1;
    frameIdx    = (frameIdx + 1) % count;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawDir = direction === 'left' ? 'right' : direction;
  const flipH   = direction === 'left';
  const anim    = state === 'fly' ? 'fly' : 'idle';
  sheets[drawDir]?.draw(anim, frameIdx, birdX, birdY, flipH);
}

// ── Boot ──────────────────────────────────────────────────
(async () => {
  sheets = await loadAnimal(ANIMAL);
  birdX  = canvas.width  / 2;
  birdY  = canvas.height * 0.82;   // start near bottom, like standing on desktop
  loaded = true;
  console.log('[chirp] ready — full screen overlay active');
  requestAnimationFrame(tick);
})();
