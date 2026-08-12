type Props = {
  ips: string[]
  port: number
  onDone: () => void
}

export default function FirstRunModal({ ips, port, onDone }: Props) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="card max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Welcome to OnCloudShare</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Create a room — nearby PCs appear automatically. A remote share link is set up for you.
          Phones can join in the browser with the QR / phone link (no app install). Allow the
          firewall prompt once if Windows asks.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-text">
          <li>Allow OnCloudShare on Private networks when Windows asks.</li>
          <li>Create a room on one PC — remote link starts in the background.</li>
          <li>Other PCs join from Nearby, or phones scan the QR / open the phone link.</li>
        </ol>
        <button className="btn-primary mt-6 w-full" onClick={onDone}>
          Got it — start sharing
        </button>
      </div>
    </div>
  )
}
