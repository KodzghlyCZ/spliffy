import { useTheme, type ThemePreference } from '../context/ThemeContext'
import './ThemeToggle.css'

const OPTIONS: { value: ThemePreference; label: string; title: string }[] = [
  { value: 'light', label: 'Light', title: 'Light mode' },
  { value: 'dark', label: 'Dark', title: 'Dark mode' },
  { value: 'system', label: 'System', title: 'Use system setting' },
]

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-toggle__btn${preference === option.value ? ' theme-toggle__btn--active' : ''}`}
          aria-pressed={preference === option.value}
          title={option.title}
          onClick={() => setPreference(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
