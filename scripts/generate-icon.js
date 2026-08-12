/**
 * Generates resources/icon.png and resources/icon.ico via Windows System.Drawing.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const resources = path.join(__dirname, '..', 'resources')
fs.mkdirSync(resources, { recursive: true })
const pngPath = path.join(resources, 'icon.png')
const icoPath = path.join(resources, 'icon.ico')

const psPath = path.join(resources, '_gen_icon.ps1')
const ps = `
Add-Type -AssemblyName System.Drawing
$sizes = @(16, 32, 48, 64, 128, 256)
$pngPath = "${pngPath.replace(/\\/g, '\\\\')}"
$icoPath = "${icoPath.replace(/\\/g, '\\\\')}"

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 11))

  $radius = [Math]::Max(2, [int]($size * 0.18))
  $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $bg.AddArc(0, 0, $d, $d, 180, 90)
  $bg.AddArc(($size - $d), 0, $d, $d, 270, 90)
  $bg.AddArc(($size - $d), ($size - $d), $d, $d, 0, 90)
  $bg.AddArc(0, ($size - $d), $d, $d, 90, 90)
  $bg.CloseFigure()
  $brushBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 20, 22))
  $g.FillPath($brushBg, $bg)

  $cx = $size / 2.0
  $cy = $size / 2.0
  $outer = [int]($size * 0.28)
  $inner = [int]($size * 0.12)
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 59, 130, 246))
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 10, 11))
  $g.FillEllipse($blue, ($cx - $outer), ($cy - $outer), ($outer * 2), ($outer * 2))
  $g.FillEllipse($dark, ($cx - $inner), ($cy - $inner), ($inner * 2), ($inner * 2))
  $g.Dispose()
  return $bmp
}

$main = New-IconBitmap 256
$main.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([Int16]0)
$bw.Write([Int16]1)
$bw.Write([Int16]$sizes.Count)

$images = New-Object System.Collections.Generic.List[byte[]]
foreach ($s in $sizes) {
  if ($s -eq 256) {
    $b = $main
  } else {
    $b = New-IconBitmap $s
  }
  $imgMs = New-Object System.IO.MemoryStream
  $b.Save($imgMs, [System.Drawing.Imaging.ImageFormat]::Png)
  [void]$images.Add($imgMs.ToArray())
  if ($s -ne 256) { $b.Dispose() }
}

$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $w = 0
  $h = 0
  if ($s -lt 256) {
    $w = $s
    $h = $s
  }
  $bw.Write([byte]$w)
  $bw.Write([byte]$h)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([Int16]1)
  $bw.Write([Int16]32)
  $len = $images[$i].Length
  $bw.Write([Int32]$len)
  $bw.Write([Int32]$offset)
  $offset = $offset + $len
}
foreach ($img in $images) { $bw.Write($img) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$main.Dispose()
Write-Output "Wrote $pngPath and $icoPath"
`

fs.writeFileSync(psPath, ps)
try {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath],
    { stdio: 'inherit' },
  )
} finally {
  try {
    fs.unlinkSync(psPath)
  } catch {
    /* ignore */
  }
}
