import Foundation
import AVFoundation
import UIKit

/// Keeps the host socket alive when the user briefly switches apps (e.g. WhatsApp).
/// Uses silent audio + idle-timer disable (AltStore / sideload friendly).
@MainActor
final class HostKeepAlive {
  static let shared = HostKeepAlive()

  private var player: AVAudioPlayer?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var running = false

  private init() {}

  func start() {
    guard !running else { return }
    running = true
    UIApplication.shared.isIdleTimerDisabled = true
    startSilentAudio()
    beginBackgroundTask()
    ocsLog("Host keep-alive on (screen stay awake + background audio)")
  }

  func stop() {
    guard running else { return }
    running = false
    UIApplication.shared.isIdleTimerDisabled = false
    player?.stop()
    player = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    endBackgroundTask()
    ocsLog("Host keep-alive off")
  }

  func handleDidEnterBackground() {
    guard running else { return }
    beginBackgroundTask()
    if player?.isPlaying != true {
      startSilentAudio()
    }
  }

  func handleDidBecomeActive() {
    guard running else { return }
    if player?.isPlaying != true {
      startSilentAudio()
    }
  }

  private func startSilentAudio() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try session.setActive(true)
      let data = Self.silentWavData()
      let p = try AVAudioPlayer(data: data)
      p.numberOfLoops = -1
      p.volume = 0.01
      p.prepareToPlay()
      p.play()
      player = p
    } catch {
      ocsLog("Keep-alive audio failed: \(error.localizedDescription)", level: .warn)
    }
  }

  private func beginBackgroundTask() {
    endBackgroundTask()
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ocs-host") { [weak self] in
      Task { @MainActor in
        self?.endBackgroundTask()
      }
    }
  }

  private func endBackgroundTask() {
    if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask)
      backgroundTask = .invalid
    }
  }

  /// Minimal silent mono 8-bit WAV (~0.25s) looped forever.
  private static func silentWavData() -> Data {
    let sampleRate: UInt32 = 8000
    let samples: UInt32 = 2000
    var data = Data()
    func append(_ v: UInt32) {
      var le = v.littleEndian
      withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }
    func append16(_ v: UInt16) {
      var le = v.littleEndian
      withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }
    data.append(contentsOf: Array("RIFF".utf8))
    append(36 + samples)
    data.append(contentsOf: Array("WAVE".utf8))
    data.append(contentsOf: Array("fmt ".utf8))
    append(16)
    append16(1) // PCM
    append16(1) // mono
    append(sampleRate)
    append(sampleRate) // byte rate
    append16(1) // block align
    append16(8) // bits
    data.append(contentsOf: Array("data".utf8))
    append(samples)
    data.append(Data(repeating: 128, count: Int(samples)))
    return data
  }
}
