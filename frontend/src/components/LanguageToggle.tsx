import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n'
import './LanguageToggle.css'

const OPTIONS: { value: Language; labelKey: string; titleKey: string }[] = [
  { value: 'en', labelKey: 'language.en', titleKey: 'language.enTitle' },
  { value: 'cs', labelKey: 'language.cs', titleKey: 'language.csTitle' },
]

export function LanguageToggle() {
  const { t, i18n } = useTranslation()

  return (
    <div className="language-toggle" role="group" aria-label={t('language.ariaLabel')}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`language-toggle__btn${i18n.language === option.value ? ' language-toggle__btn--active' : ''}`}
          aria-pressed={i18n.language === option.value}
          title={t(option.titleKey)}
          onClick={() => void i18n.changeLanguage(option.value)}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  )
}
