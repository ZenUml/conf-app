/** Inline confirmation only: never a modal and never window.confirm(). */
export default function ConfirmStrip({
  text,
  onConfirm,
  onCancel
}: {
  text: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-[11px] flex flex-wrap items-center gap-[10px] border-t border-rust-100 pt-[11px]">
      <span className="min-w-[170px] flex-1 text-micro leading-[1.5] text-rust-800">{text}</span>
      <button
        type="button"
        className="h-7 cursor-pointer rounded-md border-0 bg-blue-600 px-3 text-body-sm font-medium text-white"
        onClick={onConfirm}
      >
        Confirm
      </button>
      <button
        type="button"
        className="h-7 cursor-pointer rounded-md border border-gray-300 bg-bg1 px-[10px] text-body-sm text-gray-700"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  )
}
