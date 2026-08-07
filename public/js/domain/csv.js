// Comma-separated values, read by hand.
//
// One import arrives as JSON and another as CSV, and this app has no bundler and no
// dependencies, so the format is walked here. It is a small format with one genuinely awkward
// corner: a field may be quoted, a quoted field may contain commas and newlines, and a quote
// inside one is written twice. Splitting on commas works until the first episode title with a
// comma in it, and then silently shifts every column after it.
//
// Nothing else is supported, because nothing else appears: no separators other than a comma, no
// escape character, no comment lines.

/* Rows of cells, exactly as written. Blank lines are dropped rather than returned as a row of
   one empty string — a trailing newline is how a file ends, not a record. */
export function csvRows(text) {
  const out = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let had = false;                 // this row has a cell, even if that cell is empty

  const endCell = () => { row.push(cell); cell = ""; had = true; };
  const endRow = () => {
    endCell();
    if (row.length > 1 || row[0] !== "") out.push(row);
    row = [];
    had = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      // Two quotes inside a quoted field are one quote. Anything else closes it.
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") endCell();
    else if (c === "\n") endRow();
    else if (c !== "\r") cell += c;
  }
  if (had || cell !== "" || row.length) endRow();
  return out;
}

/* The same thing keyed by the header line, which is how every caller wants it.
 *
 * A short row is padded rather than refused: an export written by somebody else is allowed to
 * end a line early, and a missing cell is an empty one. A long row keeps only the columns the
 * header names, since a cell with no name is a cell nothing can ask for. */
export function csvObjects(text) {
  const rows = csvRows(text);
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? "" : r[i]])));
}
