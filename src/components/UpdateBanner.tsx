type Props = {
  latestVersion: string
  currentVersion: string
  onDismiss: () => void
  onInstall: () => void
}

export default function UpdateBanner({
  latestVersion,
  currentVersion,
  onDismiss,
  onInstall,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-accent/30 bg-accent/10 px-5 py-2.5 text-sm">
      <div className="min-w-0">
        <span className="font-medium text-text">Update available</span>
        <span className="text-muted">
          {' '}
          — v{latestVersion} is out (you have v{currentVersion})
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={onInstall}>
          Install update
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onDismiss}>
          Later
        </button>
      </div>
    </div>
  )
}
