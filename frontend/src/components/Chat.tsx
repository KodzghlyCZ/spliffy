import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchChatConfig, streamChatMessage } from '../lib/chat'
import './Chat.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

function userInitial(userName?: string | null) {
  if (!userName) {
    return 'Y'
  }
  return userName.trim().charAt(0).toUpperCase() || 'Y'
}

export function Chat() {
  const { loading: authLoading, config: authConfig, user, login } = useAuth()
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const displayName = user?.name ?? user?.email ?? user?.preferred_username ?? null

  useEffect(() => {
    fetchChatConfig()
      .then((config) => setChatEnabled(config.enabled))
      .catch(() => setChatEnabled(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [input])

  if (authLoading || chatEnabled === null) {
    return <div className="chat-panel chat-status">Loading chat…</div>
  }

  if (!chatEnabled) {
    return <div className="chat-panel chat-status">Chat is not configured on the server.</div>
  }

  if (authConfig?.enabled && !user) {
    return (
      <div className="chat-panel chat-status">
        <div className="chat-status-card">
          <h2>Welcome to Spliffy</h2>
          <p>Sign in to start chatting with your assistant.</p>
          <button type="button" onClick={login}>
            Log in
          </button>
        </div>
      </div>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const query = input.trim()
    if (!query || sending) {
      return
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
    }
    const assistantId = crypto.randomUUID()

    setMessages((current) => [...current, userMessage])
    setMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      await streamChatMessage(
        { query, conversation_id: conversationId },
        (streamEvent) => {
          if (streamEvent.event === 'error') {
            setError(streamEvent.message ?? 'Chat failed')
            return
          }

          if (streamEvent.conversation_id) {
            setConversationId(streamEvent.conversation_id)
          }

          if (streamEvent.event === 'message' && streamEvent.answer) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + streamEvent.answer }
                  : message,
              ),
            )
          }
        },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
      setMessages((current) => current.filter((message) => message.id !== assistantId))
    } finally {
      setSending(false)
    }
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
          {messages.length === 0 ? (
            <div className="chat-empty">
              <h2>How can I help?</h2>
              <p>Ask a question to start the conversation.</p>
            </div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === 'user'
              const isStreaming = sending && !isUser && message.content === ''

              return (
                <article
                  key={message.id}
                  className={`chat-row chat-row--${message.role}`}
                >
                  <div
                    className={`chat-avatar chat-avatar--${message.role}`}
                    aria-hidden="true"
                  >
                    {isUser ? userInitial(displayName) : 'S'}
                  </div>
                  <div className="chat-bubble-wrap">
                    <div className="chat-meta">{isUser ? 'You' : 'Spliffy'}</div>
                    <div className={`chat-bubble chat-bubble--${message.role}`}>
                      {isStreaming ? (
                        <span className="chat-typing" aria-label="Assistant is typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        message.content
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
              placeholder="Message Spliffy…"
              rows={1}
              disabled={sending}
            />
            <button
              className="chat-send"
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L17 12l-10.8 1.4-2.8 7.2Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </form>
          <p className="chat-hint">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
    </div>
  )
}
