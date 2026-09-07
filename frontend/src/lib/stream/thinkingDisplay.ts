import type { AgentStep, Message, ThinkingItem } from './types'
import { normalizeComparableText, normalizeThinkingText, sharedPrefixLength } from './textUtils'

const ANSWER_OVERLAP_MIN_CHARS = 120

export const TOOL_STATUS_PREFIXES = [
  'Hledám',
  'Ověřuji',
  'Prohledávám',
  'Načítám',
  'Kontroluji',
  'Používám ',
  'Using ',
  'Searching',
  'Verifying',
  'Fetching',
  'Checking',
] as const

export function isToolStatusLine(text: string): boolean {
  const line = text.trim()
  if (!line) {
    return false
  }
  if (TOOL_STATUS_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return true
  }
  if (line.length > 140 || line.includes('**') || /^[-*]\s/.test(line)) {
    return false
  }
  return line.length <= 100
}

export function isToolStatusLabel(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return false
  }
  return lines.every(isToolStatusLine)
}

function textOverlapsAnswer(text: string, content: string): boolean {
  const textNorm = normalizeComparableText(text)
  const contentNorm = normalizeComparableText(content)
  if (!textNorm || !contentNorm) {
    return false
  }

  if (textNorm.length >= ANSWER_OVERLAP_MIN_CHARS && contentNorm.includes(textNorm)) {
    return true
  }
  if (contentNorm.length >= ANSWER_OVERLAP_MIN_CHARS && textNorm.includes(contentNorm)) {
    return true
  }

  return sharedPrefixLength(textNorm, contentNorm) >= ANSWER_OVERLAP_MIN_CHARS
}

function isLikelyFinalAnswerProse(text: string, step?: AgentStep): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 200 || step?.tool) {
    return false
  }

  if (/^\*\*[^*]+\*\*/.test(trimmed) || /^#{1,3}\s/.test(trimmed)) {
    return true
  }
  if (/^\d+\.\s+\*\*/.test(trimmed)) {
    return true
  }
  if (trimmed.split(/\n\s*\n/).length >= 2 && trimmed.length > 400) {
    return true
  }

  return trimmed.length > 600
}

export function shouldIncludeStepThought(
  text: string | undefined,
  step: AgentStep,
  content: string,
): text is string {
  if (!text?.trim()) {
    return false
  }
  if (textOverlapsAnswer(text, content)) {
    return false
  }
  if (isLikelyFinalAnswerProse(text, step)) {
    return false
  }
  return true
}

function isUsableToolLabel(text: string): boolean {
  return text.length <= 80 && !text.includes('\n') && !text.includes('**')
}

function isAnswerLike(text: string | undefined, content: string): boolean {
  if (!text?.trim()) {
    return false
  }
  return textOverlapsAnswer(text, content) || isLikelyFinalAnswerProse(text)
}

function sanitizeThinkingItem(item: ThinkingItem, content: string): ThinkingItem {
  if (!item.detail || !isAnswerLike(item.detail, content)) {
    return item
  }
  return { ...item, detail: undefined }
}

function shouldKeepThinkingItem(item: ThinkingItem, content: string): boolean {
  if (isAnswerLike(item.text, content)) {
    return false
  }

  if (item.kind === 'observation') {
    return !isLikelyFinalAnswerProse(item.text)
  }

  if (item.kind === 'tool') {
    return isToolStatusLabel(item.text) || isUsableToolLabel(item.text)
  }

  if (item.kind !== 'thought') {
    return true
  }

  if (!isToolStatusLabel(item.text)) {
    return false
  }

  return true
}

function expandToolStatusLines(items: ThinkingItem[]): ThinkingItem[] {
  const expanded: ThinkingItem[] = []

  for (const item of items) {
    const lines = item.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length <= 1 || !lines.every(isToolStatusLine)) {
      expanded.push(item)
      continue
    }

    lines.forEach((line, index) => {
      expanded.push({
        ...item,
        id: `${item.id}~${index}`,
        text: line,
      })
    })
  }

  return expanded
}

function dedupeThinkingItems(items: ThinkingItem[]): ThinkingItem[] {
  const kept: ThinkingItem[] = []

  for (const candidate of expandToolStatusLines(items)) {
    const candidateNorm = normalizeThinkingText(candidate.text)
    if (!candidateNorm) {
      continue
    }

    const duplicateIndex = kept.findIndex(
      (entry) => normalizeThinkingText(entry.text) === candidateNorm,
    )
    if (duplicateIndex >= 0) {
      kept[duplicateIndex] = {
        ...kept[duplicateIndex],
        ...candidate,
        id: kept[duplicateIndex].id,
        status:
          candidate.status === 'running' || kept[duplicateIndex].status === 'running'
            ? 'running'
            : 'done',
      }
      continue
    }

    for (let index = kept.length - 1; index >= 0; index -= 1) {
      const existingNorm = normalizeThinkingText(kept[index].text)
      if (
        candidateNorm.startsWith(existingNorm) &&
        candidateNorm.length > existingNorm.length + 2
      ) {
        kept.splice(index, 1)
      }
    }

    const subsumedByExisting = kept.some((entry) => {
      const existingNorm = normalizeThinkingText(entry.text)
      return (
        existingNorm.startsWith(candidateNorm) &&
        existingNorm.length > candidateNorm.length + 2
      )
    })
    if (subsumedByExisting) {
      continue
    }

    kept.push(candidate)
  }

  return kept
}

function dedupeReasoningAgainstItems(reasoning: string, items: ThinkingItem[]): string {
  if (!reasoning.trim() || items.length === 0) {
    return reasoning
  }

  const itemTexts = items.map((item) => normalizeThinkingText(item.text)).filter(Boolean)
  const filteredLines = reasoning
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      const lineNorm = normalizeThinkingText(line)
      if (!lineNorm) {
        return false
      }

      if (itemTexts.includes(lineNorm)) {
        return false
      }

      return !itemTexts.some(
        (itemText) =>
          itemText.startsWith(lineNorm) && itemText.length > lineNorm.length + 2,
      )
    })

  return filteredLines.join('\n').trim()
}

function stripAnswerFromThinking(message: Message): Message {
  const content = message.content
  const items = message.items
    .map((item) => sanitizeThinkingItem(item, content))
    .filter((item) => shouldKeepThinkingItem(item, content))

  let reasoning = message.reasoning
  if (textOverlapsAnswer(reasoning, content) || isLikelyFinalAnswerProse(reasoning)) {
    reasoning = ''
  }

  return { ...message, items, reasoning }
}

/** Normalize raw thinking items into display-ready state. */
export function finalizeThinkingDisplay(message: Message): Message {
  const sanitized = message.items.map((item) => sanitizeThinkingItem(item, message.content))
  const filtered = sanitized.filter((item) => shouldKeepThinkingItem(item, message.content))
  const items = dedupeThinkingItems(filtered)
  let reasoning = dedupeReasoningAgainstItems(message.reasoning, items)

  if (items.length > 0 && items.every((item) => isToolStatusLabel(item.text))) {
    reasoning = ''
  }

  return stripAnswerFromThinking({ ...message, items, reasoning })
}

export function stripAnswerAfterContentUpdate(message: Message): Message {
  return stripAnswerFromThinking(message)
}
