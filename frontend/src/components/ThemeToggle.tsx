import { useTranslation } from 'react-i18next'
import { useTheme, type ThemePreference } from '../context/ThemeContext'
import './ThemeToggle.css'

const OPTIONS: { value: ThemePreference; labelKey: string; titleKey: string }[] = [
  { value: 'light', labelKey: 'theme.light', titleKey: 'theme.lightTitle' },
  { value: 'dark', labelKey: 'theme.dark', titleKey: 'theme.darkTitle' },
  { value: 'system', labelKey: 'theme.system', titleKey: 'theme.systemTitle' },
]

export function ThemeToggle() {
  const { t } = useTranslation()
  const { preference, setPreference } = useTheme()

  return (
    <div className="theme-toggle" role="group" aria-label={t('theme.ariaLabel')}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-toggle__btn${preference === option.value ? ' theme-toggle__btn--active' : ''}`}
          aria-pressed={preference === option.value}
          title={t(option.titleKey)}
          onClick={() => setPreference(option.value)}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  )
}
