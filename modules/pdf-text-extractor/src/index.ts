import { requireNativeModule } from 'expo-modules-core';

interface PdfTextExtractorModule {
  extractText(uri: string): Promise<string>;
}

const PdfTextExtractor = requireNativeModule<PdfTextExtractorModule>('PdfTextExtractor');

export async function extractPdfText(uri: string): Promise<string> {
  return PdfTextExtractor.extractText(uri);
}
