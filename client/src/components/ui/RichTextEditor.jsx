import { useEffect, useRef } from 'react';
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, Underline, Undo2 } from 'lucide-react';

const TOOLS = [
  { cmd: 'bold', Icon: Bold, label: 'Bold' },
  { cmd: 'italic', Icon: Italic, label: 'Italic' },
  { cmd: 'underline', Icon: Underline, label: 'Underline' },
  { cmd: 'formatBlock', arg: 'H2', Icon: Heading2, label: 'Heading' },
  { cmd: 'formatBlock', arg: 'H3', Icon: Heading3, label: 'Sub-heading' },
  { cmd: 'insertUnorderedList', Icon: List, label: 'Bulleted list' },
  { cmd: 'insertOrderedList', Icon: ListOrdered, label: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'BLOCKQUOTE', Icon: Quote, label: 'Quote' },
  { cmd: 'insertHorizontalRule', Icon: Minus, label: 'Divider' },
  { cmd: 'undo', Icon: Undo2, label: 'Undo' },
  { cmd: 'redo', Icon: Redo2, label: 'Redo' },
];

/**
 * Small rich-text editor (contentEditable + toolbar). Uncontrolled while typing:
 * `value` is only loaded when `resetKey` changes (switching to another document),
 * so the caret never jumps. The parent receives the HTML via `onChange`; the
 * server sanitizes it before storing.
 */
export default function RichTextEditor({ value, onChange, resetKey, placeholder = 'Start writing…', minHeight = '18rem' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load only when the document changes
  }, [resetKey]);

  function run(cmd, arg) {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current.innerHTML);
  }

  function addLink() {
    const url = window.prompt('Link address (https://…)');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) {
      window.alert('Only http(s) and mailto links are allowed.');
      return;
    }
    run('createLink', url.trim());
  }

  return (
    <div className="overflow-hidden rounded-xl border border-tertiary-200 bg-white">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-tertiary-100 bg-tertiary-50/60 p-1.5">
        {TOOLS.map(({ cmd, arg, Icon, label }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            // mousedown keeps the editor's selection; click would blur it first
            onMouseDown={(e) => { e.preventDefault(); run(cmd, arg); }}
            className="rounded-lg p-1.5 text-tertiary-600 hover:bg-white hover:text-tertiary-900"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <button
          type="button"
          title="Link"
          aria-label="Link"
          onMouseDown={(e) => { e.preventDefault(); addLink(); }}
          className="rounded-lg p-1.5 text-tertiary-600 hover:bg-white hover:text-tertiary-900"
        >
          <Link2 className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="policy-content policy-editor px-4 py-3 outline-none"
        style={{ minHeight }}
      />
    </div>
  );
}
