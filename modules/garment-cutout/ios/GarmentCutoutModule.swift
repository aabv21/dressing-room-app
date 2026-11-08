import CoreImage
import ExpoModulesCore
import ImageIO
import UniformTypeIdentifiers
import Vision

public class GarmentCutoutModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GarmentCutout")

    Function("isAvailable") { () -> Bool in
      if #available(iOS 17, *) {
        return true
      }
      return false
    }

    // Runs on the module's background queue, not the main thread.
    AsyncFunction("cutOut") { (uri: String) -> String? in
      guard #available(iOS 17, *) else {
        throw CutOutUnavailableException()
      }
      return try GarmentCutter.cutOut(uri: uri)
    }
  }
}

@available(iOS 17, *)
private enum GarmentCutter {
  static func cutOut(uri: String) throws -> String? {
    let sourceUrl = try fileUrl(from: uri)
    // Applies the EXIF orientation so the mask and the output are upright.
    guard let image = CIImage(contentsOf: sourceUrl, options: [.applyOrientationProperty: true]) else {
      throw UnreadableImageException(uri)
    }

    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(ciImage: image)
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      return nil
    }

    let masked = try observation.generateMaskedImage(
      ofInstances: observation.allInstances,
      from: handler,
      croppedToInstancesExtent: true
    )
    let maskedImage = CIImage(cvPixelBuffer: masked)
    let context = CIContext()
    guard
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let cgImage = context.createCGImage(
        maskedImage, from: maskedImage.extent, format: .RGBA8, colorSpace: colorSpace)
    else {
      throw PngEncodingException()
    }
    return try writePng(cgImage).absoluteString
  }

  private static func fileUrl(from uri: String) throws -> URL {
    if let url = URL(string: uri), url.isFileURL {
      return url
    }
    if uri.hasPrefix("/") {
      return URL(fileURLWithPath: uri)
    }
    throw InvalidUriException(uri)
  }

  private static func writePng(_ image: CGImage) throws -> URL {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    else {
      throw PngEncodingException()
    }
    let directory = caches.appendingPathComponent("garment-cutout", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("\(UUID().uuidString).png")

    guard
      let destination = CGImageDestinationCreateWithURL(
        url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else {
      throw PngEncodingException()
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
      throw PngEncodingException()
    }
    return url
  }
}

private final class CutOutUnavailableException: Exception {
  override var reason: String {
    "Garment cut-out needs iOS 17 or later"
  }
}

private final class InvalidUriException: GenericException<String> {
  override var reason: String {
    "Not a file URI: \(param)"
  }
}

private final class UnreadableImageException: GenericException<String> {
  override var reason: String {
    "Could not read the image at \(param)"
  }
}

private final class PngEncodingException: Exception {
  override var reason: String {
    "Could not write the cut-out PNG"
  }
}
