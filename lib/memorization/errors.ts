export class DomainError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

export const notFoundError = () =>
  new DomainError("NOT_FOUND", "Pertanyaan tidak ditemukan.", 404);
export const alreadyAssessedError = () =>
  new DomainError("ALREADY_ASSESSED", "Pertanyaan sudah dinilai.", 409);
export const hintLimitError = (message: string) =>
  new DomainError("HINT_LIMIT", message, 409);
export const revealIncompleteError = () =>
  new DomainError(
    "REVEAL_INCOMPLETE",
    "Buka seluruh ayat pada halaman ini sebelum menilai jawaban.",
    409
  );
export const evaluationNotEligibleError = () =>
  new DomainError(
    "EVALUATION_NOT_ELIGIBLE",
    "Soal ini tidak tersedia untuk latihan evaluasi (hanya soal yang belum ingat atau sebagian benar).",
    409
  );
export const evaluationAttemptConflictError = () =>
  new DomainError(
    "EVALUATION_ATTEMPT_CONFLICT",
    "Permintaan ini sudah pernah dikirim dengan data yang berbeda.",
    409
  );
