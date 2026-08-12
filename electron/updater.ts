import { app, shell } from 'electron'

const REPO = 'itsxnome/oncloudshare'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

export type UpdateInfo = {
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string
  releaseName?: string
  error?: string
}

function normalizeVersion(v: string) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
}

/** Compare semver-ish strings. Returns 1 if a>b, -1 if a<b, 0 if equal/unknown. */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10))
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

export function getAppVersion() {
  try {
    return normalizeVersion(app.getVersion())
  } catch {
    return '0.0.0'
  }
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = getAppVersion()
  const releaseUrl = RELEASES_URL
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `OnCloudShare/${currentVersion}`,
      },
    })
    if (!res.ok) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        releaseUrl,
        error: `GitHub returned ${res.status}`,
      }
    }
    const data = (await res.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
    }
    const latestVersion = normalizeVersion(data.tag_name || '')
    if (!latestVersion) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        releaseUrl,
        error: 'No release tag found',
      }
    }
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url || releaseUrl,
      releaseName: data.name,
    }
  } catch (e) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      releaseUrl,
      error: e instanceof Error ? e.message : 'Update check failed',
    }
  }
}

export function openReleasesPage(url?: string) {
  void shell.openExternal(url || RELEASES_URL)
}
