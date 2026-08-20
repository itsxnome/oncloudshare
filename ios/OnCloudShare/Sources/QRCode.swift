import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

enum QRCodeImage {
  static func generate(from string: String, dimension: CGFloat = 220) -> UIImage? {
    let context = CIContext()
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(string.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else { return nil }
    let scale = dimension / output.extent.width
    let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cg)
  }
}

struct QRCodeView: View {
  let string: String
  var size: CGFloat = 180

  var body: some View {
    Group {
      if let img = QRCodeImage.generate(from: string, dimension: size) {
        Image(uiImage: img)
          .interpolation(.none)
          .resizable()
          .scaledToFit()
          .frame(width: size, height: size)
          .padding(10)
          .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      } else {
        Text("QR unavailable")
          .font(.caption)
          .foregroundStyle(OCSTheme.muted)
          .frame(width: size, height: size)
      }
    }
  }
}
