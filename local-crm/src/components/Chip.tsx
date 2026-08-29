import type { ReactNode } from 'react'
import type { ChipTone } from '@/lib/palette'

/**
 * Product and status chip colours live in one place. The three literal colour
 * triples are design-specific tones that do not exist in the shared tokens.
 */
const TONES: Record<ChipTone, string> = {
  full: 'bg-blue-50 text-blue-800 border-blue-100',
  lite: 'bg-amber-50 text-amber-800 border-amber-100',
  dia: 'bg-[#F8F0FE] text-[#5B21A6] border-[#EBD9FB]',
  api: 'bg-leaf-50 text-leaf-800 border-leaf-100',
  grant: 'bg-blue-50 text-blue-800 border-blue-100',
  expiry: 'bg-bg3 text-gray-600 border-gray-200',
  ingest: 'bg-rust-50 text-rust-800 border-rust-100',
  skipped: 'bg-bg3 text-gray-600 border-gray-200',
  blocked: 'bg-amber-50 text-amber-800 border-amber-100',
  failed: 'bg-[#FDECEA] text-[#8C2417] border-[#F7D4CF]',
  lapsed: 'bg-blue-50 text-blue-800 border-blue-100',
  retrying: 'bg-amber-50 text-amber-800 border-amber-100',
  pending: 'bg-blue-50 text-blue-800 border-blue-100',
  sent: 'bg-[#E9F7F1] text-[#1B6B4C] border-[#CDEBDF]'
}

export default function Chip({
  tone,
  children,
  className = ''
}: {
  tone: ChipTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-micro font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
