import "server-only";
import type { VerseKey } from "@quranjs/api";
import { prisma } from "@/lib/db/prisma";
import { createQuranFoundationServerClient } from "@/lib/quran/server-client";
import { notFoundError, promptAudioUnavailableError } from "../errors";

const promptRecitationId = "7";
const promptReciterName = "Sheikh Mishari Rashid al-Afasy";

export type PromptAudioClip = {
  questionId: string;
  reciterName: string;
  audioUrl: string;
  startMs: number;
  endMs: number;
  format: string;
};

type Segment = [number, number, number, number];

export async function getPromptAudioClip(
  userId: string,
  questionId: string
): Promise<PromptAudioClip> {
  const question = await prisma.memorizationQuestion.findFirst({
    where: { id: questionId, userId },
    select: {
      id: true,
      anchorVerseKey: true,
      visibleWordCount: true
    }
  });
  if (!question) throw notFoundError();

  const client = createQuranFoundationServerClient();
  const response = await client.content.v4.audio.verseRecitation.byKey(
    question.anchorVerseKey as VerseKey,
    promptRecitationId,
    { fields: { segments: true, format: true } }
  );
  const audioFile = response.audioFiles[0];
  if (!audioFile?.audioUrl || !audioFile.segments?.length) {
    throw promptAudioUnavailableError();
  }

  const segment = segmentForWordCount(
    audioFile.segments as Segment[],
    question.visibleWordCount
  );

  return {
    questionId,
    reciterName: promptReciterName,
    audioUrl: audioFile.audioUrl,
    startMs: Math.max(0, segment.startMs),
    endMs: Math.max(segment.startMs + 1, segment.endMs),
    format: audioFile.format ?? "mp3"
  };
}

function segmentForWordCount(
  segments: readonly Segment[],
  visibleWordCount: number
) {
  const safeWordCount = Math.max(1, visibleWordCount);
  const first = segments[0];
  const lastVisible =
    segments.find((segment) => segment[1] >= safeWordCount) ??
    segments[segments.length - 1];
  return {
    startMs: first[2],
    endMs: lastVisible[3]
  };
}
