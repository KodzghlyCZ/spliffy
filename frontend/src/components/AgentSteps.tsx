import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentStep } from '../lib/streamState'
import './AgentSteps.css'

type AgentStepsProps = {
  steps: AgentStep[]
  streaming: boolean
}

function formatToolInput(toolInput?: string) {
  if (!toolInput) {
    return null
  }

  try {
    return JSON.stringify(JSON.parse(toolInput), null, 2)
  } catch {
    return toolInput
  }
}

export function AgentSteps({ steps, streaming }: AgentStepsProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  if (steps.length === 0) {
    return null
  }

  const showExpanded = streaming ? true : expanded
  const headerContent = (
    <>
      <span className="agent-steps__toggle-label">
        {streaming ? t('chat.agent.thinking') : t('chat.agent.thoughtProcess')}
      </span>
      <span className="agent-steps__toggle-meta">
        {t('chat.agent.stepCount', { count: steps.length })}
      </span>
      {!streaming ? (
        <span className="agent-steps__chevron" aria-hidden="true">
          {showExpanded ? '▾' : '▸'}
        </span>
      ) : null}
    </>
  )

  return (
    <div className="agent-steps">
      {streaming ? (
        <div className="agent-steps__toggle agent-steps__toggle--static" aria-live="polite">
          {headerContent}
        </div>
      ) : (
        <button
          type="button"
          className="agent-steps__toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={showExpanded}
        >
          {headerContent}
        </button>
      )}

      {showExpanded ? (
        <ol className="agent-steps__list">
          {steps.map((step) => (
            <li key={step.id} className={`agent-step agent-step--${step.status}`}>
              <div className="agent-step__header">
                <span className="agent-step__status" aria-hidden="true">
                  {step.status === 'running' ? '●' : '✓'}
                </span>
                <span className="agent-step__title">
                  {step.tool
                    ? t('chat.agent.callingTool', { tool: step.tool })
                    : t('chat.agent.reasoning')}
                </span>
              </div>

              {step.thought ? (
                <p className="agent-step__thought">{step.thought}</p>
              ) : null}

              {step.toolInput ? (
                <details className="agent-step__details">
                  <summary>{t('chat.agent.toolInput')}</summary>
                  <pre>{formatToolInput(step.toolInput)}</pre>
                </details>
              ) : null}

              {step.observation ? (
                <details className="agent-step__details" open={streaming && step.status === 'running'}>
                  <summary>{t('chat.agent.toolResult')}</summary>
                  <pre>{step.observation}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
