function createFollowerState(x, y) {
  return { x, y, vx: 0, vy: 0, speed: 0, phase: 0 };
}

function stepFollower(state, target, deltaSeconds, followSpeed = 4.5) {
  const dt = Math.max(0, Math.min(0.11, Number(deltaSeconds) || 0));
  if (dt === 0) return state;
  const response = Math.max(0.1, Math.min(12, Number(followSpeed) || 4.5));
  const blend = 1 - Math.exp(-response * dt);
  const x = state.x + (target.x - state.x) * blend;
  const y = state.y + (target.y - state.y) * blend;
  const vx = (x - state.x) / dt;
  const vy = (y - state.y) / dt;
  const speed = Math.hypot(vx, vy);
  const walking = Math.min(1, speed / 260);
  const phase = state.phase + (speed > 15 ? dt * (3 + Math.min(speed / 180, 7)) : 0);
  return { x, y, vx, vy, speed, phase: state.phase + (phase - state.phase) * walking };
}

// Stickman Follower: guide a single-file parade with mouse/touch and earn original
// cursor skins and stickman costumes by wandering. Edit mode still sets the start point.
const BASE_WIDTH = 720;
const BASE_HEIGHT = 1280;
let WIDTH = BASE_WIDTH;
let HEIGHT = BASE_HEIGHT;
let SCALE_X = 1;
let SCALE_Y = 1;
let ART_SCALE = 1;
const INK = '#29425a';
const ACCENT = '#ef8c5b';
const PAPER = '#f5f3ee';
const BASE_FOLLOWER_SPACING = 138;
let FOLLOWER_SPACING = BASE_FOLLOWER_SPACING;
const STYLE_PROGRESS_KEY = 'stickman-follower-style-progress-v1';
const STYLE_SETS = [
  { id: 'classic', name: 'Everyday', icon: '✦', unlockAt: 0, cursorDescription: 'A simple soft-glow pointer.', costumeDescription: 'The original stickman look.' },
  { id: 'cat', name: 'Whisker Buddy', icon: '🐱', unlockAt: 1200, cursorDescription: 'A round, rosy-cheeked kitty cursor.', costumeDescription: 'Cat ears, whiskers, and a swishy tail.' },
  { id: 'nova', name: 'Nova Wand', icon: '✨', unlockAt: 3000, cursorDescription: 'A bright little cosmic energy wand.', costumeDescription: 'A starlit traveler cape and badge.' },
  { id: 'pixel', name: 'Pixel Blade', icon: '⚔️', unlockAt: 6000, cursorDescription: 'A blocky retro sword pointer.', costumeDescription: 'Chunky pixel armor and a tiny helm.' },
  { id: 'duck', name: 'Sunny Duck', icon: '🦆', unlockAt: 10000, cursorDescription: 'A bouncy yellow duck cursor.', costumeDescription: 'A sunny duck hood and raincoat.' },
  { id: 'ghost', name: 'Little Boo', icon: '👻', unlockAt: 15000, cursorDescription: 'A friendly floaty ghost pointer.', costumeDescription: 'A soft ghostly sheet costume.' },
];
let activeCleanup = null;
let hasStarted = false;

function updateCanvasLogicalSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  WIDTH = Math.max(1, Math.round(canvas.clientWidth || rect.width || window.innerWidth || BASE_WIDTH));
  HEIGHT = Math.max(1, Math.round(canvas.clientHeight || rect.height || window.innerHeight || BASE_HEIGHT));
  SCALE_X = WIDTH / BASE_WIDTH;
  SCALE_Y = HEIGHT / BASE_HEIGHT;
  ART_SCALE = Math.max(0.25, Math.min(SCALE_X, SCALE_Y));
  FOLLOWER_SPACING = BASE_FOLLOWER_SPACING * ART_SCALE;
}

function readSettings() {
  const config = window.gameConfig || {};
  const follower = config.follower || {};
  return {
    x: Number.isFinite(follower.startX) ? follower.startX * SCALE_X : WIDTH / 2,
    y: Number.isFinite(follower.startY) ? follower.startY * SCALE_Y : HEIGHT * 0.56,
    speed: Number.isFinite(follower.followSpeed) ? follower.followSpeed : 4.5,
    scale: (Number.isFinite(follower.scale) ? follower.scale : 1) * ART_SCALE,
    count: Number.isFinite(follower.count) ? Math.max(1, Math.min(100, Math.round(follower.count))) : 5,
  };
}

function isStyleUnlocked(id, distance) {
  const style = STYLE_SETS.find((item) => item.id === id);
  return Boolean(style && distance >= style.unlockAt);
}

function getNewlyUnlockedStyles(previousDistance, currentDistance) {
  return STYLE_SETS.filter((style) => style.unlockAt > previousDistance && style.unlockAt <= currentDistance);
}

function normalizeStyleProgress(raw) {
  const distance = Math.max(0, Number(raw && raw.distance) || 0);
  return {
    distance,
    cursor: isStyleUnlocked(raw && raw.cursor, distance) ? raw.cursor : 'classic',
    costume: isStyleUnlocked(raw && raw.costume, distance) ? raw.costume : 'classic',
  };
}

function loadStyleProgress() {
  try {
    return normalizeStyleProgress(JSON.parse(window.localStorage.getItem(STYLE_PROGRESS_KEY) || '{}'));
  } catch (error) {
    return normalizeStyleProgress({});
  }
}

function saveStyleProgress(progress) {
  const saved = { distance: progress.distance, cursor: progress.cursor, costume: progress.costume };
  try {
    window.localStorage.setItem(STYLE_PROGRESS_KEY, JSON.stringify(saved));
  } catch (error) {
    // Storage can be unavailable in private or sandboxed previews; play remains unaffected.
  }
  const hostLib = window.lib;
  if (hostLib && typeof hostLib.saveUserGameState === 'function') {
    try {
      Promise.resolve(hostLib.saveUserGameState({ stickmanFollower: saved })).catch(() => {});
    } catch (error) {
      // Optional host persistence is deliberately non-blocking.
    }
  }
}

function loadHostedStyleProgress(progress, onLoaded) {
  const hostLib = window.lib;
  if (!hostLib || typeof hostLib.getUserGameState !== 'function') return;
  try {
    Promise.resolve(hostLib.getUserGameState()).then((result) => {
      const saved = result && result.state && result.state.stickmanFollower;
      if (!saved) return;
      const merged = normalizeStyleProgress({
        distance: Math.max(progress.distance, Number(saved.distance) || 0),
        cursor: saved.cursor || progress.cursor,
        costume: saved.costume || progress.costume,
      });
      Object.assign(progress, merged);
      onLoaded();
    }).catch(() => {});
  } catch (error) {
    // The standalone version uses local storage; the host bridge is optional.
  }
}

function createFollowerLine(point, count) {
  const safeCount = Math.max(1, Math.min(100, Math.round(count)));
  const span = (safeCount - 1) * FOLLOWER_SPACING;
  const trail = span > 0
    ? [{ x: point.x - span, y: point.y, distance: 0 }, { x: point.x, y: point.y, distance: span }]
    : [{ x: point.x, y: point.y, distance: 0 }];
  const figures = [];
  for (let i = 0; i < safeCount; i += 1) {
    const position = sampleFollowerTrail(trail, i * FOLLOWER_SPACING);
    figures.push(createFollowerState(position.x, position.y));
  }
  return { trail, figures };
}

function sampleFollowerTrail(trail, distanceBehind) {
  const lastIndex = trail.length - 1;
  const end = trail[lastIndex];
  const wanted = end.distance - Math.max(0, distanceBehind);
  if (wanted <= trail[0].distance || lastIndex === 0) return { x: trail[0].x, y: trail[0].y };
  if (wanted >= end.distance) return { x: end.x, y: end.y };

  let low = 0;
  let high = lastIndex;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (trail[middle].distance < wanted) low = middle;
    else high = middle;
  }
  const from = trail[low];
  const to = trail[high];
  const segmentLength = to.distance - from.distance;
  const ratio = segmentLength > 0 ? (wanted - from.distance) / segmentLength : 0;
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

function appendFollowerTrailPoint(trail, point, keepDistance) {
  const last = trail[trail.length - 1];
  const segmentLength = Math.hypot(point.x - last.x, point.y - last.y);
  if (segmentLength < 5) return;
  const next = { x: point.x, y: point.y, distance: last.distance + segmentLength };
  trail.push(next);
  const oldestNeeded = next.distance - keepDistance;
  while (trail.length > 2 && trail[1].distance < oldestNeeded) trail.shift();
}

function drawSegment(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawCostumeBack(ctx, costume) {
  ctx.save();
  if (costume === 'cat') {
    ctx.strokeStyle = '#c88375';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(8, -4);
    ctx.bezierCurveTo(30, -7, 34, -29, 23, -34);
    ctx.stroke();
  } else if (costume === 'nova') {
    ctx.fillStyle = '#745cc2';
    ctx.strokeStyle = '#4d4186';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-15, -53); ctx.lineTo(-25, -8); ctx.lineTo(0, -15);
    ctx.lineTo(25, -8); ctx.lineTo(15, -53); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (costume === 'pixel') {
    ctx.fillStyle = '#53a7b4';
    ctx.fillRect(-16, -49, 32, 38);
    ctx.fillStyle = '#f2ca66';
    ctx.fillRect(-16, -49, 32, 7);
    ctx.fillStyle = '#348091';
    ctx.fillRect(-22, -43, 7, 18); ctx.fillRect(15, -43, 7, 18);
  } else if (costume === 'duck') {
    ctx.fillStyle = '#ffd34f';
    ctx.strokeStyle = '#d59a3c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -25, 24, 34, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffed9a';
    ctx.beginPath(); ctx.ellipse(-18, -28, 9, 15, -0.35, 0, Math.PI * 2); ctx.fill();
  } else if (costume === 'ghost') {
    ctx.fillStyle = 'rgba(226, 246, 250, 0.9)';
    ctx.strokeStyle = '#a6cbd7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-22, -104); ctx.quadraticCurveTo(-34, -93, -27, -68);
    ctx.lineTo(-23, -14); ctx.quadraticCurveTo(-13, -5, -4, -15);
    ctx.quadraticCurveTo(4, -4, 13, -14); ctx.quadraticCurveTo(23, -4, 27, -17);
    ctx.lineTo(23, -70); ctx.quadraticCurveTo(33, -96, 17, -105); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawCostumeDetails(ctx, costume) {
  ctx.save();
  if (costume === 'cat') {
    ctx.fillStyle = '#8d98a4';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-20, -101); ctx.lineTo(-17, -121); ctx.lineTo(-2, -105); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -105); ctx.lineTo(18, -121); ctx.lineTo(21, -100); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eaa5a2';
    ctx.beginPath(); ctx.moveTo(-16, -106); ctx.lineTo(-16, -115); ctx.lineTo(-8, -106); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -106); ctx.lineTo(16, -115); ctx.lineTo(16, -106); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(-8, -87, 2.5, 0, Math.PI * 2); ctx.arc(8, -87, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 2;
    drawSegment(ctx, -13, -80, -27, -84); drawSegment(ctx, -13, -77, -27, -76);
    drawSegment(ctx, 13, -80, 27, -84); drawSegment(ctx, 13, -77, 27, -76);
  } else if (costume === 'nova') {
    ctx.fillStyle = '#f6d779';
    ctx.beginPath(); ctx.moveTo(0, -47); ctx.lineTo(6, -40); ctx.lineTo(0, -33); ctx.lineTo(-6, -40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b7a5f0'; ctx.lineWidth = 3;
    drawSegment(ctx, -17, -48, -23, -39); drawSegment(ctx, 17, -48, 23, -39);
  } else if (costume === 'pixel') {
    ctx.fillStyle = '#e8bf63'; ctx.fillRect(-18, -111, 36, 9);
    ctx.fillStyle = '#4e687c'; ctx.fillRect(-21, -102, 42, 8);
    ctx.fillStyle = '#b6e1e7'; ctx.fillRect(-11, -98, 8, 4); ctx.fillRect(3, -98, 8, 4);
    ctx.fillStyle = '#f4d584'; ctx.fillRect(-4, -36, 8, 8);
  } else if (costume === 'duck') {
    ctx.fillStyle = '#ffd34f'; ctx.strokeStyle = '#d59a3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -87, 25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f08b32'; ctx.beginPath(); ctx.moveTo(15, -83); ctx.lineTo(36, -78); ctx.lineTo(15, -72); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(8, -91, 2.5, 0, Math.PI * 2); ctx.fill();
  } else if (costume === 'ghost') {
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(-8, -88, 3.3, 5, 0, 0, Math.PI * 2); ctx.ellipse(8, -88, 3.3, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a6cbd7'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -79, 4, 0, Math.PI); ctx.stroke();
  }
  ctx.restore();
}

function drawStickman(ctx, state, scale, costume = 'classic') {
  const motion = Math.min(1, state.speed / 260);
  const stride = Math.sin(state.phase) * 17 * motion;
  const armSwing = Math.sin(state.phase + Math.PI) * 13 * motion;
  const lean = Math.max(-0.12, Math.min(0.12, state.vx * 0.00016));

  ctx.save();
  ctx.translate(state.x, state.y);
  ctx.rotate(lean);
  ctx.scale(scale, scale);
  drawCostumeBack(ctx, costume);
  ctx.strokeStyle = INK;
  ctx.fillStyle = PAPER;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawSegment(ctx, 0, 1, -12 - stride * 0.2, 32);
  drawSegment(ctx, -12 - stride * 0.2, 32, -9 - stride, 62);
  drawSegment(ctx, -9 - stride, 62, -21 - stride, 63);
  drawSegment(ctx, 0, 1, 12 + stride * 0.2, 32);
  drawSegment(ctx, 12 + stride * 0.2, 32, 9 + stride, 62);
  drawSegment(ctx, 9 + stride, 62, 21 + stride, 63);
  drawSegment(ctx, 0, -59, 0, 2);
  drawSegment(ctx, 0, -53, -25 + armSwing * 0.35, -34);
  drawSegment(ctx, -25 + armSwing * 0.35, -34, -31 + armSwing, -12);
  drawSegment(ctx, 0, -53, 25 - armSwing * 0.35, -34);
  drawSegment(ctx, 25 - armSwing * 0.35, -34, 31 - armSwing, -12);

  ctx.beginPath();
  ctx.arc(0, -87, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawCostumeDetails(ctx, costume);
  ctx.restore();
}

function drawTarget(ctx, target, time) {
  if (!target.active) return;
  const pulse = 2.5 + Math.sin(time * 0.004) * 2.5;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 3 * ART_SCALE;
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  ctx.arc(target.x, target.y, (15 + pulse) * ART_SCALE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(target.x, target.y, 4 * ART_SCALE, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCursor(ctx, target, time, styleId, clickProgress = 0) {
  if (!target.active) return;
  const beat = Math.sin(time * 0.004) * 0.08;
  const clickPop = clickProgress > 0 ? Math.sin(Math.PI * (1 - clickProgress)) * 0.22 : 0;
  const idleBob = styleId === 'duck' ? Math.sin(time * 0.009) * 4 : styleId === 'ghost' ? Math.sin(time * 0.003) * 5 : styleId === 'cat' ? Math.sin(time * 0.006) * 2 : Math.sin(time * 0.004) * 1.5;
  const clickSpin = clickProgress > 0 ? (1 - clickProgress) * Math.PI * 2 : 0;
  ctx.save();
  ctx.translate(target.x, target.y + idleBob * ART_SCALE);
  ctx.scale(ART_SCALE, ART_SCALE);
  if (styleId === 'ghost') ctx.rotate(clickSpin || Math.sin(time * 0.002) * 0.08);
  else if (styleId === 'duck') ctx.rotate(Math.sin(time * 0.007) * 0.1 + clickPop * 0.25);
  else if (styleId === 'cat') ctx.rotate(Math.sin(time * 0.0025) * 0.045 - clickPop * 0.12);
  ctx.scale(1 + beat + clickPop, 1 + beat + clickPop);
  if (styleId === 'classic') {
    ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(0, 0, 17 + Math.sin(time * 0.008) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  } else if (styleId === 'cat') {
    ctx.shadowColor = 'rgba(41, 66, 90, 0.2)'; ctx.shadowBlur = 9;
    ctx.fillStyle = '#dfe4e8'; ctx.strokeStyle = '#788692'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-25, -10); ctx.lineTo(-23, -29); ctx.lineTo(-8, -20);
    ctx.quadraticCurveTo(0, -24, 8, -20); ctx.lineTo(23, -29); ctx.lineTo(25, -10);
    ctx.quadraticCurveTo(30, 2, 20, 15); ctx.quadraticCurveTo(0, 27, -20, 15); ctx.quadraticCurveTo(-30, 2, -25, -10); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#111f2e';
    ctx.beginPath(); ctx.arc(-9, 0, 2.7, 0, Math.PI * 2); ctx.arc(9, 0, 2.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ef9d9a'; ctx.beginPath(); ctx.arc(-15, 8, 4, 0, Math.PI * 2); ctx.arc(15, 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d77b79'; ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(3, 6); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#788692'; ctx.lineWidth = 1.3;
    drawSegment(ctx, -15, 6, -28, 2); drawSegment(ctx, -15, 10, -28, 12);
    drawSegment(ctx, 15, 6, 28, 2); drawSegment(ctx, 15, 10, 28, 12);
  } else if (styleId === 'nova') {
    const slashT = 1 - clickProgress;
    const slashPulse = clickProgress > 0 ? Math.sin(Math.PI * slashT) : 0;
    const idleAngle = -0.5 + Math.sin(time * 0.003) * 0.045;
    const wandAngle = clickProgress > 0 ? -0.5 + slashPulse * 1.55 : idleAngle;
    ctx.save();
    ctx.rotate(wandAngle);
    ctx.shadowColor = '#65e5ff'; ctx.shadowBlur = 13 + (Math.sin(time * 0.012) + 1) * 5 + clickPop * 35 + slashPulse * 22;
    ctx.strokeStyle = '#6feaff'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    drawSegment(ctx, 0, 17, 0, -23);
    ctx.shadowBlur = 0; ctx.strokeStyle = '#f4ffff'; ctx.lineWidth = 4;
    drawSegment(ctx, 0, 12, 0, -18);
    ctx.strokeStyle = '#62748b'; ctx.lineWidth = 5;
    drawSegment(ctx, -8, 16, 8, 16); drawSegment(ctx, 0, 18, 0, 31);
    ctx.shadowBlur = 0; ctx.fillStyle = '#d7fbff';
    for (let spark = 0; spark < 3; spark += 1) {
      const angle = time * 0.003 + spark * (Math.PI * 2 / 3);
      ctx.beginPath(); ctx.arc(Math.cos(angle) * 25, Math.sin(angle) * 25 - 3, 2, 0, Math.PI * 2); ctx.fill();
    }
    if (slashPulse > 0.01) {
      ctx.save();
      ctx.rotate(-0.7 + slashT * 1.4);
      ctx.globalAlpha = slashPulse * 0.88;
      ctx.strokeStyle = '#81efff'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.shadowColor = '#51dffb'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(0, 0, 38, -1.35, 0.72); ctx.stroke();
      ctx.strokeStyle = '#f0ffff'; ctx.lineWidth = 2.5; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(0, 0, 43, -1.22, 0.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-28, 25); ctx.lineTo(29, -25); ctx.stroke();
      ctx.fillStyle = '#d9fbff'; ctx.strokeStyle = '#d9fbff';
      ctx.fillRect(25, -34, 4, 4); ctx.fillRect(-30, -12, 3, 3);
      ctx.restore();
    }
    ctx.restore();
  } else if (styleId === 'pixel') {
    ctx.save(); ctx.rotate(-0.58 + (clickProgress > 0 ? Math.sin((1 - clickProgress) * Math.PI) * 0.55 : Math.sin(time * 0.003) * 0.035));
    ctx.fillStyle = '#9eeaff'; ctx.fillRect(-6, -30, 12, 33);
    ctx.fillRect(-4, -37, 8, 7); ctx.fillRect(-2, -42, 4, 5);
    ctx.fillStyle = '#f5ffff'; ctx.fillRect(-2, -27, 3, 25);
    ctx.fillStyle = '#f0c65f'; ctx.fillRect(-12, 3, 24, 6);
    ctx.fillStyle = '#76523b'; ctx.fillRect(-4, 9, 8, 17); ctx.fillRect(-7, 23, 14, 5);
    if (clickProgress > 0) {
      ctx.globalAlpha = clickProgress * 0.9; ctx.strokeStyle = '#9eeaff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-23, -27); ctx.lineTo(22, 17); ctx.stroke();
    }
    ctx.restore();
  } else if (styleId === 'duck') {
    ctx.fillStyle = '#ffd34f'; ctx.strokeStyle = '#d59a3c'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(-2, 2, 22, 17, -0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, -10, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f08b32'; ctx.beginPath(); ctx.moveTo(18, -11); ctx.lineTo(34, -6); ctx.lineTo(18, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(11, -14, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff3ba'; ctx.beginPath(); ctx.ellipse(-10, -1, 8, 5, -0.4, 0, Math.PI * 2); ctx.fill();
  } else if (styleId === 'ghost') {
    ctx.save();
    ctx.globalAlpha = 0.88 + (Math.sin(time * 0.005) + 1) * 0.06;
    ctx.shadowColor = 'rgba(102, 174, 199, 0.55)'; ctx.shadowBlur = 13 + clickPop * 20;
    ctx.fillStyle = 'rgba(246, 253, 255, 0.96)'; ctx.strokeStyle = '#a6cbd7'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-20, 19); ctx.lineTo(-22, -8); ctx.quadraticCurveTo(-24, -25, 0, -28);
    ctx.quadraticCurveTo(24, -26, 22, -7); ctx.lineTo(20, 18); ctx.quadraticCurveTo(13, 10, 7, 19);
    ctx.quadraticCurveTo(0, 10, -7, 19); ctx.quadraticCurveTo(-14, 10, -20, 19); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(-8, -5, 2.6, 4, 0, 0, Math.PI * 2); ctx.ellipse(8, -5, 2.6, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (clickProgress > 0) {
    const burstColors = { classic: ACCENT, cat: '#f0a4a4', nova: '#7aeaff', pixel: '#a5f0ff', duck: '#ffd34f', ghost: '#b8e4ef' };
    ctx.globalAlpha = clickProgress * 0.55;
    ctx.strokeStyle = burstColors[styleId] || ACCENT;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 27 + (1 - clickProgress) * 24, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function createSoundEngine() {
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return null;
  try { return new AudioEngine(); } catch (error) { return null; }
}

function playTone(audioContext, type, startFrequency, endFrequency, duration, volume, delay = 0) {
  if (!audioContext) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
}

function playCursorSound(audioContext, styleId) {
  if (!audioContext) return;
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  if (styleId === 'cat') {
    playTone(audioContext, 'sine', 480, 790, 0.12, 0.027);
    playTone(audioContext, 'sine', 980, 630, 0.1, 0.015, 0.055);
  } else if (styleId === 'nova') {
    playTone(audioContext, 'triangle', 170, 900, 0.16, 0.022);
    playTone(audioContext, 'sine', 1240, 740, 0.11, 0.012, 0.025);
  } else if (styleId === 'pixel') {
    playTone(audioContext, 'square', 980, 320, 0.095, 0.016);
    playTone(audioContext, 'square', 1450, 520, 0.07, 0.01, 0.025);
  } else if (styleId === 'duck') {
    playTone(audioContext, 'triangle', 760, 490, 0.11, 0.027);
    playTone(audioContext, 'triangle', 920, 590, 0.1, 0.022, 0.105);
  } else if (styleId === 'ghost') {
    playTone(audioContext, 'sine', 230, 145, 0.23, 0.021);
    playTone(audioContext, 'triangle', 420, 270, 0.19, 0.012, 0.025);
  } else {
    playTone(audioContext, 'triangle', 520, 760, 0.075, 0.02);
  }
}

function drawFrame(ctx, state, target, settings, editMode, dragging, time) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#617384';
  ctx.font = `600 ${18 * ART_SCALE}px system-ui, sans-serif`;
  ctx.fillText(editMode ? 'DRAG THE STICKMAN TO SET ITS START' : 'MOVE ANYWHERE TO LEAD', WIDTH / 2, HEIGHT * 0.103);
  ctx.restore();

  if (editMode) {
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = (dragging ? 4 : 2) * ART_SCALE;
    ctx.globalAlpha = dragging ? 0.9 : 0.45;
    ctx.beginPath();
    ctx.arc(state.x, state.y - 27 * settings.scale, 68 * settings.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    drawTarget(ctx, target, time);
  }
  drawStickman(ctx, state, settings.scale);
}

function drawPlayFrame(ctx, followers, target, settings, time, cursorStyle, cursorClickProgress, costume) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#617384';
  ctx.font = `600 ${18 * ART_SCALE}px system-ui, sans-serif`;
  ctx.fillText('MOVE ANYWHERE TO LEAD', WIDTH / 2, HEIGHT * 0.103);
  ctx.restore();

  for (let i = followers.length - 1; i >= 0; i -= 1) {
    const figure = followers[i];
    const cullMargin = 150 * ART_SCALE;
    if (figure.x < -cullMargin || figure.x > WIDTH + cullMargin || figure.y < -cullMargin || figure.y > HEIGHT + cullMargin) continue;
    drawStickman(ctx, figure, settings.scale, costume);
  }
  drawCursor(ctx, target, time, cursorStyle, cursorClickProgress);
}

function drawIntroFrame(ctx, state, settings, time) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const compact = HEIGHT < 900;
  const kickerY = HEIGHT * (compact ? 0.10 : 0.148);
  const titleY = HEIGHT * (compact ? 0.18 : 0.223);
  const subtitleY = HEIGHT * (compact ? 0.24 : 0.277);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ACCENT;
  ctx.font = `700 ${18 * ART_SCALE}px system-ui, sans-serif`;
  ctx.fillText('A CALM LITTLE TOY', WIDTH / 2, kickerY);
  ctx.fillStyle = INK;
  ctx.font = `700 ${58 * ART_SCALE}px system-ui, sans-serif`;
  ctx.fillText('Stickman Follower', WIDTH / 2, titleY);
  ctx.fillStyle = '#617384';
  ctx.font = `400 ${25 * ART_SCALE}px system-ui, sans-serif`;
  ctx.fillText('A little companion who follows your lead.', WIDTH / 2, subtitleY);
  ctx.font = `500 ${18 * ART_SCALE}px system-ui, sans-serif`;
  ctx.fillText('No goals. Just move and enjoy.', WIDTH / 2, HEIGHT * 0.81);
  ctx.restore();

  const idleState = { ...state, y: state.y + Math.sin(time * 0.002) * 3 * ART_SCALE, speed: 0, phase: 0 };
  drawTarget(ctx, { x: Math.min(WIDTH - 42 * ART_SCALE, state.x + 92 * ART_SCALE), y: state.y - 92 * ART_SCALE, active: true }, time);
  drawStickman(ctx, idleState, settings.scale);
}

function run(mode = 'play') {
  hasStarted = true;
  if (activeCleanup) activeCleanup();
  const editMode = mode === 'edit';
  let screen = editMode ? 'edit' : 'intro';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', editMode ? 'Stickman Follower editor canvas' : 'Stickman Follower game canvas');
  canvas.setAttribute('tabindex', '0');
  canvas.className = 'game-canvas';
  document.body.replaceChildren(canvas);
  updateCanvasLogicalSize(canvas);

  let settings = readSettings();
  let state = createFollowerState(settings.x, settings.y);
  let followerCount = settings.count;
  let line = createFollowerLine({ x: state.x, y: state.y }, followerCount);
  let trail = line.trail;
  let followers = line.figures;
  const target = { x: state.x, y: state.y, active: false };
  const progress = loadStyleProgress();
  let startButton = null;
  let introEffects = null;
  let countControl = null;
  let countSlider = null;
  let countOutput = null;
  let closetButton = null;
  let closetBadge = null;
  let wardrobeBackdrop = null;
  let wardrobeProgressText = null;
  let wardrobeProgressFill = null;
  let wardrobeOptions = null;
  let wardrobeCursorTab = null;
  let wardrobeCostumeTab = null;
  let unlockToast = null;
  let activeWardrobeTab = 'cursor';
  let wardrobeOpen = false;
  let audioContext = null;
  let soundEnabled = true;
  let lastSoundAt = -Infinity;
  let soundToggleButton = null;
  let soundToggleHandler = null;
  let cursorClickUntil = 0;
  let lastInputPoint = null;
  let saveTimer = 0;
  let toastTimer = 0;
  let startGame = null;
  let updateFollowerCount = null;
  let wardrobeKeyDownHandler = null;
  let wardrobeBackdropClickHandler = null;
  let pageHideHandler = null;
  let updateProgressSummary = () => {};
  let renderWardrobe = () => {};
  let showUnlock = () => {};
  const resumeSound = () => {
    if (!soundEnabled) return;
    if (!audioContext) audioContext = createSoundEngine();
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  };

  if (!editMode) {
    introEffects = document.createElement('div');
    introEffects.id = 'intro-atmosphere';
    introEffects.setAttribute('aria-hidden', 'true');
    ['intro-orb--coral', 'intro-orb--blue', 'intro-orb--gold', 'intro-orb--mint'].forEach((className) => {
      const orb = document.createElement('span');
      orb.className = `intro-orb ${className}`;
      introEffects.appendChild(orb);
    });

    countControl = document.createElement('div');
    countControl.id = 'intro-count-control';
    const countLabel = document.createElement('label');
    countLabel.id = 'intro-count-label';
    countLabel.htmlFor = 'intro-count-slider';
    countLabel.textContent = 'STICK FIGURES IN ONE LINE';
    countOutput = document.createElement('output');
    countOutput.id = 'intro-count-value';
    countOutput.setAttribute('aria-live', 'polite');
    countOutput.textContent = `${followerCount} / 100`;
    countSlider = document.createElement('input');
    countSlider.id = 'intro-count-slider';
    countSlider.type = 'range';
    countSlider.min = '1';
    countSlider.max = '100';
    countSlider.step = '1';
    countSlider.value = String(followerCount);
    countSlider.setAttribute('aria-label', 'Number of stick figures following in one line');
    updateFollowerCount = () => {
      followerCount = Math.max(1, Math.min(100, Number(countSlider.value) || 1));
      countOutput.textContent = `${followerCount} / 100`;
      line = createFollowerLine({ x: settings.x, y: settings.y }, followerCount);
      trail = line.trail;
      followers = line.figures;
      state = followers[0];
    };
    countSlider.addEventListener('input', updateFollowerCount);
    countControl.append(countLabel, countOutput, countSlider);

    startButton = document.createElement('button');
    startButton.id = 'intro-start';
    startButton.type = 'button';
    startButton.textContent = 'START FOLLOWING';
    startButton.setAttribute('aria-label', 'Start Stickman Follower');
    startGame = () => {
      if (screen !== 'intro') return;
      screen = 'play';
      resumeSound();
      target.x = settings.x;
      target.y = settings.y;
      lastInputPoint = null;
      canvas.classList.add('game-active');
      closetButton.classList.remove('wardrobe-trigger--intro');
      closetButton.classList.add('wardrobe-trigger--play');
      startButton.remove();
      countControl.remove();
      introEffects.remove();
      canvas.focus();
    };
    startButton.addEventListener('click', startGame);

    closetButton = document.createElement('button');
    closetButton.id = 'wardrobe-trigger';
    closetButton.className = 'wardrobe-trigger wardrobe-trigger--intro';
    closetButton.type = 'button';
    closetButton.setAttribute('aria-label', 'Open style closet');
    const closetIcon = document.createElement('span');
    closetIcon.className = 'wardrobe-trigger__icon';
    closetIcon.textContent = '✦';
    const closetText = document.createElement('span');
    closetText.className = 'wardrobe-trigger__text';
    closetText.textContent = 'STYLE CLOSET';
    closetBadge = document.createElement('span');
    closetBadge.className = 'wardrobe-trigger__badge';
    closetButton.append(closetIcon, closetText, closetBadge);

    wardrobeBackdrop = document.createElement('div');
    wardrobeBackdrop.id = 'wardrobe-backdrop';
    wardrobeBackdrop.hidden = true;
    wardrobeBackdrop.setAttribute('aria-hidden', 'true');
    const wardrobePanel = document.createElement('section');
    wardrobePanel.id = 'wardrobe-panel';
    wardrobePanel.className = 'wardrobe-panel';
    wardrobePanel.setAttribute('role', 'dialog');
    wardrobePanel.setAttribute('aria-modal', 'true');
    wardrobePanel.setAttribute('aria-label', 'Cursor and costume wardrobe');
    const wardrobeHeader = document.createElement('header');
    wardrobeHeader.className = 'wardrobe-header';
    const wardrobeTitle = document.createElement('div');
    wardrobeTitle.className = 'wardrobe-title';
    wardrobeTitle.innerHTML = '<span class="wardrobe-kicker">YOUR UNLOCKS</span><h2>Style Closet</h2>';
    soundToggleButton = document.createElement('button');
    soundToggleButton.className = 'wardrobe-sound-toggle';
    soundToggleButton.type = 'button';
    soundToggleButton.textContent = '♫ SFX ON';
    soundToggleButton.setAttribute('aria-label', 'Turn cursor sound effects off');
    soundToggleButton.setAttribute('aria-pressed', 'true');
    soundToggleHandler = () => {
      soundEnabled = !soundEnabled;
      soundToggleButton.textContent = soundEnabled ? '♫ SFX ON' : '♫ SFX OFF';
      soundToggleButton.setAttribute('aria-label', soundEnabled ? 'Turn cursor sound effects off' : 'Turn cursor sound effects on');
      soundToggleButton.setAttribute('aria-pressed', String(soundEnabled));
      if (soundEnabled) resumeSound();
    };
    soundToggleButton.addEventListener('click', soundToggleHandler);
    const wardrobeClose = document.createElement('button');
    wardrobeClose.className = 'wardrobe-close';
    wardrobeClose.type = 'button';
    wardrobeClose.textContent = '×';
    wardrobeClose.setAttribute('aria-label', 'Close style closet');
    wardrobeHeader.append(wardrobeTitle, soundToggleButton, wardrobeClose);

    const wardrobeProgress = document.createElement('div');
    wardrobeProgress.className = 'wardrobe-progress';
    wardrobeProgressText = document.createElement('p');
    wardrobeProgressText.className = 'wardrobe-progress__text';
    const meterTrack = document.createElement('div');
    meterTrack.className = 'wardrobe-progress__track';
    wardrobeProgressFill = document.createElement('div');
    wardrobeProgressFill.className = 'wardrobe-progress__fill';
    meterTrack.appendChild(wardrobeProgressFill);
    wardrobeProgress.append(wardrobeProgressText, meterTrack);

    const wardrobeTabs = document.createElement('div');
    wardrobeTabs.className = 'wardrobe-tabs';
    wardrobeCursorTab = document.createElement('button');
    wardrobeCursorTab.type = 'button';
    wardrobeCursorTab.className = 'wardrobe-tab';
    wardrobeCursorTab.textContent = 'Cursor skins';
    wardrobeCostumeTab = document.createElement('button');
    wardrobeCostumeTab.type = 'button';
    wardrobeCostumeTab.className = 'wardrobe-tab';
    wardrobeCostumeTab.textContent = 'Stickman costumes';
    wardrobeTabs.append(wardrobeCursorTab, wardrobeCostumeTab);
    wardrobeOptions = document.createElement('div');
    wardrobeOptions.className = 'wardrobe-options';
    wardrobePanel.append(wardrobeHeader, wardrobeProgress, wardrobeTabs, wardrobeOptions);
    wardrobeBackdrop.appendChild(wardrobePanel);

    unlockToast = document.createElement('div');
    unlockToast.id = 'style-unlock-toast';
    unlockToast.setAttribute('role', 'status');
    unlockToast.setAttribute('aria-live', 'polite');

    updateProgressSummary = () => {
      const unlocked = STYLE_SETS.filter((style) => progress.distance >= style.unlockAt).length;
      closetBadge.textContent = `${unlocked}/${STYLE_SETS.length}`;
      closetButton.setAttribute('aria-label', `Open style closet, ${unlocked} of ${STYLE_SETS.length} styles unlocked`);
      const next = STYLE_SETS.find((style) => style.unlockAt > progress.distance);
      if (!next) {
        wardrobeProgressText.textContent = `All styles unlocked · ${Math.floor(progress.distance).toLocaleString()} px wandered`;
        wardrobeProgressFill.style.width = '100%';
      } else {
        const previous = STYLE_SETS.filter((style) => style.unlockAt <= progress.distance).pop();
        const baseDistance = previous ? previous.unlockAt : 0;
        const span = next.unlockAt - baseDistance;
        const percent = span > 0 ? Math.max(0, Math.min(100, ((progress.distance - baseDistance) / span) * 100)) : 0;
        wardrobeProgressText.textContent = `${Math.floor(progress.distance).toLocaleString()} px wandered · next: ${next.name} at ${next.unlockAt.toLocaleString()} px`;
        wardrobeProgressFill.style.width = `${percent}%`;
      }
    };
    renderWardrobe = () => {
      updateProgressSummary();
      wardrobeCursorTab.classList.toggle('is-active', activeWardrobeTab === 'cursor');
      wardrobeCostumeTab.classList.toggle('is-active', activeWardrobeTab === 'costume');
      wardrobeOptions.replaceChildren();
      const property = activeWardrobeTab === 'cursor' ? 'cursor' : 'costume';
      const descriptionProperty = activeWardrobeTab === 'cursor' ? 'cursorDescription' : 'costumeDescription';
      STYLE_SETS.forEach((style) => {
        const unlocked = progress.distance >= style.unlockAt;
        const selected = progress[property] === style.id;
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `wardrobe-option${selected ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}`;
        option.disabled = !unlocked;
        option.setAttribute('aria-pressed', String(selected));
        const icon = document.createElement('span');
        icon.className = 'wardrobe-option__icon';
        icon.textContent = style.icon;
        const copy = document.createElement('span');
        copy.className = 'wardrobe-option__copy';
        const name = document.createElement('strong');
        name.textContent = style.name;
        const description = document.createElement('small');
        description.textContent = style[descriptionProperty];
        copy.append(name, description);
        const status = document.createElement('span');
        status.className = 'wardrobe-option__status';
        status.textContent = !unlocked ? `${style.unlockAt.toLocaleString()} px to unlock` : (selected ? 'EQUIPPED' : 'SELECT');
        option.append(icon, copy, status);
        if (unlocked) {
          option.addEventListener('click', () => {
            progress[property] = style.id;
            saveStyleProgress(progress);
            renderWardrobe();
          });
        }
        wardrobeOptions.appendChild(option);
      });
    };
    const closeWardrobe = () => {
      wardrobeOpen = false;
      lastInputPoint = null;
      wardrobeBackdrop.hidden = true;
      wardrobeBackdrop.setAttribute('aria-hidden', 'true');
      closetButton.focus();
    };
    const openWardrobe = () => {
      wardrobeOpen = true;
      lastInputPoint = null;
      renderWardrobe();
      wardrobeBackdrop.hidden = false;
      wardrobeBackdrop.setAttribute('aria-hidden', 'false');
      wardrobeClose.focus();
    };
    wardrobeBackdropClickHandler = (event) => {
      if (event.target === wardrobeBackdrop) closeWardrobe();
    };
    wardrobeKeyDownHandler = (event) => {
      if (event.key === 'Escape' && wardrobeOpen) closeWardrobe();
    };
    closetButton.addEventListener('click', openWardrobe);
    wardrobeClose.addEventListener('click', closeWardrobe);
    wardrobeBackdrop.addEventListener('click', wardrobeBackdropClickHandler);
    wardrobeCursorTab.addEventListener('click', () => { activeWardrobeTab = 'cursor'; renderWardrobe(); });
    wardrobeCostumeTab.addEventListener('click', () => { activeWardrobeTab = 'costume'; renderWardrobe(); });
    document.addEventListener('keydown', wardrobeKeyDownHandler);
    updateProgressSummary();

    showUnlock = (styles) => {
      unlockToast.textContent = styles.length === 1
        ? `${styles[0].icon}  New style unlocked: ${styles[0].name}!`
        : `✨  ${styles.length} new styles unlocked! Open the Style Closet.`;
      unlockToast.classList.add('is-visible');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => unlockToast.classList.remove('is-visible'), 3200);
    };

    document.body.replaceChildren(canvas, introEffects, countControl, startButton, closetButton, wardrobeBackdrop, unlockToast);
  } else {
    document.body.replaceChildren(canvas);
  }

  const scheduleProgressSave = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveStyleProgress(progress), 1400);
  };
  const recordPlayerMovement = (point) => {
    if (!lastInputPoint) {
      lastInputPoint = { x: point.x, y: point.y };
      return;
    }
    const travelled = Math.hypot(point.x - lastInputPoint.x, point.y - lastInputPoint.y);
    lastInputPoint = { x: point.x, y: point.y };
    if (travelled < 0.1) return;
    const previousDistance = progress.distance;
    progress.distance += travelled;
    updateProgressSummary();
    const newlyUnlocked = getNewlyUnlockedStyles(previousDistance, progress.distance);
    if (newlyUnlocked.length > 0) {
      renderWardrobe();
      showUnlock(newlyUnlocked);
      window.clearTimeout(saveTimer);
      saveStyleProgress(progress);
    } else {
      scheduleProgressSave();
    }
  };
  if (!editMode) {
    pageHideHandler = () => {
      window.clearTimeout(saveTimer);
      saveStyleProgress(progress);
    };
    window.addEventListener('pagehide', pageHideHandler);
    loadHostedStyleProgress(progress, () => {
      updateProgressSummary();
      renderWardrobe();
    });
  }

  let pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(WIDTH * pixelRatio);
  canvas.height = Math.round(HEIGHT * pixelRatio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const onResize = () => {
    const oldWidth = WIDTH;
    const oldHeight = HEIGHT;
    const oldRatio = pixelRatio;
    updateCanvasLogicalSize(canvas);
    pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    if (WIDTH === oldWidth && HEIGHT === oldHeight && pixelRatio === oldRatio) return;
    const resizeX = WIDTH / oldWidth;
    const resizeY = HEIGHT / oldHeight;
    state = { ...state, x: state.x * resizeX, y: state.y * resizeY, vx: state.vx * resizeX, vy: state.vy * resizeY };
    target.x *= resizeX;
    target.y *= resizeY;
    settings = readSettings();
    if (!editMode) {
      line = createFollowerLine({ x: target.x, y: target.y }, followerCount);
      trail = line.trail;
      followers = line.figures;
      state = followers[0];
    }
    canvas.width = Math.round(WIDTH * pixelRatio);
    canvas.height = Math.round(HEIGHT * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    lastInputPoint = null;
    previousTime = 0;
  };
  window.addEventListener('resize', onResize);
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let rafId = 0;
  let previousTime = 0;

  const pointFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  };
  const onPointerDown = (event) => {
    const point = pointFromEvent(event);
    if (!editMode && screen !== 'play') {
      event.preventDefault();
      return;
    }
    if (editMode) {
      const withinFigure = Math.hypot(point.x - state.x, point.y - (state.y - 25 * settings.scale)) < 112 * settings.scale;
      if (!withinFigure) return;
      dragging = true;
      dragOffsetX = state.x - point.x;
      dragOffsetY = state.y - point.y;
      canvas.style.cursor = 'grabbing';
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    target.x = point.x;
    target.y = point.y;
    target.active = true;
    cursorClickUntil = window.performance.now() + 380;
    if (soundEnabled && audioContext && audioContext.currentTime - lastSoundAt > 0.085) {
      lastSoundAt = audioContext.currentTime;
      playCursorSound(audioContext, progress.cursor);
    }
    recordPlayerMovement(point);
    appendFollowerTrailPoint(trail, point, (followerCount + 1) * FOLLOWER_SPACING);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    const point = pointFromEvent(event);
    if (!editMode && screen !== 'play') return;
    if (editMode) {
      if (!dragging) return;
      const marginX = 80 * ART_SCALE;
      const minY = 220 * ART_SCALE;
      const marginY = 100 * ART_SCALE;
      state = { ...state, x: Math.max(marginX, Math.min(WIDTH - marginX, point.x + dragOffsetX)), y: Math.max(minY, Math.min(HEIGHT - marginY, point.y + dragOffsetY)) };
      if (window.gameConfig) {
        if (!window.gameConfig.follower) window.gameConfig.follower = {};
        window.gameConfig.follower.startX = state.x / SCALE_X;
        window.gameConfig.follower.startY = state.y / SCALE_Y;
      }
      return;
    }
    target.x = point.x;
    target.y = point.y;
    target.active = true;
    recordPlayerMovement(point);
    appendFollowerTrailPoint(trail, point, (followerCount + 1) * FOLLOWER_SPACING);
  };
  const stopDragging = () => {
    dragging = false;
    canvas.style.cursor = 'default';
  };
  const onContextMenu = (event) => event.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('contextmenu', onContextMenu);

  const frame = (time) => {
    const dt = previousTime ? Math.min(0.11, (time - previousTime) / 1000) : 0;
    previousTime = time;
    if (editMode) {
      drawFrame(ctx, state, target, readSettings(), true, dragging, time);
    } else if (screen === 'intro') {
      drawIntroFrame(ctx, state, readSettings(), time);
    } else {
      const currentSettings = readSettings();
      for (let i = 0; i < followers.length; i += 1) {
        const destination = i === 0 ? target : sampleFollowerTrail(trail, i * FOLLOWER_SPACING);
        followers[i] = stepFollower(followers[i], destination, dt, currentSettings.speed);
      }
      state = followers[0];
      const clickProgress = Math.max(0, Math.min(1, (cursorClickUntil - time) / 380));
      drawPlayFrame(ctx, followers, target, currentSettings, time, progress.cursor, clickProgress, progress.costume);
    }
    rafId = window.requestAnimationFrame(frame);
  };
  rafId = window.requestAnimationFrame(frame);

  activeCleanup = () => {
    window.cancelAnimationFrame(rafId);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', stopDragging);
    canvas.removeEventListener('pointercancel', stopDragging);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('resize', onResize);
    if (startButton && startGame) startButton.removeEventListener('click', startGame);
    if (countSlider && updateFollowerCount) countSlider.removeEventListener('input', updateFollowerCount);
    if (soundToggleButton && soundToggleHandler) soundToggleButton.removeEventListener('click', soundToggleHandler);
    if (pageHideHandler) window.removeEventListener('pagehide', pageHideHandler);
    if (wardrobeKeyDownHandler) document.removeEventListener('keydown', wardrobeKeyDownHandler);
    if (wardrobeBackdrop && wardrobeBackdropClickHandler) wardrobeBackdrop.removeEventListener('click', wardrobeBackdropClickHandler);
    if (saveTimer) window.clearTimeout(saveTimer);
    if (toastTimer) window.clearTimeout(toastTimer);
    if (!editMode) saveStyleProgress(progress);
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
    if (startButton) startButton.remove();
    if (countControl) countControl.remove();
    if (introEffects) introEffects.remove();
    if (closetButton) closetButton.remove();
    if (wardrobeBackdrop) wardrobeBackdrop.remove();
    if (unlockToast) unlockToast.remove();
    canvas.remove();
  };
}

// Astrocade can still call window.run(mode), but a plain browser/editor preview
// does not have a host to call it. Auto-start only when no host globals exist.
window.run = run;
const hasAstrocadeHost = typeof window.gameConfig !== 'undefined'
  || typeof window.mode !== 'undefined';
if (!hasAstrocadeHost) {
  const startStandalone = () => {
    if (!hasStarted) run('play');
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startStandalone, { once: true });
  } else {
    startStandalone();
  }
}
