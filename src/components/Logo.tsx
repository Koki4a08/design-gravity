/**
 * The Design Gravity mark: two isolines of a well, pulled down toward the
 * mass at their centre. Same geometry as the app icon (src-tauri/icons/source.svg).
 */
export function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="4">
        <circle cx="32" cy="30" r="26" strokeOpacity="0.38" />
        <circle cx="32" cy="36.5" r="14" />
      </g>
      <circle cx="32" cy="40" r="7.5" fill="var(--magenta)" />
    </svg>
  );
}
