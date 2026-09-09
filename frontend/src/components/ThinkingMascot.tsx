import { useEffect, useId, useState } from 'react'
import './ThinkingMascot.css'

type ThinkingMascotProps = {
  active: boolean
  label: string
}

type Phase = 'hidden' | 'in' | 'idle' | 'out'

export function ThinkingMascot({ active, label }: ThinkingMascotProps) {
  const reactId = useId().replace(/:/g, '')
  const faceGrad = `${reactId}-face`
  const shineGrad = `${reactId}-shine`
  const [phase, setPhase] = useState<Phase>(() => (active ? 'in' : 'hidden'))

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (active) {
      setPhase(reduced ? 'idle' : 'in')
      return
    }
    setPhase((current) => {
      if (current === 'hidden') {
        return current
      }
      return reduced ? 'hidden' : 'out'
    })
  }, [active])

  if (phase === 'hidden') {
    return null
  }

  return (
    <div
      className={`thinking-mascot thinking-mascot--${phase}`}
      role="img"
      aria-label={label}
    >
      <div className="thinking-mascot__stage">
        <span className="thinking-mascot__swirl" aria-hidden="true" />
        <div
          className="thinking-mascot__figure"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) {
              return
            }
            if (phase === 'in') {
              setPhase('idle')
            }
            if (phase === 'out') {
              setPhase('hidden')
            }
          }}
        >
          <svg className="thinking-mascot__svg" viewBox="0 0 128 148" aria-hidden="true">
            <defs>
              <linearGradient id={faceGrad} x1="18%" y1="8%" x2="88%" y2="92%">
                <stop className="thinking-mascot__stop-a" offset="0%" />
                <stop className="thinking-mascot__stop-b" offset="100%" />
              </linearGradient>
              <radialGradient id={shineGrad} cx="34%" cy="28%" r="62%">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
                <stop offset="55%" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
            </defs>

            <g className="thinking-mascot__bubbles">
              <circle className="thinking-mascot__bubble thinking-mascot__bubble--1" cx="90" cy="36" r="5.5" />
              <circle className="thinking-mascot__bubble thinking-mascot__bubble--2" cx="104" cy="20" r="8.5" />
              <circle className="thinking-mascot__bubble thinking-mascot__bubble--3" cx="118" cy="10" r="5" />
            </g>

            <g className="thinking-mascot__head">
              <circle cx="56" cy="86" r="38" fill={`url(#${faceGrad})`} />
              <circle cx="56" cy="86" r="38" fill={`url(#${shineGrad})`} />
              <path
                d="M36 67c6-9 16-11 24-5"
                fill="none"
                stroke="rgba(9,9,11,0.82)"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              <path
                d="M62 66c6 1 13-1 18-5"
                fill="none"
                stroke="rgba(9,9,11,0.82)"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              <ellipse cx="44" cy="80" rx="6.2" ry="7.2" fill="#fff" />
              <circle cx="46.4" cy="77.5" r="3.1" fill="#18181b" />
              <ellipse cx="68" cy="80" rx="6.2" ry="7.2" fill="#fff" />
              <circle cx="70.5" cy="77.5" r="3.1" fill="#18181b" />
              <path
                d="M46 99c7 7 18 6 24-1"
                fill="none"
                stroke="rgba(9,9,11,0.78)"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </g>

            <g className="thinking-mascot__hand">
              <ellipse
                cx="84"
                cy="116"
                rx="15"
                ry="10.5"
                fill={`url(#${faceGrad})`}
                transform="rotate(-28 84 116)"
              />
              <ellipse
                cx="94"
                cy="104"
                rx="7"
                ry="12"
                fill={`url(#${faceGrad})`}
                transform="rotate(-8 94 104)"
              />
              <ellipse cx="78" cy="122" rx="5" ry="7" fill={`url(#${faceGrad})`} />
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
