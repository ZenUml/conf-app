import type { ReactNode } from 'react'

/** The uppercase, letter-spaced micro-label that heads every section. */
export default function SectionLabel({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`lc-label ${className}`}>{children}</div>
}
