import type { Components } from 'react-markdown'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './MessageContent.css'

type MessageContentProps = {
  content: string
  markdown?: boolean
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
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
