import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

/**
 * Shared pointer sensors for pipeline boards (avoids accidental clicks).
 */
export function usePipelineSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
}

/**
 * Droppable column shell for stage/status kanban boards.
 *
 * Args:
 *   id: Droppable id (usually the stage key).
 *   data: Optional dnd-kit data payload.
 *   isOver: Whether a drag is hovering this column.
 *   children: Column body.
 *   className: Extra classes on the droppable body.
 */
export function DroppableColumn({ id, data, isOver, children, className = '' }) {
  const { setNodeRef } = useDroppable({ id, data: data || { stage: id } });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 ${
        isOver ? 'bg-primary-50/70 ring-1 ring-inset ring-primary-200' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Draggable wrapper for a pipeline card.
 *
 * Args:
 *   id: Draggable id.
 *   data: dnd-kit data (must include enough to identify the entity + fromStage).
 *   disabled: When true, card is not draggable.
 *   children: Card content (receives isDragging as render-prop or element).
 */
export function DraggableCard({ id, data, disabled, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={disabled ? '' : 'cursor-grab active:cursor-grabbing'}
    >
      {typeof children === 'function' ? children({ isDragging }) : children}
    </div>
  );
}

export { DndContext, DragOverlay };
