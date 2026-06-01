import test from "node:test";
import assert from "node:assert/strict";
import { pageIndexForItem, paginateItems } from "../src/platform/pagination.js";

const products = Array.from({ length: 18 }, (_, index) => ({
  id: `PROD-${index + 1}`,
  productName: `Product ${index + 1}`
}));

test("pagination returns a bounded page of products", () => {
  const firstPage = paginateItems(products, 0, 8);
  const lastPage = paginateItems(products, 99, 8);

  assert.equal(firstPage.totalItems, 18);
  assert.equal(firstPage.totalPages, 3);
  assert.deepEqual(firstPage.items.map((product) => product.id), [
    "PROD-1",
    "PROD-2",
    "PROD-3",
    "PROD-4",
    "PROD-5",
    "PROD-6",
    "PROD-7",
    "PROD-8"
  ]);
  assert.equal(firstPage.canGoPrevious, false);
  assert.equal(firstPage.canGoNext, true);
  assert.equal(lastPage.pageIndex, 2);
  assert.deepEqual(lastPage.items.map((product) => product.id), ["PROD-17", "PROD-18"]);
});

test("pagination finds the page containing a selected product", () => {
  assert.equal(pageIndexForItem(products, "PROD-1", 8), 0);
  assert.equal(pageIndexForItem(products, "PROD-9", 8), 1);
  assert.equal(pageIndexForItem(products, "PROD-18", 8), 2);
  assert.equal(pageIndexForItem(products, "MISSING", 8), 0);
});
