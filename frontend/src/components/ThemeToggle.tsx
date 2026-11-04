'use client';
import { setThemePreference, useIsDark, useThemePreference, type ThemePreference } from './theme';

/** Header icon button: flips between light and dark. */
export function ThemeToggle() {
  const dark = useIsDark();
  return (
    <button
      type="button"
      onClick={() => setThemePreference(dark ? 'light' : 'dark')}
      aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={dark ? '라이트 모드' : '다크 모드'}
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      {dark ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px]">
          <circle cx="10" cy="10" r="3.5" />
          <path
            d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.06 1.06M14.24 14.24l1.06 1.06M4.7 15.3l1.06-1.06M14.24 5.76l1.06-1.06"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px]">
          <path d="M16.5 12.2A6.5 6.5 0 0 1 7.8 3.5a6.5 6.5 0 1 0 8.7 8.7Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

/** Settings control: light / dark / follow the system. */
export function ThemeSelector() {
  const preference = useThemePreference();
  return (
    <div role="radiogroup" aria-label="화면 테마" className="inline-flex rounded-full bg-slate-100 p-1">
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setThemePreference(option.value)}
            className={`h-8 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
