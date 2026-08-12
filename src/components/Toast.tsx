type Props = { title: string; body: string }

export default function Toast({ title, body }: Props) {
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-40 max-w-sm rounded-xl border border-border bg-surface px-4 py-3 shadow-xl">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-muted">{body}</div>
    </div>
  )
}
