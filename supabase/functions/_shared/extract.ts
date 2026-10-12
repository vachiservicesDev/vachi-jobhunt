import { extractText, getDocumentProxy } from "unpdf";
import { strFromU8, unzipSync } from "fflate";
import { HttpError } from "./http.ts";

export const PDF = "application/pdf";
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Extracts plain text from an uploaded resume. Scanned PDFs (no text layer) are rejected. */
export async function extractResumeText(bytes: Uint8Array, mime: string): Promise<string> {
  let text: string;
  if (mime === PDF) {
    const pdf = await getDocumentProxy(bytes);
    const res = await extractText(pdf, { mergePages: true });
    text = res.text;
  } else if (mime === DOCX) {
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
    const xml = files["word/document.xml"];
    if (!xml) throw new HttpError(422, "unreadable_file", "This Word file looks damaged.");
    text = strFromU8(xml)
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  } else {
    throw new HttpError(415, "unsupported_type", "Upload a PDF or Word (.docx) file.");
  }
  text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) throw new HttpError(422, "no_text", "We couldn't read text from this file. If it's a scan, upload the original document.");
  return text.slice(0, 60_000);
}
