import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CitationSource } from '../lib/streamState'
import './CitationSources.css'

const MAX_VISIBLE_CITATIONS = 8

type CitationSourcesProps = {
  citations: CitationSource[]
}

export function CitationSources({ citations }: CitationSourcesProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (citations.length === 0) {
    return null
  }

  const hasHidden = citations.length > MAX_VISIBLE_CITATIONS && !showAll
  const visibleCitations = hasHidden
    ? citations.slice(0, MAX_VISIBLE_CITATIONS)
    : citations

  return (
    <div className="citation-sources" aria-label={t('citations.label')}>
      <div className="citation-sources__chips">
        {visibleCitations.map((citation) => {
          const label = citation.title
          const chipKey = `${citation.position}-${citation.url ?? citation.title}`

          const chip = citation.url ? (
            <a
              key={chipKey}
              className="citation-chip"
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              title={citation.datasetName ?? label}
            >
              <span className="citation-chip__index">{citation.position}</span>
              <span className="citation-chip__label">{label}</span>
              <svg className="citation-chip__icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h7v2H7v10h10v-5h2v7H5V5Z"
                  fill="currentColor"
                />
              </svg>
            </a>
          ) : (
            <button
              key={chipKey}
              type="button"
              className="citation-chip citation-chip--static"
              onClick={() =>
                setExpanded(expanded === citation.position ? null : citation.position)
              }
              aria-expanded={expanded === citation.position}
            >
              <span className="citation-chip__index">{citation.position}</span>
              <span className="citation-chip__label">{label}</span>
            </button>
          )

          return chip
        })}
      </div>

      {citations.length > MAX_VISIBLE_CITATIONS ? (
        <button
          type="button"
          className="citation-sources__more"
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
        >
          {showAll
            ? t('citations.showLess')
            : t('citations.showMore', { count: citations.length - MAX_VISIBLE_CITATIONS })}
        </button>
      ) : null}

      {expanded !== null ? (
        <div className="citation-sources__detail">
          {citations
            .filter((citation) => citation.position === expanded)
            .map((citation) => (
              <div key={citation.position} className="citation-detail">
                <div className="citation-detail__title">{citation.title}</div>
                {citation.score !== undefined ? (
                  <div className="citation-detail__meta">
                    {t('citations.score', { score: citation.score.toFixed(2) })}
                  </div>
                ) : null}
                {citation.snippet ? (
                  <p className="citation-detail__snippet">{citation.snippet}</p>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  )
}
