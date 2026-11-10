// AI interview watching, all in the candidate's browser: nothing but the event name leaves the page.
//  - face monitor: no face, a second face, eyes or head turned away from the screen, looking down for long (reading). MediaPipe Face Landmarker, its
//    model and wasm are served from /mediapipe (no third-party request).
//  - noise monitor: loud background noise while the candidate is not the one speaking.
//  - screen share (the whole screen) and a composite stream (screen + the candidate's face) for the recording.
// The numbers below are starting values; they are deliberately forgiving (a candidate reading the question on screen looks slightly down and aside).

export const PROCTOR_TEXT = {
  no_face: 'We could not see your face. Please sit in front of the camera with your face clearly visible.',
  multiple_faces: 'More than one person is visible. The interview must be taken alone.',
  eyes_away: 'Your eyes or head turned away from the screen. Please keep looking at the screen while you answer.',
  looking_down: 'You looked down for a long time. Please do not read from notes or a phone; answer in your own words.',
  noise: 'There is loud background noise or voices. Please move to a quiet place.',
  screen_share_stopped: 'Your screen share stopped. Please share your entire screen again to continue.',
};

const FACE = {
  tickMs: 400,
  settleMs: 4000, // nothing is judged in the first seconds after the camera starts
  holdMs: { no_face: 5000, multiple_faces: 3000, eyes_away: 5000, looking_down: 7000 },
  cooldownMs: 15000, // one episode is one warning; a problem that goes on gives the next warning only after this long
  gazeSide: 0.55, // average eye-look score to the side (0..1)
  gazeDown: 0.6, // average eye-look-down score (a webcam above the screen makes normal reading look slightly down)
  yawDeg: 32, // head turned this far to a side
};

const avg = (...n) => n.reduce((a, b) => a + b, 0) / n.length;

/** Head turn (degrees, sign ignored) from the face transformation matrix (column-major 4x4). */
function yawOf(matrix) {
  if (!matrix?.data || matrix.data.length < 16) return 0;
  const m = matrix.data;
  return Math.abs((Math.atan2(m[8], m[10]) * 180) / Math.PI);
}

/**
 * Watches the camera. `onEvent(type)` is called once per episode. Resolves to { stop() } or null when the model could not be loaded (the
 * interview then carries on without face watching, and the recording still shows the candidate).
 */
export async function createFaceMonitor({ stream, onEvent, isPaused = () => false }) {
  const videoTrack = stream?.getVideoTracks?.()[0];
  if (!videoTrack) return null;
  let landmarker = null;
  try {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    try { landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU')); } catch { landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU')); }
  } catch {
    return null;
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([videoTrack]);
  try { await video.play(); } catch { /* the first frame arrives anyway */ }

  const startedAt = Date.now();
  const since = {}; // type -> when the condition began
  const lastFired = {}; // type -> when it last gave a warning
  const track = (type, on, now) => {
    if (!on) { since[type] = null; return; }
    since[type] = since[type] || now;
    if (now - since[type] >= FACE.holdMs[type] && now - (lastFired[type] || 0) >= FACE.cooldownMs) {
      lastFired[type] = now;
      since[type] = null;
      onEvent(type);
    }
  };

  const timer = setInterval(() => {
    const now = Date.now();
    if (isPaused() || video.readyState < 2 || videoTrack.readyState !== 'live') { Object.keys(since).forEach((k) => { since[k] = null; }); return; }
    if (now - startedAt < FACE.settleMs) return;
    let result;
    try { result = landmarker.detectForVideo(video, performance.now()); } catch { return; }
    const faces = result?.faceLandmarks?.length || 0;
    track('no_face', faces === 0, now);
    track('multiple_faces', faces > 1, now);
    if (faces === 1) {
      const scores = Object.fromEntries((result.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]));
      const right = avg(scores.eyeLookInLeft || 0, scores.eyeLookOutRight || 0);
      const left = avg(scores.eyeLookOutLeft || 0, scores.eyeLookInRight || 0);
      const down = avg(scores.eyeLookDownLeft || 0, scores.eyeLookDownRight || 0);
      const away = Math.max(left, right) > FACE.gazeSide || yawOf(result.facialTransformationMatrixes?.[0]) > FACE.yawDeg;
      track('eyes_away', away, now);
      track('looking_down', down > FACE.gazeDown && !away, now);
    } else {
      track('eyes_away', false, now);
      track('looking_down', false, now);
    }
  }, FACE.tickMs);

  return {
    stop() {
      clearInterval(timer);
      try { landmarker.close(); } catch { /* already closed */ }
      video.pause();
      video.srcObject = null;
    },
  };
}

const NOISE = { tickMs: 250, holdMs: 7000, cooldownMs: 20000, floor: 0.05, factor: 2.5, calibrateMs: 8000 };

/**
 * Loud background sound while the candidate is not the one speaking (`isCandidateSpeaking()`). The quiet level of the room is measured first, and
 * the limit is a multiple of it. Voices of other people are not told apart from noise: both count.
 */
export function createNoiseMonitor({ stream, onEvent, isCandidateSpeaking = () => false, isPaused = () => false }) {
  const audio = stream?.getAudioTracks?.()[0];
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!audio || !Ctx) return null;
  let ctx;
  try { ctx = new Ctx(); } catch { return null; }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(new MediaStream([audio])).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const startedAt = Date.now();
  const quiet = [];
  let limit = NOISE.floor;
  let loudSince = null;
  let lastFired = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    if (isPaused() || isCandidateSpeaking()) { loudSince = null; return; }
    if (now - startedAt < NOISE.calibrateMs) {
      quiet.push(rms);
      if (now - startedAt >= NOISE.calibrateMs - NOISE.tickMs && quiet.length) {
        const sorted = [...quiet].sort((a, b) => a - b);
        limit = Math.max(NOISE.floor, sorted[Math.floor(sorted.length * 0.9)] * NOISE.factor);
      }
      return;
    }
    if (rms > limit) {
      loudSince = loudSince || now;
      if (now - loudSince >= NOISE.holdMs && now - lastFired >= NOISE.cooldownMs) { lastFired = now; loudSince = null; onEvent('noise'); }
    } else {
      loudSince = null;
    }
  }, NOISE.tickMs);
  return { stop() { clearInterval(timer); try { ctx.close(); } catch { /* already closed */ } } };
}

/** Asks for the entire screen. Throws { code } with 'not_entire_screen' when a window or a tab was picked, or the browser's own error. */
export async function requestScreenShare() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: 10 }, audio: false });
  const surface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface;
  if (surface && surface !== 'monitor') {
    stream.getTracks().forEach((t) => t.stop());
    const err = new Error('not_entire_screen');
    err.code = 'not_entire_screen';
    throw err;
  }
  return stream;
}

/**
 * One stream for the recording: the shared screen full size, the candidate's face in a corner, and the microphone. A timer (not
 * requestAnimationFrame) draws it, so it keeps going when the page is not the visible tab.
 */
export function createCompositeStream({ screenStream, cameraStream }) {
  const W = 1280;
  const H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const screen = document.createElement('video');
  screen.muted = true;
  screen.playsInline = true;
  screen.srcObject = screenStream;
  const face = document.createElement('video');
  face.muted = true;
  face.playsInline = true;
  face.srcObject = new MediaStream(cameraStream.getVideoTracks());
  screen.play().catch(() => {});
  face.play().catch(() => {});
  const pip = { w: 288, h: 216, margin: 16 };
  const draw = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (screen.videoWidth) {
      const scale = Math.min(W / screen.videoWidth, H / screen.videoHeight);
      const w = screen.videoWidth * scale;
      const h = screen.videoHeight * scale;
      ctx.drawImage(screen, (W - w) / 2, (H - h) / 2, w, h);
    }
    if (face.videoWidth) {
      const x = W - pip.w - pip.margin;
      const y = H - pip.h - pip.margin;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 3, y - 3, pip.w + 6, pip.h + 6);
      ctx.drawImage(face, x, y, pip.w, pip.h);
    }
  };
  draw();
  const timer = setInterval(draw, 100);
  const out = canvas.captureStream(10);
  cameraStream.getAudioTracks().forEach((t) => out.addTrack(t));
  return {
    stream: out,
    stop() {
      clearInterval(timer);
      screen.pause();
      face.pause();
      screen.srcObject = null;
      face.srcObject = null;
      out.getVideoTracks().forEach((t) => t.stop()); // the audio track belongs to the camera stream, which the page stops itself
    },
  };
}
