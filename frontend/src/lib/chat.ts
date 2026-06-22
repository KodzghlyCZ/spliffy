import { apiFetch, apiPath } from './api'

export type ChatConfig = {
  enabled: boolean
}

export type ChatMessageRequest = {
  query: string
  conversation_id?: string
  inputs?: Record<string, unknown>
}

export type DifyStreamEvent = {
  event: string
  answer?: string
  conversation_id?: string
  message_id?: string
  message?: string
}

export type ChatParameters = {
  opening_statement: string
  suggested_questions: string[]
}

export function fetchChatConfig() {
  return apiFetch<ChatConfig>('/chat/config')
}

export function fetchChatParameters() {
  return apiFetch<ChatParameters>('/chat/parameters')
}

function parseSseChunk(buffer: string): { events: DifyStreamEvent[]; rest: string } {
  const events: DifyStreamEvent[] = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''

  for (const part of parts) {
    const line = part
      .split('\n')
      .find((entry) => entry.startsWith('data:'))
    if (!line) {
      continue
    }

    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      continue
    }

    try {
      events.push(JSON.parse(payload) as DifyStreamEvent)
    } catch {
      // Ignore malformed chunks from the stream.
    }
  }

  return { events, rest }
}

export async function streamChatMessage(
  body: ChatMessageRequest,
  onEvent: (event: DifyStreamEvent) => void,
): Promise<void> {
  const response = await fetch(apiPath('/chat/messages'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: body.query,
      conversation_id: body.conversation_id ?? '',
      inputs: body.inputs ?? {},
    }),
  })

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Streaming is not supported in this browser')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseChunk(buffer)
    buffer = parsed.rest
    for (const event of parsed.events) {
      onEvent(event)
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseChunk(`${buffer}\n\n`)
    for (const event of parsed.events) {
      onEvent(event)
    }
  }
}
