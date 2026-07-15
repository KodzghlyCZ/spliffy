import type { DifyRetrieverResource, DifyStreamEvent } from './chat'

export type ThinkingItemKind = 'thought' | 'tool' | 'observation' | 'log'

export type ThinkingItem = {
  id: string
  kind: ThinkingItemKind
  label?: string
  text: string
  detail?: string
  status: 'running' | 'done'
}

export type AgentStep = {
  id: string
  position: number
  thought?: string
  tool?: string
  toolInput?: string
  observation?: string
  status: 'running' | 'done'
}

export type WorkflowNode = {
  id: string
  nodeId: string
  title: string
  nodeType?: string
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  elapsedTime?: number
}

export type CitationSource = {
  position: number
  title: string
  url?: string
  datasetName?: string
  score?: number
  snippet?: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  items: ThinkingItem[]
  steps: AgentStep[]
  workflowNodes: WorkflowNode[]
  citations: CitationSource[]
  streaming: boolean
}

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

function upsertThinkingItem(items: ThinkingItem[], item: ThinkingItem): ThinkingItem[] {
  const existingIndex = items.findIndex((entry) => entry.id === item.id)
  if (existingIndex >= 0) {
    const next = [...items]
    next[existingIndex] = { ...next[existingIndex], ...item }
    return next
  }

  return [...items, item]
}

function parseAgentLog(event: DifyStreamEvent): ThinkingItem | null {
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
  const observation =
    pickString(metadata.observation) ??
    pickString(payload.observation) ??
    pickString(payload.output)

  if (labelLower.includes('round')) {
    const parts = [thought, action].filter(Boolean)
    if (parts.length === 0) {
      return null
    }

    return {
      id: log.id,
      kind: action ? 'tool' : 'thought',
      label,
      text: action ? action : (thought ?? label),
      detail: thought && action ? thought : observation ?? undefined,
      status: log.status === 'running' ? 'running' : 'done',
    }
  }

  if (thought) {
    return {
      id: log.id,
      kind: 'thought',
      label,
      text: thought,
      status: log.status === 'running' ? 'running' : 'done',
    }
  }

  if (action) {
    return {
      id: log.id,
      kind: 'tool',
      label,
      text: action,
      detail: observation ?? undefined,
      status: log.status === 'running' ? 'running' : 'done',
    }
  }

  if (observation) {
    return {
      id: log.id,
      kind: 'observation',
      label,
      text: observation,
      status: log.status === 'running' ? 'running' : 'done',
    }
  }

  if (labelLower.includes('thought') || labelLower.includes('thinking')) {
    const fallback = pickString(payload.message) ?? pickString(payload.content)
    if (!fallback) {
      return null
    }

    return {
      id: log.id,
      kind: 'thought',
      label,
      text: fallback,
      status: log.status === 'running' ? 'running' : 'done',
    }
  }

  return null
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pickCitationUrl(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) {
    return undefined
  }
  for (const key of ['url', 'source_url', 'file_url', 'link']) {
    const value = pickString(meta[key])
    if (value?.startsWith('http')) {
      return value
    }
  }
  return undefined
}

export function parseRetrieverResources(
  resources: DifyRetrieverResource[] | undefined,
): CitationSource[] {
  if (!resources?.length) {
    return []
  }

  const seen = new Set<string>()
  const citations: CitationSource[] = []

  for (const resource of resources) {
    const position = typeof resource.position === 'number' ? resource.position : citations.length + 1
    const title =
      pickString(resource.document_name) ??
      pickString(resource.dataset_name) ??
      `Source ${position}`
    const url = pickCitationUrl(resource.doc_metadata)
    const dedupeKey = `${url ?? ''}|${title}|${resource.segment_id ?? ''}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)

    citations.push({
      position,
      title,
      url,
      datasetName: pickString(resource.dataset_name),
      score: typeof resource.score === 'number' ? resource.score : undefined,
      snippet: pickString(resource.content),
    })
  }

  return citations.sort((a, b) => a.position - b.position)
}

function upsertAgentStep(steps: AgentStep[], event: DifyStreamEvent): AgentStep[] {
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

function syncAgentStepItems(steps: AgentStep[], items: ThinkingItem[]): ThinkingItem[] {
  let nextItems = items

  for (const step of steps) {
    if (step.thought) {
      nextItems = upsertThinkingItem(nextItems, {
        id: `${step.id}-thought`,
        kind: 'thought',
        text: step.thought,
        status: step.status,
      })
    }

    if (step.tool) {
      nextItems = upsertThinkingItem(nextItems, {
        id: `${step.id}-tool`,
        kind: 'tool',
        label: step.tool,
        text: step.tool,
        detail: step.toolInput,
        status: step.observation ? 'done' : step.status,
      })
    }

    if (step.observation) {
      nextItems = upsertThinkingItem(nextItems, {
        id: `${step.id}-observation`,
        kind: 'observation',
        label: step.tool,
        text: step.observation,
        status: 'done',
      })
    }
  }

  return nextItems
}

function upsertWorkflowNode(
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

function appendReasoning(current: string, chunk: string): string {
  if (!chunk) {
    return current
  }

  if (!current) {
    return chunk
  }

  if (chunk.startsWith(current) || current.endsWith(chunk)) {
    return chunk.startsWith(current) ? chunk : current
  }

  return current + chunk
}

export function applyStreamEvent(message: Message, event: DifyStreamEvent): Message {
  let next = message

  if (isAnswerEvent(event)) {
    next = {
      ...next,
      content: next.content + getAnswerChunk(event),
    }
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
      items: syncAgentStepItems(steps, next.items),
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
    const status: WorkflowNode['status'] =
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
    const citations =
      event.event === 'message_end'
        ? parseRetrieverResources(event.metadata?.retriever_resources)
        : next.citations

    next = {
      ...next,
      streaming: false,
      citations: citations.length > 0 ? citations : next.citations,
      steps: next.steps.map((step) =>
        step.status === 'running' ? { ...step, status: 'done' as const } : step,
      ),
      items: next.items.map((item) =>
        item.status === 'running' ? { ...item, status: 'done' as const } : item,
      ),
    }
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
