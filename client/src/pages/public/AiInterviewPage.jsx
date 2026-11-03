import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Clock, Loader2, Mic, MicOff, Video } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const RECORDER_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const SECTION_LABEL = { role: 'Role questions', aptitude: 'Aptitude' };
const NO_ANSWER_TEXT = '[No answer - time ran out]';
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
 * a time; answers are spoken (live transcript) or typed. Closing the tab keeps progress (the link resumes where it stopped).
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
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const resumedRef = useRef(false);
  const partRef = useRef({ part: 0, stored: false }); // the recording part in progress and whether the server has stored a chunk of it
  const graceUntilRef = useRef(0);
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
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 500000, audioBitsPerSecond: 64000 });
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

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    }
    await queueRef.current;
    streamRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    setRecording(false);
  }, []);

  useEffect(() => { if (recording && videoRef.current) videoRef.current.srcObject = streamRef.current; }, [recording]);
  useEffect(() => () => { recRef.current?.stop?.(); streamRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); }, []);

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
    const block = (type) => (e) => { e.preventDefault(); report(type); setWarning('Copying, cutting and pasting are not allowed in this interview. Please type or speak your own answer.'); };
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
    const away = (kind) => { if (!awayRef.current && Date.now() > graceUntilRef.current) awayRef.current = { at: Date.now(), kind }; };
    const back = async () => {
      const gone = awayRef.current;
      awayRef.current = null;
      if (!gone || Date.now() < graceUntilRef.current) return;
      const seconds = (Date.now() - gone.at) / 1000;
      const res = await report(gone.kind, seconds);
      if (res && !res.ended) {
        const limit = view?.max_tab_switches;
        setWarning(`You left the interview page. This has been recorded${limit ? ` (${res.tab_switches} of ${limit} allowed)` : ''}.${limit ? ' If it happens again too often, the interview ends automatically.' : ''} Please stay on this page until you finish.`);
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
      // a recorded interview needs the camera before it begins, so a refusal is caught here and not halfway through
      if (view.recording_required) {
        graceUntilRef.current = Date.now() + GRACE_MS;
        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
        } catch {
          setError('This interview is recorded, so the camera and microphone must be allowed. Allow them in the browser (the camera icon in the address bar) and press Start again.');
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

  // ---- speaking: live transcript into the answer box (browsers without it simply type) ----
  function toggleListening() {
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SpeechRecognition();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    baseTextRef.current = text ? `${text.trim()} ` : '';
    rec.onresult = (e) => {
      let spoken = '';
      for (let i = 0; i < e.results.length; i += 1) spoken += e.results[i][0].transcript;
      setText(baseTextRef.current + spoken);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  const send = useCallback(async ({ timedOut = false } = {}) => {
    if (busyRef.current) return; // one send at a time: a double click, or the timer firing while an answer is on its way
    recRef.current?.stop();
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
      for (let i = 0; i < 10 && err?.response?.status === 409 && fresh && !fresh.gone && fresh.answered <= answeredBefore; i += 1) {
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
    return <Shell><h1 className="font-heading text-lg font-semibold">Interview ended</h1><p className="mt-2 text-sm text-tertiary-600">This interview was ended because the page was left too many times. The answers you gave have been saved and the team will review them and get in touch with you.</p></Shell>;
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
        <p className="mt-1 text-sm text-tertiary-600">Hello {view.candidate_name}. An AI interviewer will ask you questions one at a time. It takes about 15 to 20 minutes. You can speak or type your answers.</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-tertiary-700">
          <li>Use a quiet place and a recent Chrome or Edge browser for speaking; other browsers let you type.</li>
          <li>You can use this link once. If you close the page, open the same link to carry on where you stopped.</li>
          <li>There are a few short aptitude questions too. Work them out in your head and type the answer.</li>
          {view.answer_seconds > 0 && <li>Each question has a timer of {clock(view.answer_seconds)} minutes. When it ends, what you have typed is sent and the next question comes.</li>}
          <li>Stay on this page. Copying, pasting and right-click are blocked, and switching to another tab or window is recorded{view.max_tab_switches ? `; after ${view.max_tab_switches} times the interview ends automatically` : ''}.</li>
          {mustRecord && <li>This interview is recorded (camera and microphone) and the recording is required. Keep them on until you finish.</li>}
          <li>The AI scores your answers; people at the company make the final decision.</li>
        </ul>
        <div className="mt-4 rounded-xl border border-tertiary-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-tertiary-800">Microphone test</p>
            <button type="button" className="btn-secondary text-xs" disabled={mic === 'testing'} onClick={testMic}>{mic === 'testing' ? 'Listening... say something' : 'Test microphone'}</button>
          </div>
          {mic === 'ok' && <p className="mt-2 text-xs text-success-700">Your microphone works.</p>}
          {mic === 'quiet' && <p className="mt-2 text-xs text-warning-700">We could not hear you. Check your microphone, or you can type your answers instead.</p>}
          {mic === 'failed' && <p className="mt-2 text-xs text-warning-700">The microphone is not available. {mustRecord ? 'It is needed for the recording, so please allow it.' : 'You can type your answers instead.'}</p>}
          {!SpeechRecognition && <p className="mt-2 text-xs text-tertiary-500">This browser cannot turn speech into text, so you will type your answers.</p>}
        </div>
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
        <button type="button" className="btn-primary mt-5" disabled={!consent || (mustRecord && !recordConsent) || busy || !view.ai_enabled} onClick={start}>{busy ? 'Preparing your questions...' : 'Start interview'}</button>
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
  const blocked = mustRecord && (!recording || Boolean(cameraProblem));
  const waitingForCamera = needsFirstChunk;
  const urgent = remaining != null && remaining <= 30;
  return (
    <Shell>
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
            <textarea
              className="mt-3 min-h-[110px] w-full select-text rounded-lg border border-tertiary-200 p-3 text-sm focus:border-primary-500 focus:outline-none"
              placeholder={view.section === 'aptitude' ? 'Type your answer' : 'Speak using the microphone, or type your answer here'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              onCopy={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              disabled={busy || blocked}
            />
            {waitingForCamera && !stalled && <p className="mt-2 text-xs text-tertiary-500">Waiting for the camera recording to start...</p>}
            {waitingForCamera && stalled && (
              <p className="mt-2 text-xs text-warning-800" data-testid="recording-stalled">The recording could not be saved yet. Check your internet connection and <button type="button" className="font-medium underline" onClick={retryCamera}>try again</button>.</p>
            )}
            {busy && <p data-testid="interviewer-working" className="mt-2 flex items-center gap-2 text-xs text-tertiary-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />The interviewer is reading your answer. This can take up to a minute - please keep this page open.</p>}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {SpeechRecognition && view.section !== 'aptitude' ? (
                <button type="button" className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${listening ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-tertiary-200 text-tertiary-700'}`} onClick={toggleListening} disabled={busy || blocked}>
                  {listening ? <><MicOff className="h-4 w-4" /> Stop speaking</> : <><Mic className="h-4 w-4" /> Speak your answer</>}
                </button>
              ) : <span />}
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
