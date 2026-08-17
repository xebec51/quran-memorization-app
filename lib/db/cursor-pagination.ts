import "server-only";

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

/**
 * Requests one extra row to detect whether more pages exist, then maps
 * the result into a {items, nextCursor} envelope - the take/cursor/skip/
 * hasMore/slice mechanics shared by every cursor-paginated list in this
 * app (package history, evaluation history). `findMany` should already
 * have its own where/orderBy/select bound; this only owns pagination.
 */
export async function paginateByCursor<Row, Dto>(
  findMany: (args: {
    take: number;
    cursor?: { id: string };
    skip?: number;
  }) => Promise<Row[]>,
  cursor: string | null,
  limit: number,
  toDto: (row: Row) => Dto,
  rowId: (row: Row) => string
): Promise<CursorPage<Dto>> {
  const rows = await findMany({
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toDto),
    nextCursor: hasMore ? rowId(page[page.length - 1]) : null
  };
}
