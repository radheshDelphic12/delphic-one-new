import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, MicOff, Video } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const RECORDER_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const SECTION_LABEL = { role: 'Role questions', aptitude: 'Aptitude' };

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
 * When the company records interviews and the candidate agrees, audio + video are sent to the server in small parts.
 */
export default function AiInterviewPage() {
  const { token } = useParams();
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recordConsent, setRecordConsent] = useState(false);
  const [mic, setMic] = useState('idle'); // idle | testing | ok | failed
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false);
  const recRef = useRef(null); // speech recognition
  const baseTextRef = useRef('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const seqRef = useRef(0);

  useEffect(() => {
    apiClient.get(`/public/ai-interviews/${token}`)
      .then(({ data }) => setView(data.data))
      .catch((err) => setError(apiErrorMessage(err, 'This link is not valid.')));
  }, [token]);

  // ---- recording: parts are uploaded one after another so the server can append them in order ----
  const uploadPart = useCallback((blob, seq, type) => {
    queueRef.current = queueRef.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await apiClient.post(`/public/ai-interviews/${token}/recording?seq=${seq}`, blob, { headers: { 'Content-Type': type } });
          return;
        } catch { /* retry; a recording problem never stops the interview */ }
      }
    });
  }, [token]);

  const startRecording = useCallback(async () => {
    try {
      const stream = streamRef.current || await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
      streamRef.current = stream;
      const type = RECORDER_TYPES.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
      if (!type) return;
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 500000, audioBitsPerSecond: 64000 });
      recorder.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        uploadPart(e.data, seqRef.current, type.split(';')[0]);
        seqRef.current += 1;
      };
      recorder.start(5000);
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setNotice('The camera could not be started, so this interview will continue without a recording.');
    }
  }, [uploadPart]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    }
    await queueRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }, []);

  useEffect(() => { if (recording && videoRef.current) videoRef.current.srcObject = streamRef.current; }, [recording]);
  useEffect(() => () => { recRef.current?.stop?.(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  // ---- microphone test ----
  async function testMic() {
    setMic('testing');
    try {
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
      const { data } = await apiClient.post(`/public/ai-interviews/${token}/start`, { consent: true, recording_consent: recordConsent });
      setView((v) => ({ ...v, ...data.data }));
      if (data.data.recording_on) startRecording();
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

  async function send() {
    recRef.current?.stop();
    setBusy(true);
    setError('');
    try {
      const { data } = await apiClient.post(`/public/ai-interviews/${token}/answer`, { text });
      setText('');
      setView((v) => ({ ...v, ...data.data }));
      if (data.data.done) {
        await stopRecording();
        setFinished(true);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Your answer could not be sent. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (finished || view?.status === 'completed') {
    return <Shell><h1 className="font-heading text-lg font-semibold">Thank you</h1><p className="mt-2 text-sm text-tertiary-600">Your interview is complete. The team will get in touch with you.</p></Shell>;
  }
  if (error && !view) return <Shell><p className="text-sm text-danger-700">{error}</p></Shell>;
  if (!view) return <Shell><p className="text-sm text-tertiary-500">Loading...</p></Shell>;

  // ---- before the start: what to expect, microphone test, consent ----
  if (view.status === 'invited') {
    return (
      <Shell>
        <h1 className="font-heading text-lg font-semibold text-tertiary-900">Interview for {view.role_title || 'the role'}</h1>
        <p className="mt-1 text-sm text-tertiary-600">Hello {view.candidate_name}. An AI interviewer will ask you questions one at a time. It takes about 15 to 20 minutes. You can speak or type your answers.</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-tertiary-700">
          <li>Use a quiet place and a recent Chrome or Edge browser for speaking; other browsers let you type.</li>
          <li>You can use this link once. If you close the page, open the same link to carry on where you stopped.</li>
          <li>There are a few short aptitude questions too. Work them out in your head and type the answer.</li>
          <li>The AI scores your answers; people at the company make the final decision.</li>
        </ul>
        <div className="mt-4 rounded-xl border border-tertiary-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-tertiary-800">Microphone test</p>
            <button type="button" className="btn-secondary text-xs" disabled={mic === 'testing'} onClick={testMic}>{mic === 'testing' ? 'Listening... say something' : 'Test microphone'}</button>
          </div>
          {mic === 'ok' && <p className="mt-2 text-xs text-success-700">Your microphone works.</p>}
          {mic === 'quiet' && <p className="mt-2 text-xs text-warning-700">We could not hear you. Check your microphone, or you can type your answers instead.</p>}
          {mic === 'failed' && <p className="mt-2 text-xs text-warning-700">The microphone is not available. You can type your answers instead.</p>}
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
              <span className="flex items-center gap-1 font-medium"><Video className="h-4 w-4" /> Record this interview (optional)</span>
              <span className="block text-xs text-tertiary-500">The company may record your audio and video for review. The recording is kept for {view.recording_days || 2} days and then deleted automatically. You can untick this and still take the interview.</span>
            </span>
          </label>
        )}
        {!view.ai_enabled && <p className="mt-3 text-xs text-warning-700">The interviewer is not switched on yet. Please try again later.</p>}
        {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
        <button type="button" className="btn-primary mt-5" disabled={!consent || busy || !view.ai_enabled} onClick={start}>{busy ? 'Starting...' : 'Start interview'}</button>
      </Shell>
    );
  }

  // ---- the interview ----
  const turns = view.transcript || [];
  const current = view.waiting_for_answer ? turns[turns.length - 1] : null;
  const history = turns.slice(0, current ? -1 : undefined);
  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-base font-semibold text-tertiary-900">AI interview{view.role_title ? ` - ${view.role_title}` : ''}</h1>
          {view.section && <p className="text-xs text-tertiary-500">{SECTION_LABEL[view.section] || ''}</p>}
        </div>
        <div className="flex items-center gap-2">
          {recording && <span className="flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-xs text-danger-700"><span className="h-2 w-2 animate-pulse rounded-full bg-danger-600" />Recording</span>}
          <span className="text-xs text-tertiary-500">{view.answered} of {view.total_questions || '?'} answered</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-tertiary-100">
        <div className="h-full bg-primary-500 transition-all" style={{ width: `${Math.min(100, Math.round((view.answered / (view.total_questions || 1)) * 100))}%` }} />
      </div>
      {recording && <video ref={videoRef} autoPlay muted playsInline className="mt-3 h-24 w-32 rounded-lg bg-black object-cover" />}
      {notice && <p className="mt-2 text-xs text-warning-700">{notice}</p>}

      <div className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm">
        {history.map((t, i) => (
          <div key={i} className={t.role === 'ai' ? 'text-tertiary-700' : 'ml-6 rounded-lg bg-primary-50 px-3 py-2 text-tertiary-800'}>
            {t.role === 'ai' ? <span><span className="font-medium">Interviewer:</span> {t.text}</span> : t.text}
          </div>
        ))}
      </div>

      {current && (
        <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50/40 p-4">
          <p className="text-sm font-medium text-tertiary-900">{current.kind === 'follow_up' ? 'Follow-up: ' : ''}{current.text}</p>
          <textarea
            className="mt-3 min-h-[110px] w-full rounded-lg border border-tertiary-200 p-3 text-sm focus:border-primary-500 focus:outline-none"
            placeholder={view.section === 'aptitude' ? 'Type your answer' : 'Speak using the microphone, or type your answer here'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {SpeechRecognition && view.section !== 'aptitude' ? (
              <button type="button" className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${listening ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-tertiary-200 text-tertiary-700'}`} onClick={toggleListening} disabled={busy}>
                {listening ? <><MicOff className="h-4 w-4" /> Stop speaking</> : <><Mic className="h-4 w-4" /> Speak your answer</>}
              </button>
            ) : <span />}
            <button type="button" className="btn-primary" disabled={busy || text.trim().length < 2} onClick={send}>{busy ? 'Please wait...' : 'Send answer'}</button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
    </Shell>
  );
}
