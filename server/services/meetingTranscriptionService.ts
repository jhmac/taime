import { toFile } from "openai";
import { openai, withAiContext } from "../lib/aiClients";
import fs from "fs";
import path from "path";
import logger from "../lib/logger";

export async function transcribeAudioFile(filePath: string): Promise<string> {
  const startTime = Date.now();
  logger.info({ filePath }, "Starting audio transcription");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const fileStream = fs.createReadStream(filePath);
  const ext = path.extname(filePath).replace(".", "") || "mp3";
  const fileName = `audio.${ext}`;

  const file = await toFile(fileStream, fileName);

  const transcription = await withAiContext({ feature: "meeting-transcription", isBackground: true }, () =>
    openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-transcribe",
      response_format: "text",
    }),
  );

  const latency = Date.now() - startTime;
  logger.info({ filePath, latencyMs: latency, transcriptLength: transcription.length }, "Transcription complete");

  return transcription;
}

export async function transcribeAudioBuffer(buffer: Buffer, mimeType = "audio/webm", filename = "audio.webm"): Promise<string> {
  const startTime = Date.now();
  logger.info({ mimeType, size: buffer.length }, "Starting buffer transcription");

  const file = await toFile(buffer, filename, { type: mimeType });

  const transcription = await withAiContext({ feature: "meeting-transcription", isBackground: false }, () =>
    openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-transcribe",
      response_format: "text",
    }),
  );

  const latency = Date.now() - startTime;
  logger.info({ latencyMs: latency, transcriptLength: transcription.length }, "Buffer transcription complete");

  return transcription;
}
