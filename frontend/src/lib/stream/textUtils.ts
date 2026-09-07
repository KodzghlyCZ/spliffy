export function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const OBSERVATION_TEXT_KEYS = [
  'text',
  'content',
  'markdown',
  'observation',
  'output',
  'result',
  'answer',
  'message',
  'response',
  'tool_response',
] as const

function stripOuterRules(text: string): string {
  const lines = text.trim().split('\n')
  const isRule = (line: string) => /^---+$/.test(line.trim())
  if (lines.length > 0 && isRule(lines[0])) {
    lines.shift()
  }
  if (lines.length > 0 && isRule(lines[lines.length - 1])) {
    lines.pop()
  }
  return lines.join('\n').trim()
}

function normalizeObservationText(text: string): string {
  let value = text.trim()
  if (value.toLowerCase().startsWith('tool response: ')) {
    value = value.slice('tool response: '.length).trim()
  }
  if (value.includes('\\n') && (value.match(/\n/g) ?? []).length <= 1) {
    value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  }
  return stripOuterRules(value)
}

/** Pull markdown out of Dify wrappers like `{"text": "## ...\\n..."}`. */
export function unwrapObservationText(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value == null) {
    return undefined
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const inner = unwrapObservationText(JSON.parse(trimmed) as unknown, depth + 1)
        if (inner) {
          return inner
        }
      } catch {
        // Keep the original string when it is not JSON.
      }
    }
    return normalizeObservationText(trimmed) || undefined
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => unwrapObservationText(item, depth + 1))
      .filter((item): item is string => Boolean(item))
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const toolResponses = record.tool_responses
    if (Array.isArray(toolResponses)) {
      const parts = toolResponses
        .map((item) =>
          unwrapObservationText(
            item && typeof item === 'object' && 'tool_response' in item
              ? (item as { tool_response?: unknown }).tool_response
              : item,
            depth + 1,
          ),
        )
        .filter((item): item is string => Boolean(item))
      if (parts.length > 0) {
        return parts.join('\n\n')
      }
    }

    for (const key of OBSERVATION_TEXT_KEYS) {
      const inner = unwrapObservationText(record[key], depth + 1)
      if (inner) {
        return inner
      }
    }

    if (record.data && typeof record.data === 'object') {
      const inner = unwrapObservationText(record.data, depth + 1)
      if (inner) {
        return inner
      }
    }
  }

  return undefined
}

export function normalizeThinkingText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export function normalizeComparableText(text: string): string {
  return normalizeThinkingText(text).toLowerCase()
}

export function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) {
    index += 1
  }
  return index
}

export function appendReasoning(current: string, chunk: string): string {
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
