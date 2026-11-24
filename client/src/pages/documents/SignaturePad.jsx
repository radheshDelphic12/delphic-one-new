import { useEffect, useRef, useState } from 'react';

const W = 560;
const H = 200;

/** Draw a signature with the mouse, a finger or a pen, or upload a picture of one. onSave(dataUrl) gets a PNG (a transparent background when drawn). */
export default function SignaturePad({ onSave, busy = false }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [empty, setEmpty] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  function down(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    setEmpty(false);
  }
  function move(e) {
    if (!drawing.current) return;
    const p = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  const up = () => { drawing.current = false; };
  function clear() {
    canvasRef.current.getContext('2d').clearRect(0, 0, W, H);
    setEmpty(true);
    setError('');
  }

  /** The drawing cropped to its ink, so the signature is not a small mark in a big empty box. */
  function trimmed() {
    const c = canvasRef.current;
    const data = c.getContext('2d').getImageData(0, 0, W, H).data;
    let minX = W; let minY = H; let maxX = 0; let maxY = 0;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (data[(y * W + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = 6;
    const sx = Math.max(minX - pad, 0); const sy = Math.max(minY - pad, 0);
    const sw = Math.min(maxX - minX + pad * 2, W - sx); const sh = Math.min(maxY - minY + pad * 2, H - sy);
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  }
  function saveDrawn() {
    const url = trimmed();
    if (!url) { setError('Draw your signature first.'); return; }
    setError('');
    onSave(url);
  }
  function fromFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) { setError('Use a PNG or JPEG picture.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 640 / img.width);
        const out = document.createElement('canvas');
        out.width = Math.round(img.width * scale); out.height = Math.round(img.height * scale);
        out.getContext('2d').drawImage(img, 0, 0, out.width, out.height);
        const png = out.toDataURL('image/png');
        const url = png.length < 700000 ? png : out.toDataURL('image/jpeg', 0.85);
        setError('');
        onSave(url);
      };
      img.onerror = () => setError('That picture could not be read.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2" data-testid="signature-pad">
      <div className="relative overflow-hidden rounded-xl border border-dashed border-tertiary-300 bg-white">
        <canvas ref={canvasRef} width={W} height={H} className="block h-40 w-full touch-none cursor-crosshair" aria-label="Draw your signature here" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} data-testid="signature-canvas" />
        {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-tertiary-400">Sign here with your mouse, finger or pen</p>}
      </div>
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={busy || empty} onClick={saveDrawn} data-testid="save-signature">{busy ? 'Saving…' : 'Save signature'}</button>
        <button type="button" className="btn-secondary" disabled={empty} onClick={clear}>Clear</button>
        <label className="btn-secondary cursor-pointer">Upload a picture instead<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={fromFile} data-testid="signature-file" /></label>
      </div>
    </div>
  );
}
