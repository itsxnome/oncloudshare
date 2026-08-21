import Foundation

enum ShortLinkService {
  /// Creates a free short redirect URL pointing at the long share link.
  static func shorten(_ longURL: String) async -> String? {
    let trimmed = longURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    // Must encode ?&= in the target URL or shorteners treat them as their own query params.
    guard let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed)
    else { return nil }

    let endpoints = [
      "https://tinyurl.com/api-create.php?url=\(encoded)",
      "https://is.gd/create.php?format=simple&url=\(encoded)",
      "https://v.gd/create.php?format=simple&url=\(encoded)",
    ]

    for ep in endpoints {
      guard let reqURL = URL(string: ep) else { continue }
      var req = URLRequest(url: reqURL)
      req.timeoutInterval = 15
      req.cachePolicy = .reloadIgnoringLocalCacheData
      req.setValue(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        forHTTPHeaderField: "User-Agent"
      )
      do {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let text = String(data: data, encoding: .utf8)?
              .trimmingCharacters(in: .whitespacesAndNewlines),
              let short = normalizeShortURL(text)
        else {
          ocsLog("Shortener rejected \(reqURL.host ?? "?")", level: .warn)
          continue
        }
        ocsLog("Shortener ok · \(reqURL.host ?? "") → \(short)")
        return short
      } catch {
        ocsLog("Shortener error \(reqURL.host ?? ""): \(error.localizedDescription)", level: .warn)
        continue
      }
    }
    return nil
  }

  /// Compact display for typing, e.g. `tinyurl.com/25w88kzg` (no https://).
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

  private static func normalizeShortURL(_ text: String) -> String? {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty,
          !t.localizedCaseInsensitiveContains("error"),
          !t.localizedCaseInsensitiveContains("invalid"),
          !t.localizedCaseInsensitiveContains("<html")
    else { return nil }
    if t.hasPrefix("http://") || t.hasPrefix("https://") { return t }
    if t.contains(".") { return "https://\(t)" }
    return nil
  }
}

private extension CharacterSet {
  /// Characters safe inside a single query *value* (excludes ?&=# etc.).
  static var urlQueryValueAllowed: CharacterSet {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return allowed
  }
}
