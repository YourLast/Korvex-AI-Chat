export function Icon({ n, sm, className }: { n: string; sm?: boolean; className?: string }) {
  return (
    <svg className={`i${sm ? ' i--sm' : ''}${className ? ' ' + className : ''}`} aria-hidden="true" focusable="false">
      <use href={`#i-${n}`} />
    </svg>
  );
}
