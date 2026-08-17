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
export const revealCompleteError = () =>
  new DomainError(
    "REVEAL_COMPLETE",
    "Seluruh ayat pada halaman ini sudah terbuka.",
    409
  );
