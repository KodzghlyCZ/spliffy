import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowNode } from '../lib/streamState'
import './WorkflowProgress.css'

type WorkflowProgressProps = {
  nodes: WorkflowNode[]
  streaming: boolean
  compact?: boolean
}

function statusLabel(node: WorkflowNode, t: (key: string) => string) {
  if (node.status === 'running') {
    return t('chat.workflow.running')
  }
  if (node.status === 'failed') {
    return t('chat.workflow.failed')
  }
  if (node.status === 'stopped') {
    return t('chat.workflow.stopped')
  }
  return t('chat.workflow.done')
}

export function WorkflowProgress({ nodes, streaming, compact = false }: WorkflowProgressProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(!compact)

  if (nodes.length === 0) {
    return null
  }

  const runningNode = nodes.find((node) => node.status === 'running')
  const showExpanded = streaming && compact ? true : expanded

  return (
    <div className={`workflow-progress ${compact ? 'workflow-progress--compact' : ''}`}>
      <button
        type="button"
        className="workflow-progress__header"
        onClick={() => {
          if (!streaming || !compact) {
            setExpanded((current) => !current)
          }
        }}
        aria-expanded={showExpanded}
        disabled={streaming && compact}
      >
        <span>
          {streaming
            ? runningNode
              ? t('chat.workflow.runningNode', { node: runningNode.title })
              : t('chat.workflow.runningWorkflow')
            : t('chat.workflow.workflow')}
        </span>
        <span className="workflow-progress__count">
          {t('chat.workflow.nodeCount', { count: nodes.length })}
        </span>
        {!streaming || !compact ? (
          <span className="workflow-progress__chevron" aria-hidden="true">
            {showExpanded ? '▾' : '▸'}
          </span>
        ) : null}
      </button>

      {showExpanded ? (
        <ol className="workflow-progress__list">
          {nodes.map((node) => (
            <li key={node.id} className={`workflow-node workflow-node--${node.status}`}>
              <span className="workflow-node__indicator" aria-hidden="true">
                {node.status === 'running' ? '●' : node.status === 'failed' ? '✕' : '✓'}
              </span>
              <div className="workflow-node__body">
                <span className="workflow-node__title">{node.title}</span>
                <span className="workflow-node__meta">
                  {statusLabel(node, t)}
                  {node.elapsedTime != null
                    ? ` · ${t('chat.workflow.elapsed', { seconds: node.elapsedTime.toFixed(1) })}`
                    : ''}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
