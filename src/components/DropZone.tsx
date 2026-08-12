import { useEffect, useState } from 'react'

type Props = {
  disabled?: boolean
  onFiles: (files: File[]) => void
  onPasteText?: (text: string) => void
  onPasteClipboard?: () => void
}

export default function DropZone({ disabled, onFiles, onPasteText, onPasteClipboard }: Props) {
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const editing = (e.target as HTMLElement | null)?.closest?.(
        'textarea, input, [contenteditable="true"]',
      )
      const files: File[] = []
      let hasText = false
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        } else if (item.kind === 'string' && item.type === 'text/plain') {
          hasText = true
          if (!editing) {
            item.getAsString((s) => {
              if (s.trim()) onPasteText?.(s)
            })
          }
        }
      }
      if (files.length) {
        e.preventDefault()
        onFiles(files)
      } else if (hasText && !editing) {
        e.preventDefault()
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [disabled, onFiles, onPasteText])

  return (
    <div className="space-y-2">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition ${
          over ? 'border-accent bg-accent/10' : 'border-border bg-surface2/40'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const files = Array.from(e.dataTransfer.files || [])
          if (files.length) onFiles(files)
        }}
      >
        <div className="text-sm text-text">Drop files here</div>
        <div className="mt-1 text-xs text-muted">
          or click to browse · Ctrl+V pastes text or images
        </div>
        <input
          type="file"
          className="hidden"
          multiple
          disabled={disabled}
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            if (files.length) onFiles(files)
            e.target.value = ''
          }}
        />
      </label>
      {onPasteClipboard && (
        <button
          type="button"
          className="btn-secondary w-full text-xs"
          disabled={disabled}
          onClick={onPasteClipboard}
        >
          Paste clipboard (text or image)
        </button>
      )}
    </div>
  )
}
