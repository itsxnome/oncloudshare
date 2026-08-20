import Foundation
import CryptoKit

enum WebSocketOpcode: UInt8 {
  case continuation = 0x0
  case text = 0x1
  case binary = 0x2
  case close = 0x8
  case ping = 0x9
  case pong = 0xA
}

enum WebSocketFrame {
  case text(String)
  case binary(Data)
  case ping(Data)
  case pong(Data)
  case close
}

enum WebSocketCodec {
  static let acceptGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

  static func acceptKey(from clientKey: String) -> String {
    let raw = Data((clientKey + acceptGUID).utf8)
    let digest = Insecure.SHA1.hash(data: raw)
    return Data(digest).base64EncodedString()
  }

  /// Encode a server→client frame (unmasked).
  static func encode(opcode: WebSocketOpcode, payload: Data, fin: Bool = true) -> Data {
    var out = Data()
    let b0 = (fin ? 0x80 : 0x00) | opcode.rawValue
    out.append(UInt8(b0))
    let len = payload.count
    if len < 126 {
      out.append(UInt8(len))
    } else if len <= 0xFFFF {
      out.append(126)
      out.append(UInt8((len >> 8) & 0xFF))
      out.append(UInt8(len & 0xFF))
    } else {
      out.append(127)
      var be = UInt64(len).bigEndian
      withUnsafeBytes(of: &be) { out.append(contentsOf: $0) }
    }
    out.append(payload)
    return out
  }

  static func encodeText(_ string: String) -> Data {
    encode(opcode: .text, payload: Data(string.utf8))
  }

  static func encodeBinary(_ data: Data) -> Data {
    encode(opcode: .binary, payload: data)
  }

  /// Parse one or more complete frames from a buffer; returns leftover bytes.
  static func decode(buffer: inout Data) -> [WebSocketFrame] {
    var frames: [WebSocketFrame] = []
    while true {
      guard buffer.count >= 2 else { break }
      let b0 = buffer[0]
      let b1 = buffer[1]
      let opcode = b0 & 0x0F
      let masked = (b1 & 0x80) != 0
      var payloadLen = Int(b1 & 0x7F)
      var offset = 2
      if payloadLen == 126 {
        guard buffer.count >= 4 else { break }
        payloadLen = (Int(buffer[2]) << 8) | Int(buffer[3])
        offset = 4
      } else if payloadLen == 127 {
        guard buffer.count >= 10 else { break }
        var len: UInt64 = 0
        for i in 0..<8 {
          len = (len << 8) | UInt64(buffer[2 + i])
        }
        // Cap absurd sizes
        if len > UInt64(Int.max) { buffer.removeAll(); break }
        payloadLen = Int(len)
        offset = 10
      }
      let maskLen = masked ? 4 : 0
      let total = offset + maskLen + payloadLen
      guard buffer.count >= total else { break }

      var payload = Data(buffer.subdata(in: (offset + maskLen)..<(offset + maskLen + payloadLen)))
      if masked {
        let mask = Array(buffer.subdata(in: offset..<(offset + 4)))
        for i in 0..<payload.count {
          payload[i] ^= mask[i % 4]
        }
      }
      buffer.removeSubrange(0..<total)

      switch opcode {
      case WebSocketOpcode.text.rawValue:
        frames.append(.text(String(data: payload, encoding: .utf8) ?? ""))
      case WebSocketOpcode.binary.rawValue:
        frames.append(.binary(payload))
      case WebSocketOpcode.ping.rawValue:
        frames.append(.ping(payload))
      case WebSocketOpcode.pong.rawValue:
        frames.append(.pong(payload))
      case WebSocketOpcode.close.rawValue:
        frames.append(.close)
      default:
        break
      }
    }
    return frames
  }
}

enum OCSFCodec {
  static let magic: [UInt8] = [0x4F, 0x43, 0x53, 0x46]

  static func decodeChunk(_ data: Data) -> (fileId: String, index: UInt32, payload: Data)? {
    guard data.count >= 12 else { return nil }
    guard Array(data.prefix(4)) == magic else { return nil }
    guard data[4] == 1, data[5] == 1 else { return nil }
    let idLen = Int(data[6])
    let idStart = 8
    let idEnd = idStart + idLen
    guard data.count >= idEnd + 4 else { return nil }
    guard let fileId = String(data: data.subdata(in: idStart..<idEnd), encoding: .utf8) else { return nil }
    let index = data.subdata(in: idEnd..<(idEnd + 4)).withUnsafeBytes { raw -> UInt32 in
      var v: UInt32 = 0
      Swift.withUnsafeMutableBytes(of: &v) { dest in
        dest.copyBytes(from: raw.prefix(4))
      }
      return UInt32(bigEndian: v)
    }
    let payload = data.subdata(in: (idEnd + 4)..<data.count)
    return (fileId, index, payload)
  }
}
