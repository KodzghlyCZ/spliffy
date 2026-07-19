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
