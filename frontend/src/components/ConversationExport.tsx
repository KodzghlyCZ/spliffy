import { useTranslation } from 'react-i18next'
import { splitCitationsByContent, type Message } from '../lib/streamState'
import { MessageContent } from './MessageContent'
import './ConversationExport.css'

type ConversationExportProps = {
  messages: Message[]
  assistantName: string
  userLabel: string
  markdown: boolean
}

export function printConversation(title: string) {
  const previous = document.title
  document.title = title
  const restore = () => {
    document.title = previous
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}

export function ConversationExport({
  messages,
  assistantName,
  userLabel,
  markdown,
}: ConversationExportProps) {
  const { t, i18n } = useTranslation()
  const printable = messages.filter((message) => message.content.trim().length > 0)

  if (printable.length === 0) {
    return null
  }

  const generatedAt = new Date().toLocaleString(i18n.language, {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  return (
    <div className="conversation-export">
      <header className="conversation-export__header">
        <h1>{assistantName}</h1>
        <p>
          {t('chat.exportPdfTitle')} · {generatedAt}
        </p>
      </header>

      {printable.map((message) => {
        const isUser = message.role === 'user'
        const { cited, other } = splitCitationsByContent(message.content, message.citations)
        const sources = [...cited, ...other]

        return (
          <article
            key={message.id}
            className={`conversation-export__turn conversation-export__turn--${message.role}`}
          >
            <h2>{isUser ? userLabel : assistantName}</h2>
            <div className="conversation-export__body">
              <MessageContent content={message.content} markdown={!isUser && markdown} />
            </div>
            {!isUser && sources.length > 0 ? (
              <section className="conversation-export__sources" aria-label={t('citations.label')}>
                <h3>{t('citations.label')}</h3>
                <ol>
                  {sources.map((source) => (
                    <li key={`${source.position}-${source.url ?? source.title}`}>
                      <span>{source.title}</span>
                      {source.url ? (
                        <>
                          {' — '}
                          <a href={source.url}>{source.url}</a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
