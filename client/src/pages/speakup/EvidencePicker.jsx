import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';
import { FILE_ACCEPT, MAX_FILES, fileSize } from './speakUp.js';

/** Supporting documents, screenshots and photographs (up to five files, 10 MB each). */
export default function EvidencePicker({ files, onChange, label = 'Supporting evidence (optional)' }) {
  const input = useRef(null);
  const add = (picked) => {
    const next = [...files];
    for (const file of picked) if (next.length < MAX_FILES && !next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
    onChange(next);
  };
  return (
    <div>
      <p className="text-xs font-medium text-tertiary-600">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => input.current?.click()} disabled={files.length >= MAX_FILES}>
          <Paperclip className="h-4 w-4" /> Add files
        </button>
        <span className="text-xs text-tertiary-500">Documents, screenshots or photos. Up to {MAX_FILES} files, 10 MB each.</span>
        <input ref={input} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; add(picked); }} />
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-tertiary-50 px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{file.name} <span className="text-xs text-tertiary-500">({fileSize(file.size)})</span></span>
              <button type="button" className="btn-ghost p-0.5" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, k) => k !== i))}><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
