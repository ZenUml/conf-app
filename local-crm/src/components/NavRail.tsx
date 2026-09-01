import { useCrmStore, type Screen } from '@/stores/crm'

/** Heroicons v2 outline, stroke-width 1.5 — the only icon source in this design. */
const ITEMS: Array<{ key: Screen; label: string; icon: string }> = [
  {
    key: 'today',
    label: 'Today',
    icon: 'M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z'
  },
  {
    key: 'sites',
    label: 'Sites',
    icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01'
  },
  {
    key: 'extensions',
    label: 'Extensions',
    icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  {
    key: 'pending',
    label: 'Pending assignment',
    icon: 'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z'
  },
  {
    key: 'automation',
    label: 'Automation',
    icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'
  }
]

export default function NavRail() {
  const store = useCrmStore()
  return (
    <nav className="flex w-[232px] shrink-0 flex-col border-r border-line bg-bg1">
      <div className="flex items-center gap-[10px] border-b border-line px-4 pb-[14px] pt-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-brand text-caption font-bold tracking-[0.02em] text-white">
          LC
        </div>
        <div className="flex flex-col gap-px">
          <div className="text-body-sm font-semibold leading-[1.2]">Local CRM</div>
          <div className="font-mono text-micro text-fg3">{store.data.origin}</div>
        </div>
      </div>

      <div className="flex flex-col gap-[2px] px-2 py-[10px]">
        <div className="lc-label px-2 pb-1 pt-[6px]">Work</div>
        {ITEMS.map(item => {
          const active = store.screen === item.key
          return (
            <button
              key={item.key}
              type="button"
              className={`lc-t-nav flex w-full cursor-pointer items-center gap-[10px] rounded-md border-0 px-[10px] py-2 text-left text-body-sm ${
                active
                  ? 'bg-blue-50 font-semibold text-brand'
                  : 'bg-transparent font-normal text-fg1 hover:bg-bg3'
              }`}
              onClick={() => store.go(item.key)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[18px] shrink-0 opacity-90"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              <span className="flex-1 text-left">{item.label}</span>
              <span
                className={`lc-num inline-flex h-[18px] min-w-5 items-center justify-center rounded-full px-[6px] text-micro font-semibold ${
                  active ? 'bg-brand text-white' : 'bg-bg3 text-fg2'
                }`}
              >
                {store.navCounts[item.key]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex-1" />
      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        <div className="flex items-center gap-[7px] text-micro text-fg2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-success)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[14px]"
            aria-hidden="true"
          >
            <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Local only · not exposed
        </div>
        <div className="text-micro text-fg3">
          Operator <span className="text-fg2">{store.data.operator}</span>
        </div>
      </div>
    </nav>
  )
}
