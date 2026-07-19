import type { DifyStreamEvent } from '../chat'
import type { AgentStep, ThinkingItem, WorkflowNode } from './types'
import { pickString } from './textUtils'
import { shouldIncludeStepThought } from './thinkingDisplay'

export function upsertThinkingItem(items: ThinkingItem[], item: ThinkingItem): ThinkingItem[] {
  const existingIndex = items.findIndex((entry) => entry.id === item.id)
  if (existingIndex >= 0) {
    const next = [...items]
    next[existingIndex] = { ...next[existingIndex], ...item }
    return next
  }

  return [...items, item]
}

function thoughtItem(
  id: string,
  text: string,
  status: ThinkingItem['status'],
  label?: string,
): ThinkingItem {
  return { id, kind: 'thought', label, text, status }
}

/** Parse agent_log SSE into a single displayable thinking item (or null). */
export function parseAgentLog(event: DifyStreamEvent): ThinkingItem | null {
  const log = event.data
  if (!log?.id) {
    return null
  }

  const metadata = log.metadata ?? {}
  const payload = log.data ?? {}
  const label = log.label ?? 'Step'
  const labelLower = label.toLowerCase()

  const thought =
    pickString(metadata.thought) ??
    pickString(payload.thought) ??
    pickString(payload.text)
  const action =
    pickString(metadata.action) ??
    pickString(payload.action) ??
    pickString(payload.tool_name)

  if (labelLower.includes('round') && !action && !thought) {
    return null
  }

  if (thought) {
    return thoughtItem(log.id, thought, log.status === 'running' ? 'running' : 'done', label)
  }

  if (action) {
    return thoughtItem(log.id, action, log.status === 'running' ? 'running' : 'done', label)
  }

  if (labelLower.includes('thought') || labelLower.includes('thinking')) {
    const fallback = pickString(payload.message) ?? pickString(payload.content)
    if (!fallback) {
      return null
    }
    return thoughtItem(log.id, fallback, log.status === 'running' ? 'running' : 'done', label)
  }

  return null
}

export function upsertAgentStep(steps: AgentStep[], event: DifyStreamEvent): AgentStep[] {
  const stepId = event.id ?? `step-${event.position ?? steps.length}`
  const position = event.position ?? steps.length
  const existingIndex = steps.findIndex((step) => step.id === stepId)
  const existing = existingIndex >= 0 ? steps[existingIndex] : undefined

  const nextStep: AgentStep = {
    id: stepId,
    position,
    thought: event.thought ?? existing?.thought,
    tool: event.tool ?? existing?.tool,
    toolInput: event.tool_input ?? existing?.toolInput,
    observation: event.observation ?? existing?.observation,
    status: event.observation || event.tool ? 'done' : 'running',
  }

  if (existingIndex >= 0) {
    const next = [...steps]
    next[existingIndex] = nextStep
    return next.sort((a, b) => a.position - b.position)
  }

  return [...steps, nextStep].sort((a, b) => a.position - b.position)
}

export function syncAgentStepItems(
  steps: AgentStep[],
  items: ThinkingItem[],
  content: string,
): ThinkingItem[] {
  let nextItems = items

  for (const step of steps) {
    if (!shouldIncludeStepThought(step.thought, step, content)) {
      continue
    }

    nextItems = upsertThinkingItem(
      nextItems,
      thoughtItem(`${step.id}-thought`, step.thought!, step.status),
    )
  }

  return nextItems
}

export function upsertWorkflowNode(
  nodes: WorkflowNode[],
  event: DifyStreamEvent,
  status: WorkflowNode['status'],
): WorkflowNode[] {
  const data = event.data
  if (!data?.id) {
    return nodes
  }

  const existingIndex = nodes.findIndex((node) => node.id === data.id)
  const existing = existingIndex >= 0 ? nodes[existingIndex] : undefined
  const nextNode: WorkflowNode = {
    id: data.id,
    nodeId: data.node_id ?? existing?.nodeId ?? data.id,
    title: data.title ?? existing?.title ?? data.node_type ?? data.node_id ?? 'Node',
    nodeType: data.node_type ?? existing?.nodeType,
    status,
    elapsedTime: data.elapsed_time ?? existing?.elapsedTime,
  }

  if (existingIndex >= 0) {
    const next = [...nodes]
    next[existingIndex] = nextNode
    return next
  }

  return [...nodes, nextNode]
}
