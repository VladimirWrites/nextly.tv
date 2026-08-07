// Comma-separated values, read by hand.
//
// The whole reason this is not text.split(",") is the first episode title with a comma in it:
// splitting shifts every column after it, and nothing complains — the import simply reads a
// season number out of the wrong cell and files a play against an episode nobody watched.
import test from "node:test";
import assert from "node:assert/strict";
import { csvRows, csvObjects } from "../public/js/domain/csv.js";

test("cells, rows, and a header that names them", () => {
  assert.deepEqual(csvObjects("a,b\n1,2\n3,4\n"), [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
});

test("a quoted field keeps its commas", () => {
  const [row] = csvRows('1,"Yes, and",3');
  assert.deepEqual(row, ["1", "Yes, and", "3"]);
});

test("a quote inside a quoted field is written twice", () => {
  const [row] = csvRows('"She said ""no""",x');
  assert.deepEqual(row, ['She said "no"', "x"]);
});

test("a quoted field may hold a newline without ending the row", () => {
  const rows = csvRows('a,"two\nlines",c\nnext,row,here');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["a", "two\nlines", "c"]);
  assert.deepEqual(rows[1], ["next", "row", "here"]);
});

test("empty cells are cells", () => {
  assert.deepEqual(csvRows("a,,c")[0], ["a", "", "c"]);
  assert.deepEqual(csvRows(",,")[0], ["", "", ""]);
});

/* Exports are written on every platform there is, and half of them end a line with two
   characters rather than one. */
test("carriage returns are not part of the last cell", () => {
  assert.deepEqual(csvObjects("a,b\r\n1,2\r\n"), [{ a: "1", b: "2" }]);
});

test("the newline a file ends with is not a row", () => {
  assert.equal(csvRows("a,b\n1,2\n").length, 2);
  assert.equal(csvRows("a,b\n1,2").length, 2, "and neither is its absence a problem");
});

/* An export written by somebody else is allowed to end a line early. A missing cell is an empty
   one; a cell with no name is one nothing can ask for. */
test("a short row is padded and a long one is trimmed to the header", () => {
  assert.deepEqual(csvObjects("a,b,c\n1,2"), [{ a: "1", b: "2", c: "" }]);
  assert.deepEqual(csvObjects("a,b\n1,2,3"), [{ a: "1", b: "2" }]);
});

test("nothing at all reads as nothing at all", () => {
  assert.deepEqual(csvRows(""), []);
  assert.deepEqual(csvObjects(""), []);
  assert.deepEqual(csvObjects("a,b\n"), []);
});

/* A quote that opens mid-cell is a quote, not a delimiter: 5" is a measurement. */
test("a quote that is not the first character is just a character", () => {
  assert.deepEqual(csvRows('5" nails,x')[0], ['5" nails', "x"]);
});
