import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers
import CoreTransferable

enum MediaSave {
  static func isImage(_ mime: String) -> Bool {
    mime.lowercased().hasPrefix("image/")
  }

  static func isVideo(_ mime: String) -> Bool {
    mime.lowercased().hasPrefix("video/")
  }

  static func saveToPhotos(data: Data, mime: String, suggestedName: String) async throws {
    let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    guard status == .authorized || status == .limited else {
      throw NSError(domain: "OnCloudShare", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Photos access denied — enable in Settings",
      ])
    }
    if isImage(mime) {
      try await PHPhotoLibrary.shared().performChanges {
        let req = PHAssetCreationRequest.forAsset()
        req.addResource(with: .photo, data: data, options: nil)
      }
      return
    }
    if isVideo(mime) {
      let ext = (suggestedName as NSString).pathExtension
      let suffix = ext.isEmpty ? "mp4" : ext
      let tmp = FileManager.default.temporaryDirectory
        .appendingPathComponent("ocs-\(UUID().uuidString).\(suffix)")
      try data.write(to: tmp, options: .atomic)
      defer { try? FileManager.default.removeItem(at: tmp) }
      try await PHPhotoLibrary.shared().performChanges {
        PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: tmp)
      }
      return
    }
    throw NSError(domain: "OnCloudShare", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "Not an image or video",
    ])
  }

  static func writeToDocuments(data: Data, name: String) throws -> URL {
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Downloads", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let safe = name.replacingOccurrences(of: "/", with: "-")
    let dest = dir.appendingPathComponent(safe)
    if FileManager.default.fileExists(atPath: dest.path) {
      try FileManager.default.removeItem(at: dest)
    }
    try data.write(to: dest, options: .atomic)
    return dest
  }
}

struct VideoFileTransferable: Transferable {
  let url: URL

  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(contentType: .movie) { video in
      SentTransferredFile(video.url)
    } importing: { received in
      let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent("ocs-vid-\(UUID().uuidString)-\(received.file.lastPathComponent)")
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.copyItem(at: received.file, to: dest)
      return VideoFileTransferable(url: dest)
    }
  }
}
