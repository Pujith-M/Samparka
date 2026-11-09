import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Contact } from './contact'
import {
  getTelHref,
  getWhatsAppHref,
  type ExternalContactAction,
} from './contactActions'

const SWIPE_THRESHOLD = 56

type ContactListItemProps = {
  contact: Contact
  revealedAction: ExternalContactAction | null
  onReveal: (action: ExternalContactAction | null) => void
  onOpen: () => void
}

export function ContactListItem({
  contact,
  revealedAction,
  onReveal,
  onOpen,
}: ContactListItemProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pointerStart = useRef<{
    x: number
    y: number
    control: Element | null
  } | null>(null)
  const suppressClick = useRef(false)
  const suppressedControl = useRef<Element | null>(null)
  const suppressClickTimer = useRef<number | undefined>(undefined)
  const [numberChoice, setNumberChoice] =
    useState<ExternalContactAction | null>(null)

  useEffect(() => {
    if (!revealedAction) return
    const closeWhenClickedOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setNumberChoice(null)
        onReveal(null)
      }
    }
    document.addEventListener('pointerdown', closeWhenClickedOutside)
    return () =>
      document.removeEventListener('pointerdown', closeWhenClickedOutside)
  }, [onReveal, revealedAction])

  useEffect(() => () => window.clearTimeout(suppressClickTimer.current), [])

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    window.clearTimeout(suppressClickTimer.current)
    suppressClickTimer.current = undefined
    suppressClick.current = false
    suppressedControl.current = null
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      control: (event.target as Element).closest('button, a'),
    }
  }

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) return

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (
      Math.abs(deltaX) < SWIPE_THRESHOLD ||
      Math.abs(deltaX) < Math.abs(deltaY) * 1.5
    )
      return

    suppressClick.current = true
    suppressedControl.current = start.control
    window.clearTimeout(suppressClickTimer.current)
    suppressClickTimer.current = window.setTimeout(() => {
      suppressClick.current = false
      suppressClickTimer.current = undefined
    }, 500)
    const swipedTowardCall = deltaX > 0
    if (
      (revealedAction === 'call' && !swipedTowardCall) ||
      (revealedAction === 'whatsapp' && swipedTowardCall)
    ) {
      setNumberChoice(null)
      onReveal(null)
    } else {
      setNumberChoice(null)
      onReveal(swipedTowardCall ? 'call' : 'whatsapp')
    }
  }

  const actionHref = (action: ExternalContactAction, phone: string) =>
    action === 'call' ? getTelHref(phone) : getWhatsAppHref(phone)

  const renderAction = (action: ExternalContactAction) => {
    const label = action === 'call' ? 'Call' : 'WhatsApp'
    const phone = contact.phoneNumbers[0]?.trim() ?? ''
    const href =
      contact.phoneNumbers.length === 1 ? actionHref(action, phone) : undefined
    const icon = action === 'call' ? '☎' : '◉'

    if (href)
      return (
        <a
          className={`swipe-action swipe-action-${action}`}
          href={href}
          aria-label={`${label} ${contact.name}`}
          target={action === 'whatsapp' ? '_blank' : undefined}
          rel={action === 'whatsapp' ? 'noopener noreferrer' : undefined}
        >
          <span aria-hidden="true">{icon}</span>
          {label}
        </a>
      )

    return (
      <button
        type="button"
        className={`swipe-action swipe-action-${action}`}
        onClick={() => setNumberChoice(action)}
        aria-label={label}
      >
        <span aria-hidden="true">{icon}</span>
        {label}
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`swipe-contact${revealedAction ? ` is-revealed reveal-${revealedAction}` : ''}`}
      data-testid={`contact-row-${contact.id}`}
      onPointerDown={pointerDown}
      onPointerUp={pointerUp}
      onPointerCancel={() => {
        pointerStart.current = null
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return
        const clickedControl = (event.target as Element).closest('button, a')
        if (clickedControl !== suppressedControl.current) {
          suppressClick.current = false
          suppressedControl.current = null
          window.clearTimeout(suppressClickTimer.current)
          suppressClickTimer.current = undefined
          return
        }
        event.preventDefault()
        event.stopPropagation()
        suppressClick.current = false
        suppressedControl.current = null
        window.clearTimeout(suppressClickTimer.current)
        suppressClickTimer.current = undefined
      }}
    >
      <div
        className={`swipe-actions${revealedAction ? ' is-visible' : ''}`}
        aria-hidden={!revealedAction}
      >
        {revealedAction === 'call' && renderAction('call')}
        {revealedAction === 'whatsapp' && renderAction('whatsapp')}
      </div>
      <button
        type="button"
        className="contact-card"
        onClick={() => {
          setNumberChoice(null)
          onReveal(null)
          onOpen()
        }}
        aria-label={`${contact.name}, ${contact.phoneNumbers[0] ?? 'no phone number'}`}
      >
        <span className="avatar" aria-hidden="true">
          {contact.name.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{contact.name}</strong>
          <small>{contact.phoneNumbers[0]}</small>
        </span>
        <span className="chevron" aria-hidden="true">
          →
        </span>
      </button>
      {numberChoice && (
        <PhoneNumberChoices
          contact={contact}
          action={numberChoice}
          onClose={() => setNumberChoice(null)}
        />
      )}
    </div>
  )
}

function PhoneNumberChoices({
  contact,
  action,
  onClose,
}: {
  contact: Contact
  action: ExternalContactAction
  onClose: () => void
}) {
  const label = action === 'call' ? 'Call' : 'WhatsApp'
  return (
    <fieldset className="phone-number-choices">
      <legend>Choose a number for {label.toLowerCase()}</legend>
      <button type="button" className="text-button" onClick={onClose}>
        Cancel
      </button>
      {contact.phoneNumbers.length === 0 ? (
        <p role="status">No phone number is saved for this contact.</p>
      ) : (
        contact.phoneNumbers.map((phone, index) => {
          const href = actionHref(action, phone)
          return (
            <div className="phone-choice" key={`${index}-${phone}`}>
              <span>
                Phone {index + 1}: {phone || 'Blank number'}
              </span>
              {href ? (
                <a
                  className="button button-secondary"
                  href={href}
                  target={action === 'whatsapp' ? '_blank' : undefined}
                  rel={
                    action === 'whatsapp' ? 'noopener noreferrer' : undefined
                  }
                >
                  {label} this number
                </a>
              ) : (
                <span className="action-unavailable" role="note">
                  {action === 'whatsapp'
                    ? 'This number is not valid for WhatsApp. Check its format.'
                    : 'This number cannot be used to place a call.'}
                </span>
              )}
            </div>
          )
        })
      )}
    </fieldset>
  )
}

function actionHref(action: ExternalContactAction, phone: string) {
  return action === 'call' ? getTelHref(phone) : getWhatsAppHref(phone)
}

export function ContactActionLinks({ contact }: { contact: Contact }) {
  return (
    <section
      className="contact-actions"
      aria-labelledby={`contact-actions-${contact.id}`}
    >
      <h2 id={`contact-actions-${contact.id}`}>Call or WhatsApp</h2>
      {contact.phoneNumbers.length === 0 ? (
        <p>No phone number is saved for this contact.</p>
      ) : (
        contact.phoneNumbers.map((phone, index) => {
          const telHref = getTelHref(phone)
          const whatsAppHref = getWhatsAppHref(phone)
          const phoneLabel = phone.trim() || 'Blank number'
          return (
            <div className="contact-action-row" key={`${index}-${phone}`}>
              <span>
                Phone {index + 1}: {phoneLabel}
              </span>
              {telHref ? (
                <a className="button button-secondary" href={telHref}>
                  Call
                </a>
              ) : (
                <span className="action-unavailable" role="note">
                  Invalid call number
                </span>
              )}
              {whatsAppHref ? (
                <a
                  className="button button-secondary"
                  href={whatsAppHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              ) : (
                <span className="action-unavailable" role="note">
                  This number is not valid for WhatsApp. Check its format.
                </span>
              )}
            </div>
          )
        })
      )}
    </section>
  )
}
