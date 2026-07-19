import type { DifyRetrieverResource } from '../chat'
import type { CitationSource } from './types'
import { pickString } from './textUtils'

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

function citationUrlsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false
  }
  try {
    const left = new URL(a)
    const right = new URL(b)
    return (
      left.origin === right.origin &&
      left.pathname.replace(/\/$/, '') === right.pathname.replace(/\/$/, '') &&
      left.hash === right.hash
    )
  } catch {
    return a === b
  }
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

/** Reorder footer chips to match [n](url) numbering in the assistant answer. */
export function alignCitationsToContent(
  content: string,
  citations: CitationSource[],
): CitationSource[] {
  if (!content || citations.length === 0) {
    return citations
  }

  const inlinePattern = /\[(\d+)\]\((https?:\/\/[^)\s]+)\)/g
  const inlineByNumber = new Map<number, string>()
  let match: RegExpExecArray | null

  while ((match = inlinePattern.exec(content)) !== null) {
    const position = Number(match[1])
    const url = match[2]
    if (Number.isFinite(position) && position > 0 && !inlineByNumber.has(position)) {
      inlineByNumber.set(position, url)
    }
  }

  if (inlineByNumber.size === 0) {
    return citations
  }

  const used = new Set<CitationSource>()
  const aligned: CitationSource[] = []
  const orderedNumbers = [...inlineByNumber.keys()].sort((a, b) => a - b)

  for (const position of orderedNumbers) {
    const inlineUrl = inlineByNumber.get(position)
    const matched = citations.find(
      (citation) => !used.has(citation) && citationUrlsMatch(citation.url, inlineUrl),
    )

    if (matched) {
      used.add(matched)
      aligned.push({ ...matched, position })
    } else if (inlineUrl) {
      aligned.push({ position, title: inlineUrl, url: inlineUrl })
    }
  }

  let nextPosition = (orderedNumbers.at(-1) ?? 0) + 1
  for (const citation of citations) {
    if (!used.has(citation)) {
      aligned.push({ ...citation, position: nextPosition })
      nextPosition += 1
    }
  }

  return aligned
}

export function splitCitationsByContent(
  content: string,
  citations: CitationSource[],
): { cited: CitationSource[]; other: CitationSource[] } {
  if (citations.length === 0) {
    return { cited: [], other: [] }
  }

  const inlineUrls: string[] = []
  const inlinePattern = /\[(\d+)\]\((https?:\/\/[^)\s]+)\)/g
  let match: RegExpExecArray | null

  while ((match = inlinePattern.exec(content)) !== null) {
    inlineUrls.push(match[2])
  }

  if (inlineUrls.length === 0) {
    return { cited: [], other: citations }
  }

  const cited: CitationSource[] = []
  const other: CitationSource[] = []

  for (const citation of citations) {
    const isCited = inlineUrls.some((url) => citationUrlsMatch(citation.url, url))
    if (isCited) {
      cited.push(citation)
    } else {
      other.push(citation)
    }
  }

  cited.sort((a, b) => a.position - b.position)
  other.sort((a, b) => a.position - b.position)

  return { cited, other }
}
