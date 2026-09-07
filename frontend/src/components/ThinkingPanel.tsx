import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message, ThinkingItem } from '../lib/streamState'
import { hasThinkingActivity, thinkingItemCount } from '../lib/streamState'
import { unwrapObservationText } from '../lib/stream/textUtils'
import { MessageContent } from './MessageContent'
import './ThinkingPanel.css'

type ThinkingPanelProps = {
  message: Message
  streaming: boolean
}

function observationMarkdown(item: ThinkingItem): string | undefined {
  if (item.kind === 'observation') {
    return unwrapObservationText(item.text)
  }
  return unwrapObservationText(item.detail)
}

export function ThinkingPanel({ message, streaming }: ThinkingPanelProps) {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const hasContent = hasThinkingActivity(message)
  const itemCount = thinkingItemCount(message)
  const answerStarted = message.content.trim().length > 0
  const expanded = userExpanded ?? !answerStarted
  const thinkingActive = streaming && !answerStarted

  useEffect(() => {
    if (!streaming || !expanded) {
      return
    }

    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [message.reasoning, message.items, expanded, streaming])

  if (!hasContent) {
    return null
  }

  return (
    <div
      className={[
        'thinking-panel',
        thinkingActive ? 'thinking-panel--streaming' : '',
        expanded ? '' : 'thinking-panel--collapsed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="thinking-panel__header"
        onClick={() => setUserExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="thinking-panel__spark" aria-hidden="true">
          ✦
        </span>
        <span className="thinking-panel__title">
          {thinkingActive ? t('chat.thinking.active') : t('chat.thinking.done')}
        </span>
        {thinkingActive ? (
          <span className="thinking-panel__pulse" aria-hidden="true" />
        ) : (
          <span className="thinking-panel__meta">
            {t('chat.thinking.stepCount', { count: itemCount })}
          </span>
        )}
        <span className="thinking-panel__chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      <div className="thinking-panel__collapse">
        <div className="thinking-panel__collapse-inner">
          <div ref={bodyRef} className="thinking-panel__body">
            {message.reasoning ? (
              <p className="thinking-panel__reasoning">
                {message.reasoning}
                {thinkingActive ? <span className="thinking-panel__cursor" aria-hidden="true" /> : null}
              </p>
            ) : null}

            {message.items.length > 0 ? (
              <ul className="thinking-panel__items">
                {message.items.map((item) => {
                  const body = observationMarkdown(item)
                  const isToolRow = item.kind === 'tool' || item.kind === 'observation' || Boolean(body)
                  const showLabel = item.kind !== 'observation'

                  return (
                    <li
                      key={item.id}
                      className={`thinking-item${isToolRow ? ' thinking-item--tool' : ''}`}
                    >
                      <span className="thinking-item__marker" aria-hidden="true">
                        ·
                      </span>
                      <div className="thinking-item__content">
                        {showLabel ? <span className="thinking-item__text">{item.text}</span> : null}
                        {body ? (
                          <div className="thinking-item__observation">
                            <MessageContent content={body} markdown />
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
