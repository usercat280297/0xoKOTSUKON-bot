import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";

export interface SteamActivationScreenshotValidationResult {
  passed: boolean;
  score: number;
  matchedSignals: string[];
  missingSignals: string[];
  ocrExcerpt: string;
}

export interface SteamActivationScreenshotAnalyzer {
  validateAttachmentUrl(url: string): Promise<SteamActivationScreenshotValidationResult>;
}

const UPDATE_TEXT_SIGNALS = [
  "windows updates option",
  "windows update blocker",
  "disable updates",
  "protect services settings",
  "service status"
];

const FOLDER_TEXT_SIGNALS = [
  "properties",
  "file folder",
  "location",
  "size on disk",
  "contains",
  "attributes"
];

const GAME_PATH_SIGNALS = ["steamapps", "common", "steamlibrary"];

function normalizeOcrText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s:./\\-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function countSignalMatches(text: string, signals: string[]): string[] {
  return signals.filter((signal) => text.includes(signal));
}

export function scoreSteamActivationScreenshot(input: {
  ocrText: string;
  hasRedStatusBadge: boolean;
}): SteamActivationScreenshotValidationResult {
  const normalizedText = normalizeOcrText(input.ocrText);
  const updateMatches = countSignalMatches(normalizedText, UPDATE_TEXT_SIGNALS);
  const folderMatches = countSignalMatches(normalizedText, FOLDER_TEXT_SIGNALS);
  const pathMatches = countSignalMatches(normalizedText, GAME_PATH_SIGNALS);

  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];

  const hasUpdateSignal = updateMatches.length > 0 || input.hasRedStatusBadge;
  if (updateMatches.length > 0) {
    matchedSignals.push("thấy chữ của Windows Update Blocker");
  }
  if (input.hasRedStatusBadge) {
    matchedSignals.push("thấy vùng đỏ giống dấu X trạng thái disable updates");
  }
  if (!hasUpdateSignal) {
    missingSignals.push("cửa sổ Windows Update Blocker hoặc dấu X đỏ");
  }

  if (folderMatches.length >= 2) {
    matchedSignals.push("thấy cửa sổ properties của thư mục game");
  } else {
    missingSignals.push("cửa sổ properties thư mục game với các dòng như File folder / Location / Contains");
  }

  if (pathMatches.length > 0) {
    matchedSignals.push("thấy đường dẫn game trong SteamLibrary/steamapps/common");
  } else {
    missingSignals.push("đường dẫn thư mục game trong SteamLibrary/steamapps/common");
  }

  const score =
    (hasUpdateSignal ? 0.45 : 0) +
    (Math.min(folderMatches.length, 3) / 3) * 0.35 +
    (pathMatches.length > 0 ? 0.2 : 0);
  const roundedScore = Math.round(score * 100);

  return {
    passed: roundedScore >= 70,
    score: roundedScore,
    matchedSignals: unique(matchedSignals),
    missingSignals: unique(missingSignals),
    ocrExcerpt: normalizedText.slice(0, 280)
  };
}

async function detectRedStatusBadge(imageBuffer: Buffer): Promise<boolean> {
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let rightSidePixels = 0;
  let redPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const pixelIndex = index / 4;
    const x = pixelIndex % info.width;
    if (x < info.width * 0.55) {
      continue;
    }

    rightSidePixels += 1;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];

    if (red > 150 && green < 120 && blue < 120 && red - green > 35 && red - blue > 35) {
      redPixels += 1;
    }
  }

  if (rightSidePixels === 0) {
    return false;
  }

  return redPixels / rightSidePixels >= 0.008;
}

export class TesseractSteamActivationScreenshotService implements SteamActivationScreenshotAnalyzer {
  private workerPromise: Promise<Worker> | null = null;
  private validationQueue: Promise<void> = Promise.resolve();

  public async validateAttachmentUrl(url: string): Promise<SteamActivationScreenshotValidationResult> {
    const task = this.validationQueue.then(() => this.validateInternal(url));
    this.validationQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async validateInternal(url: string): Promise<SteamActivationScreenshotValidationResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${response.status}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const ocrText = await this.extractText(imageBuffer);
    const hasRedStatusBadge = await detectRedStatusBadge(imageBuffer);
    return scoreSteamActivationScreenshot({
      ocrText,
      hasRedStatusBadge
    });
  }

  private async extractText(imageBuffer: Buffer): Promise<string> {
    const worker = await this.getWorker();
    const processedImage = await sharp(imageBuffer)
      .rotate()
      .resize({ width: 1800, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();

    const result = await worker.recognize(processedImage);
    return result.data.text ?? "";
  }

  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = createWorker("eng", 1, {
        logger: () => undefined
      });
    }

    return this.workerPromise;
  }
}
