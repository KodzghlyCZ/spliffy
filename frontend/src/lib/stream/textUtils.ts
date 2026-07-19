export function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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
