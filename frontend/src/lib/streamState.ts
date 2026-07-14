import type { DifyStreamEvent } from './chat'

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

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps: AgentStep[]
  workflowNodes: WorkflowNode[]
  streaming: boolean
}

const ANSWER_EVENTS = new Set(['message', 'agent_message'])

export function createAssistantMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    steps: [],
    workflowNodes: [],
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

export function applyStreamEvent(message: Message, event: DifyStreamEvent): Message {
  let next = message

  if (isAnswerEvent(event)) {
    next = {
      ...next,
      content: next.content + getAnswerChunk(event),
    }
  }

  if (event.event === 'agent_thought') {
    next = {
      ...next,
      steps: upsertAgentStep(next.steps, event),
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

    next = {
      ...next,
      workflowNodes: upsertWorkflowNode(next.workflowNodes, event, status),
    }
  }

  if (event.event === 'message_end' || event.event === 'workflow_finished') {
    next = {
      ...next,
      streaming: false,
      steps: next.steps.map((step) =>
        step.status === 'running' ? { ...step, status: 'done' as const } : step,
      ),
    }
  }

  return next
}

export function hasAgentActivity(message: Message): boolean {
  return message.steps.length > 0 || message.workflowNodes.length > 0
}
