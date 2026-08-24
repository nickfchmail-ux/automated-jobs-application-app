declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    version: string;
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;

  export default pdfParse;
}
