import ExpoModulesCore
import PDFKit
import Vision
import UIKit

public class PdfTextExtractorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfTextExtractor")

    AsyncFunction("extractText") { (uri: String) -> String in
      guard let url = URL(string: uri) else {
        throw InvalidUriException(uri)
      }
      guard let document = PDFDocument(url: url) else {
        throw PdfLoadFailedException(uri)
      }

      // --- Pass 1: PDFKit direct extraction (text-based PDFs, instant) ---
      var pages: [String] = []
      for i in 0..<document.pageCount {
        if let page = document.page(at: i),
           let text = page.string,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          pages.append(text)
        }
      }
      let directText = pages.joined(separator: "\n")
      if !directText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return directText
      }

      // --- Pass 2: Vision OCR fallback (scanned/image-based PDFs) ---
      var ocrPages: [String] = []
      let scale: CGFloat = 2.0
      let maxOcrPages = min(document.pageCount, 50)

      for i in 0..<maxOcrPages {
        guard let page = document.page(at: i) else { continue }
        let bounds = page.bounds(for: .mediaBox)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)

        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
          UIColor.white.setFill()
          ctx.fill(CGRect(origin: .zero, size: size))
          ctx.cgContext.translateBy(x: 0, y: size.height)
          ctx.cgContext.scaleBy(x: scale, y: -scale)
          page.draw(with: .mediaBox, to: ctx.cgContext)
        }

        guard let cgImage = image.cgImage else { continue }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([request])

        let pageText = (request.results ?? [])
          .compactMap { $0.topCandidates(1).first?.string }
          .joined(separator: "\n")

        if !pageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          ocrPages.append(pageText)
        }
      }

      let ocrText = ocrPages.joined(separator: "\n")
      if ocrText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        throw NoExtractableTextException()
      }
      return ocrText
    }
  }
}
