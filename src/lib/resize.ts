// Shared pointer-drag resize used by the left sidebar and the right panel.
// Tracks a horizontal drag from `startWidth`, clamps to [min, max], and reports
// each new width via `onWidth`. `direction` is +1 when the width grows as the
// pointer moves right (a left-edge handle) and -1 when it grows as the pointer
// moves left (a right-edge handle). A body class marks the drag so global
// styles (e.g. disabling text selection) can apply for its duration.
export function startPointerResize(opts: {
  event: PointerEvent;
  startWidth: number;
  min: number;
  max: number;
  direction: 1 | -1;
  bodyClass: string;
  onWidth: (width: number) => void;
}) {
  opts.event.preventDefault();
  const startX = opts.event.clientX;
  document.body.classList.add(opts.bodyClass);

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const delta = (moveEvent.clientX - startX) * opts.direction;
    opts.onWidth(Math.min(opts.max, Math.max(opts.min, opts.startWidth + delta)));
  };

  const handlePointerUp = () => {
    document.body.classList.remove(opts.bodyClass);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
}
