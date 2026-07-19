import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../lib/streamState'
import { hasThinkingActivity, thinkingItemCount } from '../lib/streamState'
import './ThinkingPanel.css'

type ThinkingPanelProps = {
  message: Message
  streaming: boolean
}

export function ThinkingPanel({ message, streaming }: ThinkingPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(streaming)
  const bodyRef = useRef<HTMLDivElement>(null)
  const hasContent = hasThinkingActivity(message)
  const itemCount = thinkingItemCount(message)

  useEffect(() => {
    if (streaming) {
      setExpanded(true)
    }
  }, [streaming])

  useEffect(() => {
    if (!streaming || !expanded) {
      return
    }

    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [message.reasoning, message.items, expanded, streaming])

  if (!hasContent) {
    return null
  }

  const showExpanded = streaming ? true : expanded

  return (
    <div className={`thinking-panel ${streaming ? 'thinking-panel--streaming' : ''}`}>
      <button
        type="button"
        className="thinking-panel__header"
        onClick={() => {
          if (!streaming) {
            setExpanded((current) => !current)
          }
        }}
        aria-expanded={showExpanded}
        disabled={streaming}
      >
        <span className="thinking-panel__spark" aria-hidden="true">
          ✦
        </span>
        <span className="thinking-panel__title">
          {streaming ? t('chat.thinking.active') : t('chat.thinking.done')}
        </span>
        {streaming ? (
          <span className="thinking-panel__pulse" aria-hidden="true" />
        ) : (
          <span className="thinking-panel__meta">
            {t('chat.thinking.stepCount', { count: itemCount })}
          </span>
        )}
        {!streaming ? (
          <span className="thinking-panel__chevron" aria-hidden="true">
            {showExpanded ? '▾' : '▸'}
          </span>
        ) : null}
      </button>

      {showExpanded ? (
        <div ref={bodyRef} className="thinking-panel__body">
          {message.reasoning ? (
            <p className="thinking-panel__reasoning">
              {message.reasoning}
              {streaming ? <span className="thinking-panel__cursor" aria-hidden="true" /> : null}
            </p>
          ) : null}

          {message.items.length > 0 ? (
            <ul className="thinking-panel__items">
              {message.items.map((item) => (
                <li key={item.id} className="thinking-item">
                  <span className="thinking-item__marker" aria-hidden="true">
                    ·
                  </span>
                  <span className="thinking-item__text">{item.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
