export function splitSearchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter((term) => term.length > 0);
}

export function filterAdminItems<T>(items: readonly T[], query: string, getSearchableValues: (item: T) => readonly unknown[]): T[] {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return [...items];

  return items.filter((item) => {
    const searchableTokens = getSearchableValues(item)
      .flatMap((value) => String(value ?? '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u))
      .filter((token) => token.length > 0);
    return terms.every((term) => searchableTokens.includes(term));
  });
}
