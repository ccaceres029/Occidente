import AppKit
import Foundation
import Vision

struct OcrWord: Codable {
    let text: String
    let xMin: Double
    let yMin: Double
    let xMax: Double
    let yMax: Double
    let line: Int
}

struct OcrResult: Codable {
    let width: Double
    let height: Double
    let words: [OcrWord]
}

guard CommandLine.arguments.count == 2 else { exit(2) }
let imageUrl = URL(fileURLWithPath: CommandLine.arguments[1])
guard
    let image = NSImage(contentsOf: imageUrl),
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { exit(3) }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["es-HN", "es-ES", "en-US"]
request.usesLanguageCorrection = true
try VNImageRequestHandler(cgImage: cgImage).perform([request])

var words: [OcrWord] = []
for (lineIndex, observation) in (request.results ?? []).enumerated() {
    guard let candidate = observation.topCandidates(1).first else { continue }
    candidate.string.enumerateSubstrings(
        in: candidate.string.startIndex..<candidate.string.endIndex,
        options: .byWords
    ) { substring, range, _, _ in
        guard
            let substring,
            let box = try? candidate.boundingBox(for: range)
        else { return }
        let rect = box.boundingBox
        words.append(OcrWord(
            text: substring,
            xMin: Double(rect.minX) * Double(cgImage.width),
            yMin: (1 - Double(rect.maxY)) * Double(cgImage.height),
            xMax: Double(rect.maxX) * Double(cgImage.width),
            yMax: (1 - Double(rect.minY)) * Double(cgImage.height),
            line: lineIndex
        ))
    }
}

let payload = try JSONEncoder().encode(OcrResult(
    width: Double(cgImage.width),
    height: Double(cgImage.height),
    words: words
))
FileHandle.standardOutput.write(payload)
