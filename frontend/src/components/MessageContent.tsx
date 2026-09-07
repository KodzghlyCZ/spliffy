import type { Components } from 'react-markdown'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { sanitizeCitationUrl } from '../lib/stream/citations'
import './MessageContent.css'

type MessageContentProps = {
  content: string
  markdown?: boolean
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const label = String(children ?? '')
    const isCitationRef = /^\[?\d+\]?$/.test(label.trim())
    const cleanHref = sanitizeCitationUrl(href)
    if (!cleanHref) {
      return <span>{children}</span>
    }
    return (
      <a
        href={cleanHref}
        target="_blank"
        rel="noopener noreferrer"
        className={isCitationRef ? 'citation-ref' : undefined}
      >
        {children}
      </a>
    )
  },
  pre: ({ children }) => <pre>{children}</pre>,
}

export function MessageContent({ content, markdown = false }: MessageContentProps) {
  if (!content) {
    return null
  }

  if (!markdown) {
    return <>{content}</>
  }

  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </Markdown>
    </div>
  )
}
