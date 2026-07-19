import type { DifyStreamEvent } from '../chat'
import type { Message } from './types'
import { appendReasoning, pickString } from './textUtils'
import {
  parseAgentLog,
  syncAgentStepItems,
  upsertAgentStep,
  upsertThinkingItem,
  upsertWorkflowNode,
} from './agentEvents'
import { alignCitationsToContent, parseRetrieverResources } from './citations'
import {
  finalizeThinkingDisplay,
  stripAnswerAfterContentUpdate,
} from './thinkingDisplay'

const ANSWER_EVENTS = new Set(['message', 'agent_message'])

export function createAssistantMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    reasoning: '',
    items: [],
    steps: [],
    workflowNodes: [],
    citations: [],
    streaming: true,
  }
}

export function getAnswerChunk(event: DifyStreamEvent): string {
  if (event.answer) {
    return event.answer
  }

  const text = event.data?.text
  return typeof text === 'string' ? text : ''
}

export function isAnswerEvent(event: DifyStreamEvent): boolean {
  if (ANSWER_EVENTS.has(event.event)) {
    return Boolean(getAnswerChunk(event))
  }

  return event.event === 'text_chunk' && Boolean(getAnswerChunk(event))
}

const THINKING_REFRESH_EVENTS = new Set([
  'agent_thought',
  'agent_log',
  'reasoning_chunk',
  'node_finished',
])

export function applyStreamEvent(message: Message, event: DifyStreamEvent): Message {
  let next = message

  if (isAnswerEvent(event)) {
    next = stripAnswerAfterContentUpdate({
      ...next,
      content: next.content + getAnswerChunk(event),
    })
  }

  if (event.event === 'reasoning_chunk') {
    const reasoning = event.data?.reasoning
    if (typeof reasoning === 'string') {
      next = {
        ...next,
        reasoning: appendReasoning(next.reasoning, reasoning),
      }
    }
  }

  if (event.event === 'agent_thought') {
    const steps = upsertAgentStep(next.steps, event)
    next = {
      ...next,
      steps,
      items: syncAgentStepItems(steps, next.items, next.content),
    }
  }

  if (event.event === 'agent_log') {
    const item = parseAgentLog(event)
    if (item) {
      next = {
        ...next,
        items: upsertThinkingItem(next.items, item),
      }
    }
  }

  if (event.event === 'node_started') {
    next = {
      ...next,
      workflowNodes: upsertWorkflowNode(next.workflowNodes, event, 'running'),
    }
  }

  if (event.event === 'node_finished') {
    const nodeStatus = event.data?.status
    const status: Message['workflowNodes'][number]['status'] =
      nodeStatus === 'failed' || nodeStatus === 'stopped' ? nodeStatus : 'succeeded'

    const outputs = event.data?.outputs
    const reasoningContent =
      outputs && typeof outputs === 'object'
        ? pickString((outputs as Record<string, unknown>).reasoning_content)
        : undefined

    let reasoning = next.reasoning
    if (reasoningContent) {
      if (!reasoning) {
        reasoning = reasoningContent
      } else if (!reasoning.includes(reasoningContent)) {
        reasoning = appendReasoning(reasoning, reasoningContent)
      }
    }

    next = {
      ...next,
      workflowNodes: upsertWorkflowNode(next.workflowNodes, event, status),
      reasoning,
    }
  }

  if (event.event === 'message_end' || event.event === 'workflow_finished') {
    let citations =
      event.event === 'message_end'
        ? parseRetrieverResources(event.metadata?.retriever_resources)
        : next.citations

    if (citations.length > 0) {
      citations = alignCitationsToContent(next.content, citations)
    }

    next = stripAnswerAfterContentUpdate({
      ...next,
      streaming: false,
      citations: citations.length > 0 ? citations : next.citations,
      steps: next.steps.map((step) =>
        step.status === 'running' ? { ...step, status: 'done' as const } : step,
      ),
      items: next.items.map((item) =>
        item.status === 'running' ? { ...item, status: 'done' as const } : item,
      ),
    })
  }

  if (THINKING_REFRESH_EVENTS.has(event.event)) {
    next = finalizeThinkingDisplay(next)
  }

  return next
}

export function hasThinkingActivity(message: Message): boolean {
  return (
    message.reasoning.trim().length > 0 ||
    message.items.length > 0 ||
    message.steps.length > 0
  )
}

export function hasAgentActivity(message: Message): boolean {
  return hasThinkingActivity(message) || message.workflowNodes.length > 0
}

export function thinkingItemCount(message: Message): number {
  const itemCount = message.items.length
  const stepCount = message.steps.length
  const hasReasoning = message.reasoning.trim().length > 0 ? 1 : 0
  return Math.max(itemCount, stepCount, hasReasoning)
}
