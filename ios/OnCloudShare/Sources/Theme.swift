import SwiftUI

enum OCSTheme {
  static let bg = Color(red: 0.04, green: 0.04, blue: 0.05)
  static let surface = Color(red: 0.08, green: 0.08, blue: 0.09)
  static let surface2 = Color(red: 0.11, green: 0.11, blue: 0.13)
  static let border = Color(red: 0.18, green: 0.18, blue: 0.20)
  static let text = Color(red: 0.93, green: 0.93, blue: 0.95)
  static let muted = Color(red: 0.48, green: 0.48, blue: 0.52)
  static let accent = Color(red: 0.23, green: 0.51, blue: 0.96)
  static let online = Color(red: 0.13, green: 0.77, blue: 0.37)
  static let danger = Color(red: 0.94, green: 0.27, blue: 0.27)
}

struct GlassCard<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    content
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(OCSTheme.surface.opacity(0.92))
          .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
              .stroke(OCSTheme.border.opacity(0.8), lineWidth: 1)
          )
      )
  }
}

struct PrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.headline.weight(.semibold))
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 14)
      .background(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(OCSTheme.accent)
          .opacity(configuration.isPressed ? 0.85 : 1)
      )
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.28, dampingFraction: 0.85), value: configuration.isPressed)
  }
}

struct SecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(OCSTheme.text)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(OCSTheme.surface2)
          .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .stroke(OCSTheme.border, lineWidth: 1)
          )
      )
      .opacity(configuration.isPressed ? 0.85 : 1)
  }
}
