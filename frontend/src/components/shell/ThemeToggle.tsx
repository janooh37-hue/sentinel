/**
 * ThemeToggle — TopNav sliding switch flipping between light and dark.
 * Sun (right) marks light mode, moon (left) marks dark mode; the thumb
 * hides the active mode's icon and reveals the other. Parent owns the
 * value (we don't read localStorage here so the setting stays
 * single-sourced through the AppSettings query).
 */

type Theme = 'light' | 'dark'

interface Props {
  value: Theme
  onChange: (next: Theme) => void
}

export function ThemeToggle({ value, onChange }: Props): React.JSX.Element {
  const isDark = value === 'dark'
  return (
    <label className="theme-switch relative inline-block h-[30px] w-[56px] cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        checked={isDark}
        onChange={(e) => onChange(e.target.checked ? 'dark' : 'light')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="theme-switch-input absolute h-0 w-0 opacity-0"
      />
      <span className="theme-switch-slider absolute inset-0 cursor-pointer rounded-[30px] bg-[#73C0FC] transition-colors duration-300" />
      <span className="theme-switch-sun pointer-events-none absolute left-[32px] top-[6px] z-[1] block h-[18px] w-[18px]">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <g fill="#ffd43b">
            <circle r={5} cy={12} cx={12} />
            <path d="m21 13h-1a1 1 0 0 1 0-2h1a1 1 0 0 1 0 2zm-17 0h-1a1 1 0 0 1 0-2h1a1 1 0 0 1 0 2zm13.66-5.66a1 1 0 0 1 -.66-.29 1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.71.71a1 1 0 0 1 -.75.29zm-12.02 12.02a1 1 0 0 1 -.71-.29 1 1 0 0 1 0-1.41l.71-.66a1 1 0 0 1 1.41 1.41l-.71.71a1 1 0 0 1 -.7.24zm6.36-14.36a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1zm0 17a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1zm-5.66-14.66a1 1 0 0 1 -.7-.29l-.71-.71a1 1 0 0 1 1.41-1.41l.71.71a1 1 0 0 1 0 1.41 1 1 0 0 1 -.71.29zm12.02 12.02a1 1 0 0 1 -.7-.29l-.66-.71a1 1 0 0 1 1.36-1.36l.71.71a1 1 0 0 1 0 1.41 1 1 0 0 1 -.71.24z" />
          </g>
        </svg>
      </span>
      <span className="theme-switch-moon pointer-events-none absolute left-[6px] top-[4px] z-[1] block h-[18px] w-[18px]">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="#73C0FC">
          <path d="m223.5 32c-123.5 0-223.5 100.3-223.5 224s100 224 223.5 224c60.6 0 115.5-24.2 155.8-63.4 5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6-96.9 0-175.5-78.8-175.5-176 0-65.8 36-123.1 89.3-153.3 6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z" />
        </svg>
      </span>
      <style>{`
        .theme-switch .theme-switch-slider::before {
          content: '';
          position: absolute;
          height: 26px;
          width: 26px;
          left: 2px;
          bottom: 2px;
          z-index: 2;
          border-radius: 16px;
          background-color: #e8e8e8;
          transition: transform 0.4s;
        }
        .theme-switch .theme-switch-input:checked + .theme-switch-slider {
          background-color: #183153;
        }
        .theme-switch .theme-switch-input:focus-visible + .theme-switch-slider {
          box-shadow: 0 0 0 2px #183153;
        }
        .theme-switch .theme-switch-input:checked + .theme-switch-slider::before {
          transform: translateX(26px);
        }
        .theme-switch .theme-switch-sun svg {
          animation: theme-switch-sun-rotate 15s linear infinite;
        }
        .theme-switch .theme-switch-moon svg {
          animation: theme-switch-moon-tilt 5s linear infinite;
        }
        @keyframes theme-switch-sun-rotate {
          0%   { transform: rotate(0); }
          100% { transform: rotate(360deg); }
        }
        @keyframes theme-switch-moon-tilt {
          0%   { transform: rotate(0deg); }
          25%  { transform: rotate(-10deg); }
          75%  { transform: rotate(10deg); }
          100% { transform: rotate(0deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .theme-switch .theme-switch-sun svg,
          .theme-switch .theme-switch-moon svg {
            animation: none !important;
          }
          .theme-switch .theme-switch-slider::before {
            transition: none !important;
          }
        }
      `}</style>
    </label>
  )
}
