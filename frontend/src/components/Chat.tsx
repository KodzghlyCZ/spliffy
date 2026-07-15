import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { fetchChatConfig, fetchChatParameters, streamChatMessage } from '../lib/chat'
import {
  applyStreamEvent,
  createAssistantMessage,
  hasAgentActivity,
  hasThinkingActivity,
  type Message,
} from '../lib/streamState'
import { ThinkingPanel } from './ThinkingPanel'
import { MessageContent } from './MessageContent'
import { WorkflowProgress } from './WorkflowProgress'
import './Chat.css'

function userInitial(userName: string | null | undefined, fallback: string) {
  if (!userName) {
    return fallback
  }
  return userName.trim().charAt(0).toUpperCase() || fallback
}

export function Chat() {
  const { t } = useTranslation()
  const { loading: authLoading, config: authConfig, user, login } = useAuth()
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null)
  const [chatbotName, setChatbotName] = useState('Spliffy')
  const [markdownEnabled, setMarkdownEnabled] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [openingStatement, setOpeningStatement] = useState('')
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const displayName = user?.name ?? user?.email ?? user?.preferred_username ?? null
  const hasUserMessages = messages.some((message) => message.role === 'user')

  useEffect(() => {
    fetchChatConfig()
      .then((config) => {
        setChatEnabled(config.enabled)
        if (config.name.trim()) {
          setChatbotName(config.name.trim())
        }
        setMarkdownEnabled(config.markdown ?? false)
      })
      .catch(() => setChatEnabled(false))
  }, [])

  useEffect(() => {
    if (authLoading || !chatEnabled || (authConfig?.enabled && !user)) {
      return
    }

    fetchChatParameters()
      .then((parameters) => {
        setOpeningStatement(parameters.opening_statement.trim())
        setSuggestedQuestions(
          parameters.suggested_questions.filter((question) => question.trim().length > 0),
        )
      })
      .catch(() => {
        // Opening message is optional; ignore load failures.
      })
  }, [authLoading, authConfig?.enabled, chatEnabled, user])

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [input])

  const sendQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed || sending) {
        return
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        reasoning: '',
        items: [],
        steps: [],
        workflowNodes: [],
        streaming: false,
      }
      const assistantId = crypto.randomUUID()

      setMessages((current) => [...current, userMessage, createAssistantMessage(assistantId)])
      setInput('')
      setSending(true)
      setError(null)

      try {
        await streamChatMessage(
          { query: trimmed, conversation_id: conversationId },
          (streamEvent) => {
            if (streamEvent.event === 'error') {
              setError(streamEvent.message ?? t('chat.failed'))
              return
            }

            if (streamEvent.conversation_id) {
              setConversationId(streamEvent.conversation_id)
            }

            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) {
                  return message
                }

                return applyStreamEvent(message, streamEvent)
              }),
            )
          },
        )

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, streaming: false } : message,
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chat.failed'))
        setMessages((current) => current.filter((message) => message.id !== assistantId))
      } finally {
        setSending(false)
      }
    },
    [conversationId, sending, t],
  )

  if (authLoading || chatEnabled === null) {
    return <div className="chat-panel chat-status">{t('chat.loading')}</div>
  }

  if (!chatEnabled) {
    return <div className="chat-panel chat-status">{t('chat.notConfigured')}</div>
  }

  if (authConfig?.enabled && !user) {
    return (
      <div className="chat-panel chat-status">
        <div className="chat-status-card">
          <h2>{t('chat.welcomeTitle')}</h2>
          <p>{t('chat.welcomeBody')}</p>
          <button type="button" onClick={login}>
            {t('auth.logIn')}
          </button>
        </div>
      </div>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await sendQuery(input)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <div className="chat">
      <div className="chat-thread">
        <div className="chat-messages">
          {!hasUserMessages ? (
            <div className="chat-empty">
              <h2>{chatbotName}</h2>
              <div className="chat-empty__intro">
                <MessageContent
                  content={openingStatement || t('chat.emptyBody')}
                  markdown={markdownEnabled && Boolean(openingStatement)}
                />
              </div>
              {suggestedQuestions.length > 0 ? (
                <div className="chat-suggestions chat-suggestions--empty" aria-label={t('chat.suggestions')}>
                  {suggestedQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="chat-suggestion"
                      disabled={sending}
                      onClick={() => void sendQuery(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === 'user'
              const isStreaming = sending && message.streaming
              const showTyping =
                isStreaming && message.content === '' && !hasAgentActivity(message)

              return (
                <article
                  key={message.id}
                  className={`chat-row chat-row--${message.role}`}
                >
                  <div
                    className={`chat-avatar chat-avatar--${message.role}`}
                    aria-hidden="true"
                  >
                    {isUser ? userInitial(displayName, t('chat.you').charAt(0)) : 'S'}
                  </div>
                  <div className="chat-bubble-wrap">
                    <div className="chat-meta">{isUser ? t('chat.you') : chatbotName}</div>
                    {!isUser ? (
                      <>
                        <ThinkingPanel message={message} streaming={isStreaming} />
                        <WorkflowProgress
                          nodes={message.workflowNodes}
                          streaming={isStreaming}
                          compact={hasThinkingActivity(message)}
                        />
                      </>
                    ) : null}
                    <div className={`chat-bubble chat-bubble--${message.role}`}>
                      {showTyping ? (
                        <span className="chat-typing" aria-label={t('chat.typing')}>
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        <MessageContent
                          content={message.content}
                          markdown={!isUser && markdownEnabled}
                        />
                      )}
                    </div>
                  </div>
                </article>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-composer-shell">
          {error ? <div className="chat-error">{error}</div> : null}

          <form className="chat-composer" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.placeholder')}
              rows={1}
              disabled={sending}
            />
            <button
              className="chat-send"
              type="submit"
              disabled={sending || !input.trim()}
              aria-label={t('chat.send')}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L17 12l-10.8 1.4-2.8 7.2Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </form>
          <p className="chat-hint">{t('chat.hint')}</p>
        </div>
      </div>
    </div>
  )
}
