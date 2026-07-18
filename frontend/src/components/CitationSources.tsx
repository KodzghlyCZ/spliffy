import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { splitCitationsByContent, type CitationSource } from '../lib/streamState'
import './CitationSources.css'

type CitationSourcesProps = {
  content: string
  citations: CitationSource[]
}

type CitationChipListProps = {
  citations: CitationSource[]
  showIndex: boolean
  muted?: boolean
}

function CitationChipList({ citations, showIndex, muted = false }: CitationChipListProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<number | null>(null)

  if (citations.length === 0) {
    return null
  }

  return (
    <>
      <div className={`citation-sources__chips${muted ? ' citation-sources__chips--muted' : ''}`}>
        {citations.map((citation) => {
          const label = citation.title
          const chipKey = `${citation.position}-${citation.url ?? citation.title}`

          if (citation.url) {
            return (
              <a
                key={chipKey}
                className="citation-chip"
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                title={citation.datasetName ?? label}
              >
                {showIndex ? (
                  <span className="citation-chip__index">{citation.position}</span>
                ) : null}
                <span className="citation-chip__label">{label}</span>
                <svg className="citation-chip__icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path
                    d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h7v2H7v10h10v-5h2v7H5V5Z"
                    fill="currentColor"
                  />
                </svg>
              </a>
            )
          }

          return (
            <button
              key={chipKey}
              type="button"
              className="citation-chip citation-chip--static"
              onClick={() =>
                setExpanded(expanded === citation.position ? null : citation.position)
              }
              aria-expanded={expanded === citation.position}
            >
              {showIndex ? (
                <span className="citation-chip__index">{citation.position}</span>
              ) : null}
              <span className="citation-chip__label">{label}</span>
            </button>
          )
        })}
      </div>

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
    </>
  )
}

export function CitationSources({ content, citations }: CitationSourcesProps) {
  const { t } = useTranslation()
  const [otherExpanded, setOtherExpanded] = useState(false)

  const { cited, other } = useMemo(
    () => splitCitationsByContent(content, citations),
    [content, citations],
  )

  if (citations.length === 0) {
    return null
  }

  return (
    <div className="citation-sources" aria-label={t('citations.label')}>
      {cited.length > 0 ? (
        <section className="citation-sources__section" aria-label={t('citations.citedLabel')}>
          <CitationChipList citations={cited} showIndex />
        </section>
      ) : null}

      {other.length > 0 ? (
        <section className="citation-sources__section citation-sources__section--other">
          <button
            type="button"
            className="citation-sources__other-toggle"
            onClick={() => setOtherExpanded((value) => !value)}
            aria-expanded={otherExpanded}
          >
            <span className="citation-sources__other-chevron" aria-hidden="true">
              {otherExpanded ? '▾' : '▸'}
            </span>
            {otherExpanded
              ? t('citations.otherHide')
              : t('citations.otherShow', { count: other.length })}
          </button>

          {otherExpanded ? (
            <CitationChipList citations={other} showIndex={false} muted />
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
