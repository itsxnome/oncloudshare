import Foundation

enum ShortLinkService {
  /// Creates a free short redirect URL (e.g. https://is.gd/Ab12x) pointing at the long share link.
  static func shorten(_ longURL: String) async -> String? {
    let trimmed = longURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
          !encoded.isEmpty
    else { return nil }

    let endpoints = [
      "https://is.gd/create.php?format=simple&url=\(encoded)",
      "https://v.gd/create.php?format=simple&url=\(encoded)",
    ]
    for ep in endpoints {
      guard let reqURL = URL(string: ep) else { continue }
      var req = URLRequest(url: reqURL)
      req.timeoutInterval = 12
      req.setValue("OnCloudShare-iOS", forHTTPHeaderField: "User-Agent")
      do {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let text = String(data: data, encoding: .utf8)?
              .trimmingCharacters(in: .whitespacesAndNewlines),
              text.hasPrefix("http"),
              !text.localizedCaseInsensitiveContains("error")
        else { continue }
        return text
      } catch {
        continue
      }
    }
    return nil
  }

  /// Compact display for typing aloud, e.g. `is.gd/Ab12x` (no https://).
  static func typingHint(from shortURL: String) -> String {
    var s = shortURL.trimmingCharacters(in: .whitespacesAndNewlines)
    if let u = URL(string: s), let host = u.host {
      let path = u.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      if path.isEmpty { return host }
      return "\(host)/\(path)"
    }
    s = s.replacingOccurrences(of: "https://", with: "")
    s = s.replacingOccurrences(of: "http://", with: "")
    return s
  }
}
