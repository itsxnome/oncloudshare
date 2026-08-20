import Foundation
import UIKit

enum UpdateServiceError: LocalizedError {
  case noIPA
  case badResponse

  var errorDescription: String? {
    switch self {
    case .noIPA: return "No iOS IPA found on the latest GitHub release"
    case .badResponse: return "Could not reach GitHub Releases"
    }
  }
}

final class UpdateService: NSObject, URLSessionDownloadDelegate {
  static let shared = UpdateService()
  private let repo = "itsxnome/oncloudshare"
  private var progressHandler: ((Double) -> Void)?
  private var continuation: CheckedContinuation<URL, Error>?
  private var pendingName = "OnCloudShare.ipa"

  func latestIPA() async throws -> AppReleaseAsset? {
    let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!
    var req = URLRequest(url: url)
    req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    req.setValue("OnCloudShare-iOS", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: req)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw UpdateServiceError.badResponse
    }
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let assets = json["assets"] as? [[String: Any]]
    else { return nil }

    let ipa = assets.first { (($0["name"] as? String) ?? "").lowercased().hasSuffix(".ipa") }
    guard let ipa,
          let name = ipa["name"] as? String,
          let urlStr = ipa["browser_download_url"] as? String,
          let downloadURL = URL(string: urlStr)
    else { return nil }

    let size = (ipa["size"] as? NSNumber)?.int64Value ?? 0
    let tag = (json["tag_name"] as? String) ?? "latest"
    let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    let remote = tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
    if compareVersion(remote, current) <= 0 { return nil }

    return AppReleaseAsset(id: tag, name: name, downloadURL: downloadURL, size: size)
  }

  func downloadIPA(asset: AppReleaseAsset, onProgress: @escaping (Double) -> Void) async throws -> URL {
    // Always download locally. AltStore cannot reliably use GitHub temporary CDN URLs
    // via altstore://install?url=
    pendingName = asset.name
    return try await withCheckedThrowingContinuation { cont in
      self.continuation = cont
      self.progressHandler = onProgress
      let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
      session.downloadTask(with: asset.downloadURL).resume()
    }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    do {
      let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("updates", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let dest = dir.appendingPathComponent(pendingName)
      if FileManager.default.fileExists(atPath: dest.path) {
        try FileManager.default.removeItem(at: dest)
      }
      try FileManager.default.moveItem(at: location, to: dest)
      continuation?.resume(returning: dest)
    } catch {
      continuation?.resume(throwing: error)
    }
    continuation = nil
    progressHandler = nil
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    guard totalBytesExpectedToWrite > 0 else { return }
    progressHandler?(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      continuation?.resume(throwing: error)
      continuation = nil
      progressHandler = nil
    }
  }

  @MainActor
  func shareIPA(_ fileURL: URL) {
    guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
          let root = scene.windows.first?.rootViewController
    else { return }
    let presenter = root.presentedViewController ?? root
    let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    if let pop = activity.popoverPresentationController {
      pop.sourceView = presenter.view
      pop.sourceRect = CGRect(
        x: presenter.view.bounds.midX,
        y: presenter.view.bounds.midY,
        width: 1,
        height: 1
      )
      pop.permittedArrowDirections = []
    }
    presenter.present(activity, animated: true)
  }

  private func compareVersion(_ a: String, _ b: String) -> Int {
    let pa = a.split(separator: ".").map { Int($0) ?? 0 }
    let pb = b.split(separator: ".").map { Int($0) ?? 0 }
    let n = max(pa.count, pb.count)
    for i in 0..<n {
      let x = i < pa.count ? pa[i] : 0
      let y = i < pb.count ? pb[i] : 0
      if x > y { return 1 }
      if x < y { return -1 }
    }
    return 0
  }
}
