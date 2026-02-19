import ExpoModulesCore

internal final class InvalidUriException: Exception {
  private let uri: String
  init(_ uri: String) { self.uri = uri; super.init() }
  override var reason: String { "Could not parse URI: '\(uri)'" }
}

internal final class PdfLoadFailedException: Exception {
  private let uri: String
  init(_ uri: String) { self.uri = uri; super.init() }
  override var reason: String { "PDFKit could not open the file at '\(uri)'." }
}

internal final class NoExtractableTextException: Exception {
  override var reason: String {
    "This PDF appears to be image-based (scanned) and contains no extractable text. Export your script as a .txt file instead."
  }
}
