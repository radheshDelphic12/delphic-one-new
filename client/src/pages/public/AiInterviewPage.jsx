import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Clock, Loader2, Mic, MicOff, MonitorUp, Video } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { PROCTOR_TEXT, createCompositeStream, createFaceMonitor, createNoiseMonitor, requestScreenShare } from '../../lib/aiProctor.js';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const RECORDER_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const SECTION_LABEL = { role: 'Role questions', aptitude: 'Aptitude' };
const NO_ANSWER_TEXT = '[No answer - time ran out]';
/** What the candidate is told after leaving: warning 1 of N-1, the final warning, then the interview ends on the next one. */
function leaveWarning(what, tabSwitches, limit) {
  if (!limit) return `${what} This has been recorded. Please stay on the interview until you finish.`;
  const warnings = Math.max(1, limit - 1);
  const n = Math.min(tabSwitches, warnings);
  return `${what} Warning ${n} of ${warnings}${n >= warnings ? ' - this is the final warning: the next time the interview ends automatically' : ''}. Please stay on the interview until you finish.`;
}
const GRACE_MS = 4000; // permission prompts and the start of the recording briefly take focus; those are not tab switches

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-tertiary-50 px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-tertiary-100 bg-white p-6 shadow-card">{children}</div>
    </div>
  );
}

/**
 * The candidate's AI interview: opened from the link, no login. A mic test and consent first, then the AI asks one question at
 * a time; answers are spoken (no text box, the words are not shown to the candidate); only the aptitude / numerical questions are typed. Closing the tab keeps progress (the link resumes where it stopped).
 * When the company records interviews, the recording is mandatory: camera and microphone must stay on and audio + video are sent
 * to the server in small parts. Every question has a countdown. Copying, pasting and right-click are blocked, and leaving the page
 * is logged and warned about; too many tab switches end the interview for a person to review.
 */
export default function AiInterviewPage() {
  const { token } = useParams();
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [endedByRules, setEndedByRules] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recordConsent, setRecordConsent] = useState(false);
  const [mic, setMic] = useState('idle'); // idle | testing | ok | failed
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingReady, setRecordingReady] = useState(false); // the server has stored the first chunk
  const [cameraProblem, setCameraProblem] = useState('');
  const [remaining, setRemaining] = useState(null); // seconds left on this question, null = no limit
  const [warning, setWarning] = useState('');
  const [stalled, setStalled] = useState(false); // the first recording chunk has not reached the server for a while
  const recRef = useRef(null); // speech recognition
  const baseTextRef = useRef('');
  const wantListenRef = useRef(false); // the candidate pressed "Speak" and has not pressed "Stop" yet
  const [speechNote, setSpeechNote] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const resumedRef = useRef(false);
  const partRef = useRef({ part: 0, stored: false }); // the recording part in progress and whether the server has stored a chunk of it
  const graceUntilRef = useRef(0);
  // camera / microphone / screen watching (settings: proctoring, require_screen_share)
  const [cameraReady, setCameraReady] = useState(false);
  const [screenOn, setScreenOn] = useState(false); // the whole screen is being shared
  const [screenError, setScreenError] = useState('');
  const screenRef = useRef(null); // the screen-share stream
  const compositeRef = useRef(null); // screen + face, what the recording is made from while sharing
  // Full screen and one display: with the interview in full screen no other window can sit next to it, so the rule is enforced on the page.
  const [fsOk, setFsOk] = useState(() => Boolean(document.fullscreenElement));
  const [multiDisplay, setMultiDisplay] = useState(false);
  const fsAwayRef = useRef(null); // since when the candidate has been out of full screen
  const hadFsRef = useRef(false);
  const awayRef = useRef(null); // { at, kind } while the candidate is away from the page
  const timedOutForRef = useRef(null); // the question turn already auto-submitted by the timer
  const textRef = useRef('');
  useEffect(() => { textRef.current = text; }, [text]);
  const viewRef = useRef(null); // the latest view, for code that runs later (timers, retries)
  const busyRef = useRef(false);
  const questionRef = useRef(null);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    apiClient.get(`/public/ai-interviews/${token}`)
      .then(({ data }) => setView(data.data))
      .catch((err) => setError(apiErrorMessage(err, 'This link is not valid.')));
  }, [token]);

  // ---- integrity events (tab switch, copy / paste attempts, camera off) ----
  const report = useCallback(async (type, secondsAway) => {
    try {
      const { data } = await apiClient.post(`/public/ai-interviews/${token}/event`, { type, ...(secondsAway != null ? { seconds_away: secondsAway } : {}) });
      if (data.data?.ended) setEndedByRules(true);
      return data.data;
    } catch { return null; }
  }, [token]);

  // Reads the interview as the server has it now. A request that failed or took very long may still have been processed, so the page
  // never trusts its own copy after an error: it asks. Returns the view, or { gone: message } when the link no longer opens (finished).
  const refreshView = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/public/ai-interviews/${token}`);
      setView((v) => ({ ...v, ...data.data }));
      return data.data;
    } catch (err) {
      return err?.response?.status === 410 ? { gone: apiErrorMessage(err, '') } : null;
    }
  }, [token]);

  // ---- recording: parts are uploaded one after another so the server can append them in order ----
  // A chunk that did not get through (a slow or dropped connection, a busy server) is tried again with a growing pause instead of being
  // thrown away: a lost chunk would leave a gap and stop the rest of the recording from being accepted.
  const uploadPart = useCallback((blob, part, seq, type) => {
    queueRef.current = queueRef.current.then(async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await apiClient.post(`/public/ai-interviews/${token}/recording?part=${part}&seq=${seq}`, blob, { headers: { 'Content-Type': type } });
          if (partRef.current.part === part) partRef.current.stored = true;
          setRecordingReady(true);
          return;
        } catch (err) {
          const status = err?.response?.status;
          if ([400, 404, 409, 410, 413].includes(status)) return; // retrying cannot help (refused, gone, out of order, too big)
          await new Promise((resolve) => { setTimeout(resolve, Math.min(15000, 1000 * 2 ** attempt)); });
        }
      }
    });
  }, [token]);

  // `part` is 0 for a first recording; a candidate who closed the page and came back records the next part (its own file).
  const startRecording = useCallback(async (part = 0) => {
    graceUntilRef.current = Date.now() + GRACE_MS;
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      let stream = streamRef.current;
      if (!stream || stream.getTracks().some((t) => t.readyState === 'ended')) stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
      streamRef.current = stream;
      const type = RECORDER_TYPES.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
      if (!window.MediaRecorder || !type) throw new Error('unsupported');
      setCameraReady(true);
      // while the screen is shared the recording is the screen with the face in a corner; otherwise the camera alone
      compositeRef.current?.stop();
      compositeRef.current = null;
      if (screenRef.current && screenRef.current.getVideoTracks().some((t) => t.readyState === 'live')) compositeRef.current = createCompositeStream({ screenStream: screenRef.current, cameraStream: stream });
      const source = compositeRef.current ? compositeRef.current.stream : stream;
      const recorder = new MediaRecorder(source, { mimeType: type, videoBitsPerSecond: compositeRef.current ? 900000 : 500000, audioBitsPerSecond: 64000 });
      let seq = 0;
      recorder.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        uploadPart(e.data, part, seq, type.split(';')[0]);
        seq += 1;
      };
      partRef.current = { part, stored: false };
      recorder.start(5000);
      recorderRef.current = recorder;
      stream.getTracks().forEach((t) => { t.onended = () => { setRecording(false); setCameraProblem('Your camera or microphone was turned off.'); report('camera_off'); }; });
      setCameraProblem('');
      setRecording(true);
    } catch (err) {
      setRecording(false);
      setCameraProblem(err?.message === 'unsupported'
        ? 'This browser cannot record video. Please open this link in a recent Chrome or Edge, on a computer or an Android phone.'
        : 'The camera and microphone could not be started. Allow them in the browser (the camera icon in the address bar) and try again.');
    }
  }, [uploadPart, report]);

  // after the camera was off or refused: carry on as the next part (the same part again if nothing of the last one reached the server)
  const retryCamera = () => { const p = partRef.current; startRecording(p.stored ? p.part + 1 : p.part); };

  // ---- camera / microphone / screen warnings: each one is a warning from the server; after the company's number of warnings the next ends the interview ----
  const proctoring = Boolean(view?.proctoring);
  const needScreen = Boolean(view?.require_screen_share);
  const speakingRef = useRef(false);
  useEffect(() => { speakingRef.current = listening; }, [listening]);
  const proctorWarn = useCallback(async (type) => {
    const res = await report(type);
    if (!res || res.ended) return;
    const max = res.max_proctor_warnings;
    const n = res.proctor_warnings;
    setWarning(max > 0 ? `${PROCTOR_TEXT[type]} Warning ${Math.min(n, max)} of ${max}${n >= max ? ' - this is the final warning: the next one ends the interview' : ''}.` : `${PROCTOR_TEXT[type]} Warning ${n}. This is recorded and the team will review the recording.`);
  }, [report]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    }
    await queueRef.current;
    streamRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    compositeRef.current?.stop();
    screenRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    setRecording(false);
  }, []);

  useEffect(() => { if (recording && videoRef.current) videoRef.current.srcObject = streamRef.current; }, [recording]);
  useEffect(() => () => { recRef.current?.stop?.(); streamRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); compositeRef.current?.stop(); screenRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); }, []);

  // A reopened, recorded interview carries on recording as the next part (the same consent still applies).
  useEffect(() => {
    if (view?.status === 'started' && view.recording_on && !resumedRef.current) {
      resumedRef.current = true;
      startRecording(view.recording_parts || 0);
    }
  }, [view, startRecording]);

  // ---- no copying, pasting or leaving the page while the interview runs ----
  const active = view?.status === 'started' && !finished && !endedByRules;
  useEffect(() => {
    if (!active) return undefined;
    const block = (type) => (e) => { e.preventDefault(); report(type); setWarning('Copying, cutting and pasting are not allowed in this interview. Please answer in your own words, by speaking.'); };
    const onCopy = block('copy');
    const onCut = block('cut');
    const onPaste = block('paste');
    const onMenu = (e) => { e.preventDefault(); report('context_menu'); };
    const onSelect = (e) => { if (!['TEXTAREA', 'INPUT'].includes(e.target?.tagName)) e.preventDefault(); };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['c', 'x', 'v', 'a', 'p', 's', 'u'].includes(String(e.key).toLowerCase()) && !(e.target?.tagName === 'TEXTAREA' && ['a'].includes(String(e.key).toLowerCase()))) {
        e.preventDefault();
        if (['c', 'x', 'v'].includes(String(e.key).toLowerCase())) return; // the copy / cut / paste event reports it
        report('blocked_key');
      }
    };
    const away = (kind) => { if (fsAwayRef.current) return; if (!awayRef.current && Date.now() > graceUntilRef.current) awayRef.current = { at: Date.now(), kind }; };
    const back = async () => {
      const gone = awayRef.current;
      awayRef.current = null;
      if (!gone || Date.now() < graceUntilRef.current) return;
      const seconds = (Date.now() - gone.at) / 1000;
      // a few seconds away is a browser prompt, a notification or the address bar, not a visit to another page: not counted
      if (seconds < (gone.kind === 'window_blur' ? 5 : 2)) return;
      const res = await report(gone.kind, seconds);
      if (res && !res.ended) {
        const limit = view?.max_tab_switches;
        setWarning(leaveWarning('You left the interview page.', res.tab_switches, limit));
      }
    };
    const onVisibility = () => (document.hidden ? away('tab_hidden') : back());
    const onBlur = () => away('window_blur');
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('selectstart', onSelect);
    document.addEventListener('dragstart', onSelect);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('selectstart', onSelect);
      document.removeEventListener('dragstart', onSelect);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', back);
    };
  }, [active, report, view?.max_tab_switches]);

  // ---- sharing the entire screen (recorded beside the face) ----
  const activeRef = useRef(false);
  useEffect(() => { activeRef.current = active; }, [active]);
  const shareScreen = useCallback(async () => {
    setScreenError('');
    graceUntilRef.current = Date.now() + GRACE_MS;
    try {
      const stream = await requestScreenShare();
      screenRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      screenRef.current = stream;
      stream.getVideoTracks()[0].onended = () => { setScreenOn(false); if (activeRef.current) proctorWarn('screen_share_stopped'); };
      setScreenOn(true);
      return true;
    } catch (err) {
      setScreenOn(false);
      setScreenError(err?.code === 'not_entire_screen' ? 'Please choose "Entire screen", not a window or a tab.' : 'The screen could not be shared. Allow it and choose your entire screen.');
      return false;
    }
  }, [proctorWarn]);
  // after the share stopped mid-interview: share again, and carry the recording on (the screen is in it again) as the next part
  async function shareAgain() {
    if (!(await shareScreen())) return;
    if (viewRef.current?.recording_on) { const p = partRef.current; startRecording(p.stored ? p.part + 1 : p.part); }
  }

  // ---- watching the camera and microphone while the interview runs ----
  useEffect(() => {
    if (!active || !proctoring || !cameraReady || !streamRef.current) return undefined;
    let face = null;
    let cancelled = false;
    const paused = () => document.hidden || (needScreen && !screenRef.current?.getVideoTracks().some((t) => t.readyState === 'live'));
    createFaceMonitor({ stream: streamRef.current, onEvent: proctorWarn, isPaused: paused }).then((m) => { if (cancelled) m?.stop(); else { face = m; if (!m) report('monitor_unavailable'); } }); // no monitor: the team is told the face watching was off
    const noise = createNoiseMonitor({ stream: streamRef.current, onEvent: proctorWarn, isCandidateSpeaking: () => speakingRef.current || busyRef.current, isPaused: paused });
    return () => { cancelled = true; face?.stop(); noise?.stop(); };
  }, [active, proctoring, cameraReady, needScreen, proctorWarn, report]);
  // an interview reopened without recording still needs the camera for the watching
  useEffect(() => {
    if (view?.status !== 'started' || !view.proctoring || view.recording_on || streamRef.current) return;
    navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } }).then((st) => { streamRef.current = st; setCameraReady(true); }).catch(() => { setCameraProblem('The camera and microphone could not be started. Allow them in the browser and reload this page.'); });
  }, [view]);

  // ---- full screen and a single display ----
  const needFullscreen = Boolean(view?.require_fullscreen);
  async function enterFullscreen() {
    graceUntilRef.current = Date.now() + GRACE_MS;
    try { await document.documentElement.requestFullscreen(); return true; } catch { return false; }
  }
  useEffect(() => {
    const sync = () => setFsOk(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // Chrome and Edge say when a second display is connected
  useEffect(() => {
    const check = () => setMultiDisplay(Boolean(window.screen?.isExtended));
    check();
    const timer = setInterval(check, 3000);
    window.screen?.addEventListener?.('change', check);
    return () => { clearInterval(timer); window.screen?.removeEventListener?.('change', check); };
  }, []);
  useEffect(() => { if (active && multiDisplay) report('multiple_displays'); }, [active, multiDisplay, report]);
  // Leaving full screen while the interview runs is counted once (a warning, like leaving the page); the screen stays covered until the
  // candidate is back, and the question timer keeps running. (An interview reopened from the link gets 10 seconds to press the button first.)
  useEffect(() => {
    if (!active || !needFullscreen) return undefined;
    if (fsOk) { hadFsRef.current = true; fsAwayRef.current = null; return undefined; }
    fsAwayRef.current = fsAwayRef.current || Date.now();
    awayRef.current = null;
    let timer = null;
    const count = async () => {
      const res = await report('fullscreen_exit', (Date.now() - fsAwayRef.current) / 1000);
      if (res && !res.ended) setWarning(leaveWarning('You left full screen, which is required.', res.tab_switches, view?.max_tab_switches));
    };
    timer = setTimeout(count, hadFsRef.current ? 500 : 10000);
    return () => clearTimeout(timer);
  }, [active, needFullscreen, fsOk, report, view?.max_tab_switches]);
  useEffect(() => { if ((finished || endedByRules) && document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }, [finished, endedByRules]);

  // ---- microphone test ----
  async function testMic() {
    setMic('testing');
    try {
      graceUntilRef.current = Date.now() + GRACE_MS;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let heard = false;
      const until = Date.now() + 4000;
      await new Promise((resolve) => {
        const tick = () => {
          analyser.getByteFrequencyData(data);
          if (data.some((v) => v > 40)) heard = true;
          if (heard || Date.now() > until) resolve(); else requestAnimationFrame(tick);
        };
        tick();
      });
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      setMic(heard ? 'ok' : 'quiet');
    } catch {
      setMic('failed');
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      if (view.require_fullscreen && !(await enterFullscreen())) {
        setError('This interview must be taken in full screen on a single display, and this browser would not allow it. Please open the link in a recent Chrome or Edge on a computer.');
        return;
      }
      if (view.require_screen_share && !(screenRef.current && screenRef.current.getVideoTracks().some((t) => t.readyState === 'live'))) {
        setError('Please share your entire screen first (the "Share entire screen" button), then press Start.');
        return;
      }
      // a recorded or watched interview needs the camera before it begins, so a refusal is caught here and not halfway through
      if (view.recording_required || view.proctoring) {
        graceUntilRef.current = Date.now() + GRACE_MS;
        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
          setCameraReady(true);
        } catch {
          setError('This interview is recorded or watched, so the camera and microphone must be allowed. Allow them in the browser (the camera icon in the address bar) and press Start again.');
          return;
        }
      }
      const { data } = await apiClient.post(`/public/ai-interviews/${token}/start`, { consent: true, recording_consent: recordConsent });
      setView((v) => ({ ...v, ...data.data }));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not start the interview. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  // ---- speaking: speech is kept in state for sending but is never shown. Only aptitude / numerical answers may be typed. ----
  const SPEECH_PROBLEMS = {
    'not-allowed': 'The browser is not allowing the microphone for speech. Allow it (the lock icon in the address bar) and press Speak again.',
    'service-not-allowed': 'Speech to text is blocked on this browser. Please open the interview in a recent Chrome or Edge.',
    'audio-capture': 'No microphone was found for speech. Connect one and press Speak again.',
    network: 'Speech to text needs a working internet connection and could not reach its service. Check your connection and press Speak again.',
    'language-not-supported': 'Speech to text does not support this language here. Please use a recent Chrome or Edge.',
  };

  function stopListening() {
    wantListenRef.current = false;
    recRef.current?.stop?.();
    setListening(false);
  }

  // Speaking fills the answer box live. The browser stops listening by itself after a pause, so it is started again until the candidate
  // presses Stop; a problem is explained on the page.
  function startRecognition() {
    const rec = new SpeechRecognition();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let spoken = '';
      for (let i = 0; i < e.results.length; i += 1) spoken += e.results[i][0].transcript;
      setText(baseTextRef.current + spoken);
      setSpeechNote('');
    };
    rec.onerror = (e) => {
      const code = e?.error;
      if (code === 'no-speech' || code === 'aborted') return; // a pause; onend restarts it
      wantListenRef.current = false;
      setListening(false);
      setSpeechNote(SPEECH_PROBLEMS[code] || 'Speech to text stopped working. Press Speak again.');
    };
    rec.onend = () => {
      if (wantListenRef.current && !busyRef.current) {
        baseTextRef.current = `${(textRef.current || '').trim()} `.trimStart();
        try { startRecognition(); return; } catch { /* fall through to stopped */ }
      }
      setListening(false);
    };
    recRef.current = rec;
    rec.start();
  }

  function toggleListening() {
    if (listening) { stopListening(); return; }
    setSpeechNote('');
    baseTextRef.current = text ? `${text.trim()} ` : '';
    wantListenRef.current = true;
    try {
      startRecognition();
      setListening(true);
    } catch {
      wantListenRef.current = false;
      setSpeechNote('Speech to text could not start. Press Speak again.');
    }
  }

  const send = useCallback(async ({ timedOut = false } = {}) => {
    if (busyRef.current) return; // one send at a time: a double click, or the timer firing while an answer is on its way
    stopListening();
    const answeredBefore = viewRef.current?.answered ?? 0;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const sentText = textRef.current;
    try {
      const typed = sentText.trim();
      const out = typed.length >= 2 ? typed : NO_ANSWER_TEXT;
      const { data } = await apiClient.post(`/public/ai-interviews/${token}/answer`, { text: out, ...(timedOut && typed.length < 2 ? { timed_out: true } : {}) });
      setText('');
      setView((v) => ({ ...v, ...data.data }));
      if (data.data.done) {
        // The answers are in: show the thank-you page at once; the last recording parts upload in the background (never block on them).
        setFinished(true);
        stopRecording().catch(() => {});
      }
    } catch (err) {
      // The server may have taken the answer although this request failed (a timeout, a gateway error, a dropped connection). Read the
      // real state before complaining, so the candidate is never left on a question that was already answered.
      let fresh = await refreshView();
      // "still being processed": give the server a moment, then look again
      const cameraNotStarted = /camera recording/i.test(String(err?.response?.data?.message || '')); // not "still processing": tell the candidate at once
      for (let i = 0; i < 10 && err?.response?.status === 409 && !cameraNotStarted && fresh && !fresh.gone && fresh.answered <= answeredBefore; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 3000); });
        fresh = await refreshView();
      }
      if (fresh?.gone && /complete/i.test(fresh.gone)) {
        setFinished(true);
        stopRecording().catch(() => {});
      } else if (fresh && !fresh.gone && fresh.answered > answeredBefore) {
        setText(''); // it went through after all: the page now shows the next question
      } else {
        setError(apiErrorMessage(err, 'Your answer could not be sent. Please try again.'));
        // an automatic send that failed is tried again a few seconds later; otherwise an empty box could never be sent
        if (timedOut) setTimeout(() => { timedOutForRef.current = null; }, 5000);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [token, stopRecording, refreshView]);

  // While the interviewer is working (reading the answer, writing the next question) or the next question is not there yet, the page keeps
  // asking the server, so a slow answer, a restart or a lost reply still ends with the next question on screen instead of a frozen page.
  const noQuestionYet = view?.status === 'started' && !view?.waiting_for_answer && !finished;
  useEffect(() => {
    if (!noQuestionYet && !busy) return undefined;
    const before = viewRef.current?.answered ?? 0;
    const id = setInterval(async () => {
      const fresh = await refreshView();
      if (fresh?.gone && /complete/i.test(fresh.gone)) { setFinished(true); return; }
      if (busyRef.current && fresh && !fresh.gone && fresh.answered > before && fresh.waiting_for_answer) { setText(''); busyRef.current = false; setBusy(false); }
    }, busy ? 8000 : 3000);
    return () => clearInterval(id);
  }, [noQuestionYet, busy, refreshView]);

  // a new question comes into view (the history above it scrolls to the end too)
  const turnCount = view?.transcript?.length || 0;
  useEffect(() => { questionRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [turnCount]);

  const needsFirstChunk = Boolean(view?.recording_on) && recording && !recordingReady && !(view?.recording_parts > 0);
  useEffect(() => {
    if (!needsFirstChunk) { setStalled(false); return undefined; }
    const id = setTimeout(() => setStalled(true), 30000);
    return () => clearTimeout(id);
  }, [needsFirstChunk]);

  // ---- the countdown for the question on screen (from the server clock, so a reload cannot reset it) ----
  const asked = view?.question_asked_at;
  const limit = view?.answer_seconds;
  const waiting = Boolean(view?.waiting_for_answer);
  useEffect(() => {
    if (!active || !waiting || !asked || !limit) { setRemaining(null); return undefined; }
    const offset = new Date(view.server_now).getTime() - Date.now();
    const tick = () => {
      const left = Math.ceil(limit - (Date.now() + offset - new Date(asked).getTime()) / 1000);
      setRemaining(left);
      if (left <= 0 && timedOutForRef.current !== asked && !busyRef.current) {
        timedOutForRef.current = asked;
        send({ timedOut: true });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, waiting, asked, limit, view?.server_now, send]);

  if (endedByRules) {
    return <Shell><h1 className="font-heading text-lg font-semibold">Interview ended</h1><p className="mt-2 text-sm text-tertiary-600">This interview was ended because the interview rules were not followed (leaving the page too many times, or repeated warnings about the camera, microphone or screen). The answers you gave have been saved and the team will review them and get in touch with you.</p></Shell>;
  }
  if (finished || (view && !['invited', 'started'].includes(view.status))) {
    return <Shell><h1 className="font-heading text-lg font-semibold">Thank you</h1><p className="mt-2 text-sm text-tertiary-600">Your interview is complete. The team will get in touch with you.</p></Shell>;
  }
  if (error && !view) return <Shell><p className="text-sm text-danger-700">{error}</p></Shell>;
  if (!view) return <Shell><p className="text-sm text-tertiary-500">Loading...</p></Shell>;

  // ---- before the start: what to expect, microphone test, consent ----
  if (view.status === 'invited') {
    const mustRecord = Boolean(view.recording_required);
    return (
      <Shell>
        <h1 className="font-heading text-lg font-semibold text-tertiary-900">Interview for {view.role_title || 'the role'}</h1>
        <p className="mt-1 text-sm text-tertiary-600">Hello {view.candidate_name}. An AI interviewer will ask you questions one at a time. It takes about 15 to 20 minutes. You answer the interview questions by speaking; typing is not possible. Only the aptitude / numerical questions are typed.</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-tertiary-700">
          <li>Use a quiet place and a recent Chrome or Edge browser. Speaking is required, so a browser that cannot turn speech into text cannot be used.</li>
          <li>You can use this link once. If you close the page, open the same link to carry on where you stopped.</li>
          <li>There are a few short aptitude questions too. Work them out in your head and type the answer.</li>
          {view.answer_seconds > 0 && <li>Each question has a timer of {clock(view.answer_seconds)} minutes. When it ends, what you have answered so far is sent and the next question comes.</li>}
          {view.require_fullscreen && <li>The interview runs in full screen on a single display. Leaving full screen, or connecting a second display, is recorded and counted like leaving the page.</li>}
          <li>Stay on this page. Copying, pasting and right-click are blocked, and switching to another tab or window is recorded{view.max_tab_switches ? `; you get ${view.max_tab_switches - 1} warnings, and the next time the interview ends automatically` : ''}.</li>
          {mustRecord && <li>This interview is recorded (camera and microphone) and the recording is required. Keep them on until you finish.</li>}
          {view.proctoring && <li>Your camera and microphone are watched during the interview: keep your face visible, look at the screen, sit alone in a quiet place and do not read from notes or a phone. {view.max_proctor_warnings ? `You get ${view.max_proctor_warnings} warnings; the next one ends the interview.` : 'Problems are recorded for the team.'}</li>}
          {view.require_screen_share && <li>You share your entire screen, and the recording shows your screen together with your face.</li>}
          <li>The AI scores your answers; people at the company make the final decision.</li>
        </ul>
        <div className="mt-4 rounded-xl border border-tertiary-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-tertiary-800">Microphone test</p>
            <button type="button" className="btn-secondary text-xs" disabled={mic === 'testing'} onClick={testMic}>{mic === 'testing' ? 'Listening... say something' : 'Test microphone'}</button>
          </div>
          {mic === 'ok' && <p className="mt-2 text-xs text-success-700">Your microphone works.</p>}
          {mic === 'quiet' && <p className="mt-2 text-xs text-warning-700">We could not hear you. Check your microphone and test again; speaking is required to start.</p>}
          {mic === 'failed' && <p className="mt-2 text-xs text-warning-700">The microphone is not available. Speaking is required, so please allow it.</p>}
          {!SpeechRecognition && <p className="mt-2 text-xs text-tertiary-500">This browser cannot turn speech into text. Please open this link in a recent Chrome or Edge on a computer or an Android phone.</p>}
        </div>
        {view.require_screen_share && (
          <div className="mt-3 rounded-xl border border-tertiary-100 p-3" data-testid="screen-share-step">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-tertiary-800">Share your screen</p>
              <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" disabled={screenOn} onClick={shareScreen}><MonitorUp className="h-4 w-4" />{screenOn ? 'Screen shared' : 'Share entire screen'}</button>
            </div>
            {screenOn && <p className="mt-2 text-xs text-success-700">Your entire screen is shared. Keep it shared until the interview ends.</p>}
            {screenError && <p className="mt-2 text-xs text-warning-700">{screenError}</p>}
          </div>
        )}
        <label className="mt-4 flex items-start gap-2 text-sm text-tertiary-800">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I understand that my answers are evaluated by an AI, and I agree.</span>
        </label>
        {view.recording_offered && (
          <label className="mt-2 flex items-start gap-2 text-sm text-tertiary-800">
            <input type="checkbox" className="mt-1" checked={recordConsent} onChange={(e) => setRecordConsent(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1 font-medium"><Video className="h-4 w-4" /> I agree to be recorded{mustRecord ? ' (required)' : ''}</span>
              <span className="block text-xs text-tertiary-500">The company records your audio and video for review. The recording is kept for {view.recording_days || 2} days and then deleted automatically. The interview cannot be taken without it.</span>
            </span>
          </label>
        )}
        {!view.ai_enabled && <p className="mt-3 text-xs text-warning-700">The interviewer is not switched on yet. Please try again later.</p>}
        {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
        {view.require_fullscreen && multiDisplay && <p className="mt-3 text-sm text-danger-700" data-testid="multi-display-note">A second display is connected. Please use one screen only (disconnect or switch off the other) to start.</p>}
        <button type="button" className="btn-primary mt-5" disabled={!consent || (mustRecord && !recordConsent) || busy || !view.ai_enabled || !SpeechRecognition || mic !== 'ok' || (view.require_screen_share && !screenOn) || (view.require_fullscreen && multiDisplay)} onClick={start}>{busy ? 'Preparing your questions...' : 'Start interview'}</button>
        {busy && <p data-testid="start-working" className="mt-2 flex items-center gap-2 text-xs text-tertiary-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />The interviewer is writing your questions. This can take up to a minute - please keep this page open.</p>}
      </Shell>
    );
  }

  // ---- the interview ----
  const turns = view.transcript || [];
  const current = view.waiting_for_answer ? turns[turns.length - 1] : null;
  const history = turns.slice(0, current ? -1 : undefined);
  // Only an interview that is really being recorded pauses without the camera. One that was started before recording was switched on
  // (recording_on false) carries on without it; otherwise it would wait for a camera that is never started.
  const mustRecord = Boolean(view.recording_on);
  const typedAnswer = view.section === 'aptitude'; // aptitude / numerical answers are typed; every other answer is spoken
  const blocked = mustRecord && (!recording || Boolean(cameraProblem));
  const waitingForCamera = needsFirstChunk;
  const urgent = remaining != null && remaining <= 30;
  return (
    <Shell>
      {active && needScreen && !screenOn && (
        <div role="alertdialog" data-testid="screen-share-required" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6">
          <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-soft">
            <MonitorUp className="mx-auto h-8 w-8 text-warning-600" />
            <h2 className="mt-2 font-heading text-lg font-semibold text-tertiary-900">Share your entire screen</h2>
            <p className="mt-2 text-sm text-tertiary-700">This interview needs your entire screen to be shared. The interview stays covered until it is shared again, and the question timer keeps running.</p>
            {screenError && <p className="mt-2 text-xs text-warning-700">{screenError}</p>}
            <button type="button" className="btn-primary mt-4" onClick={shareAgain}>Share entire screen</button>
          </div>
        </div>
      )}
      {active && ((needFullscreen && !fsOk) || multiDisplay) && (
        <div role="alertdialog" data-testid="screen-rules" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6">
          <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-soft">
            <AlertTriangle className="mx-auto h-8 w-8 text-warning-600" />
            <h2 className="mt-2 font-heading text-lg font-semibold text-tertiary-900">{multiDisplay ? 'Use one screen only' : 'Full screen is required'}</h2>
            <p className="mt-2 text-sm text-tertiary-700">
              {multiDisplay
                ? 'A second display is connected. Please disconnect it or switch it off; the interview continues once only one screen is in use. This has been recorded.'
                : 'This interview runs in full screen so that nothing else is open next to it. Leaving full screen is recorded as a warning. The interview stays covered until you return, and the question timer keeps running.'}
            </p>
            {!multiDisplay && <button type="button" className="btn-primary mt-4" onClick={enterFullscreen}>Return to full screen</button>}
          </div>
        </div>
      )}
      <div className="select-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-heading text-base font-semibold text-tertiary-900">AI interview{view.role_title ? ` - ${view.role_title}` : ''}</h1>
            {view.section && <p className="text-xs text-tertiary-500">{SECTION_LABEL[view.section] || ''}</p>}
          </div>
          <div className="flex items-center gap-2">
            {remaining != null && <span data-testid="question-timer" className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${urgent ? 'bg-danger-50 text-danger-700' : 'bg-tertiary-100 text-tertiary-700'}`}><Clock className="h-3.5 w-3.5" />{clock(Math.max(0, remaining))}</span>}
            {recording && <span className="flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-xs text-danger-700"><span className="h-2 w-2 animate-pulse rounded-full bg-danger-600" />Recording</span>}
            <span className="text-xs text-tertiary-500">{view.answered} of {view.total_questions || '?'} answered</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-tertiary-100">
          <div className="h-full bg-primary-500 transition-all" style={{ width: `${Math.min(100, Math.round((view.answered / (view.total_questions || 1)) * 100))}%` }} />
        </div>
        {recording && <video ref={videoRef} autoPlay muted playsInline className="mt-3 h-24 w-32 rounded-lg bg-black object-cover" />}
        {warning && (
          <div role="alert" data-testid="integrity-warning" className="mt-3 flex items-start gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-warning-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{warning}</span>
            <button type="button" className="font-medium underline" onClick={() => setWarning('')}>OK</button>
          </div>
        )}

        <div className="mt-4 max-h-44 space-y-2 overflow-y-auto text-sm sm:max-h-64">
          {history.map((t, i) => (
            <div key={i} className={t.role === 'ai' ? 'text-tertiary-700' : 'ml-6 rounded-lg bg-primary-50 px-3 py-2 text-tertiary-800'}>
              {t.role === 'ai' ? <span><span className="font-medium">Interviewer:</span> {t.text}</span> : t.text}
            </div>
          ))}
        </div>

        {blocked && (
          <div role="alertdialog" data-testid="camera-required" className="mt-4 rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800">
            <p className="font-medium">The camera and microphone are required for this interview.</p>
            <p className="mt-1 text-xs">{cameraProblem || 'Starting the camera...'} The interview is paused until the recording is back on.</p>
            <button type="button" className="btn-primary mt-3 text-xs" onClick={retryCamera}>Turn the camera on</button>
          </div>
        )}

        {current && (
          <div ref={questionRef} className="mt-4 rounded-xl border border-primary-200 bg-primary-50/40 p-4">
            <p className="text-sm font-medium text-tertiary-900">{current.kind === 'follow_up' ? 'Follow-up: ' : ''}{current.text}</p>
            {typedAnswer ? (
              <textarea
                className="mt-3 min-h-[110px] w-full select-text rounded-lg border border-tertiary-200 p-3 text-sm focus:border-primary-500 focus:outline-none"
                placeholder="Type your answer"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                onCopy={(e) => e.preventDefault()}
                onCut={(e) => e.preventDefault()}
                onDrop={(e) => e.preventDefault()}
                disabled={busy || blocked}
              />
            ) : (
              // Spoken answers: no text box and no live transcript. The words are captured for the interviewer but never shown to the candidate.
              <div data-testid="spoken-answer-status" className="mt-3 flex min-h-[80px] items-center gap-3 rounded-lg border border-tertiary-200 bg-tertiary-50 p-3 text-sm text-tertiary-700">
                <Mic className={`h-5 w-5 shrink-0 ${listening ? 'animate-pulse text-danger-600' : 'text-tertiary-400'}`} />
                <span>
                  {listening ? 'Listening... speak your answer, then press "Stop speaking".'
                    : text.trim().length >= 2 ? 'Your answer has been recorded. Press "Send answer", or "Clear and speak again".'
                      : 'Press "Speak your answer" and talk. Answers are spoken only; nothing is typed or shown on screen.'}
                </span>
              </div>
            )}
            {speechNote && <p data-testid="speech-note" className="mt-2 text-xs text-warning-800">{speechNote}</p>}
            {waitingForCamera && !stalled && <p className="mt-2 text-xs text-tertiary-500">Waiting for the camera recording to start...</p>}
            {waitingForCamera && stalled && (
              <p className="mt-2 text-xs text-warning-800" data-testid="recording-stalled">The recording could not be saved yet. Check your internet connection and <button type="button" className="font-medium underline" onClick={retryCamera}>try again</button>.</p>
            )}
            {busy && <p data-testid="interviewer-working" className="mt-2 flex items-center gap-2 text-xs text-tertiary-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />The interviewer is reading your answer. This can take up to a minute - please keep this page open.</p>}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {typedAnswer ? <span /> : <div className="flex items-center gap-2">
                <button type="button" className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${listening ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-primary-300 bg-primary-50 text-primary-800'}`} onClick={toggleListening} disabled={busy || blocked || !SpeechRecognition}>
                  {listening ? <><MicOff className="h-4 w-4" /> Stop speaking</> : <><Mic className="h-4 w-4" /> Speak your answer</>}
                </button>
                {text && !listening && <button type="button" className="text-xs text-tertiary-600 underline" disabled={busy || blocked} onClick={() => setText('')}>Clear and speak again</button>}
              </div>}
              <button type="button" className="btn-primary" disabled={busy || blocked || waitingForCamera || text.trim().length < 2} onClick={() => send()}>{busy ? 'Please wait...' : 'Send answer'}</button>
            </div>
          </div>
        )}
        {!current && noQuestionYet && (
          <div data-testid="next-question-pending" className="mt-4 flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50/40 p-4 text-sm text-tertiary-700">
            <Loader2 className="h-4 w-4 animate-spin" />Preparing your next question... this can take a few seconds.
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
      </div>

    </Shell>
  );
}
