import Avatar from './Avatar.jsx';

/**
 * Overlapping avatar stack with optional overflow count.
 *
 * Args:
 *   people: Array of { id?, name }.
 *   max: Max faces before +N overflow.
 */
export default function AvatarStack({ people = [], max = 4 }) {
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((person, index) => (
        <Avatar
          key={person.id || `${person.name}-${index}`}
          name={person.name}
          size="sm"
          className="ring-2 ring-white"
        />
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-tertiary-100 text-[10px] font-semibold text-tertiary-600 ring-2 ring-white">
          +{overflow}
        </span>
      )}
    </div>
  );
}
