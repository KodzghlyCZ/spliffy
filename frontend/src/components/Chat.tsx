import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchChatConfig, streamChatMessage } from '../lib/chat'
import './Chat.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
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

  useEffect(() => {
    fetchChatConfig()
      .then((config) => setChatEnabled(config.enabled))
      .catch(() => setChatEnabled(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  if (authLoading || chatEnabled === null) {
    return <div className="chat-status">Loading chat…</div>
  }

  if (!chatEnabled) {
    return <div className="chat-status">Chat is not configured on the server.</div>
  }

  if (authConfig?.enabled && !user) {
    return (
      <div className="chat-status">
        <p>Sign in to start chatting.</p>
        <button type="button" onClick={login}>
          Log in
        </button>
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

  return (
    <div className="chat">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <p className="chat-empty">Ask something to start the conversation.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`chat-message chat-message--${message.role}`}>
              <div className="chat-message-role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
              <div className="chat-message-content">
                {message.content || (sending ? '…' : '')}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error ? <div className="chat-error">{error}</div> : null}

      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          className="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Message…"
          rows={3}
          disabled={sending}
        />
        <button className="chat-send" type="submit" disabled={sending || !input.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
