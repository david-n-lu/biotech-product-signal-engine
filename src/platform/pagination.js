export function paginateItems(items = [], pageIndex = 0, pageSize = 10) {
  const size = Math.max(1, Number.parseInt(String(pageSize), 10) || 10);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const page = Math.min(Math.max(0, Number.parseInt(String(pageIndex), 10) || 0), totalPages - 1);
  const start = page * size;
  const end = Math.min(start + size, totalItems);

  return {
    pageIndex: page,
    pageSize: size,
    totalItems,
    totalPages,
    start,
    end,
    items: items.slice(start, end),
    canGoPrevious: page > 0,
    canGoNext: page < totalPages - 1
  };
}

export function pageIndexForItem(items = [], itemId = "", pageSize = 10) {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return 0;
  const size = Math.max(1, Number.parseInt(String(pageSize), 10) || 10);
  return Math.floor(index / size);
}
