import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CATEGORY_ICON, CATEGORY_LABEL, SKILLS_CATALOG } from '../../lib/skillsCatalog.js';

const MAX_SUGGESTIONS = 8;

/**
 * Searchable, chip-based multi-select for skills/tech stack. Suggests from
 * the curated SKILLS_CATALOG (with a category icon) but always allows
 * adding free text, since the backend stores a plain string array.
 *
 * Args:
 *   value: string[] currently selected skills.
 *   onChange: called with the next string[].
 */
export default function SkillPicker({ value = [], onChange, placeholder = 'Search or type a skill…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedLower = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SKILLS_CATALOG.filter(
      (skill) => skill.label.toLowerCase().includes(q) && !selectedLower.has(skill.label.toLowerCase())
    ).slice(0, MAX_SUGGESTIONS);
  }, [query, selectedLower]);

  const exactCatalogMatch = SKILLS_CATALOG.some((skill) => skill.label.toLowerCase() === query.trim().toLowerCase());
  const showCustomOption = query.trim().length > 0 && !exactCatalogMatch && !selectedLower.has(query.trim().toLowerCase());

  function addSkill(label) {
    const trimmed = label.trim();
    if (!trimmed || selectedLower.has(trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setQuery('');
  }

  function removeSkill(label) {
    onChange(value.filter((v) => v !== label));
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestions[0]) addSkill(suggestions[0].label);
      else if (query.trim()) addSkill(query);
    } else if (event.key === 'Backspace' && !query && value.length > 0) {
      removeSkill(value[value.length - 1]);
    }
  }

  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((skill) => {
            const catalogEntry = SKILLS_CATALOG.find((s) => s.label.toLowerCase() === skill.toLowerCase());
            const Icon = CATEGORY_ICON[catalogEntry?.category] || CATEGORY_ICON.other;
            return (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-0.5 pl-2 pr-1 text-xs text-primary-700"
              >
                <Icon className="h-3 w-3" />
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={`Remove ${skill}`}
                  className="rounded-full p-0.5 text-primary-500 hover:bg-primary-100 hover:text-primary-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded border border-tertiary-200 bg-white px-2 py-1.5 text-sm text-tertiary-900"
      />
      {open && query.trim() && (suggestions.length > 0 || showCustomOption) && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-white shadow-drawer">
          {suggestions.map((skill) => {
            const Icon = CATEGORY_ICON[skill.category] || CATEGORY_ICON.other;
            return (
              <li key={skill.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addSkill(skill.label)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-primary-50"
                >
                  <Icon className="h-3.5 w-3.5 text-tertiary-400" />
                  <span className="text-tertiary-900">{skill.label}</span>
                  <span className="ml-auto text-xs text-tertiary-400">{CATEGORY_LABEL[skill.category]}</span>
                </button>
              </li>
            );
          })}
          {showCustomOption && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSkill(query)}
                className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-sm text-tertiary-600 hover:bg-primary-50"
              >
                Add custom: <span className="font-medium text-tertiary-900">&ldquo;{query.trim()}&rdquo;</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
