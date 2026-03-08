'use client'

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  title: React.ReactNode
  children: React.ReactNode
  /** Collapse by default on screens < 768px. Default true */
  collapseOnMobile?: boolean
  /** Always start open regardless of screen. Default false */
  defaultOpen?: boolean
}

export function CollapsibleSection({ title, children, collapseOnMobile = true, defaultOpen = false }: Props) {
  const [isOpen, setIsOpen] = useState(true) // SSR safe: start open

  useEffect(() => {
    // On mobile: collapse by default unless defaultOpen
    if (collapseOnMobile && !defaultOpen && window.innerWidth < 768) {
      setIsOpen(false)
    }
  }, [collapseOnMobile, defaultOpen])

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="flex w-full items-center gap-2 mb-3 group"
        aria-expanded={isOpen}
      >
        <div className="w-1 h-4 rounded-full bg-primary/60 flex-shrink-0" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1 text-left">
          {title}
        </p>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      {isOpen && <div>{children}</div>}
    </div>
  )
}
