export const compareByCreatedAtDescThenIdDesc = <
  T extends {
    created_at: number;
    id: number;
  },
>(
  left: T,
  right: T,
): number => right.created_at - left.created_at || right.id - left.id;
