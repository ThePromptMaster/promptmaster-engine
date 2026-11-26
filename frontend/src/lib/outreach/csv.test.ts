import { describe, expect, it } from 'vitest';

import { looksTabular, MAX_COLUMNS, MAX_ROWS, parseDelimited } from './csv';

// Sean, 26 Nov: "Let me paste a list, upload a CSV from Clay, or start with company names and
// websites." What comes in is rarely clean, so every case here is one a real export produces.
describe('reading a delimited file', () => {
  it('reads a header and rows', () => {
    const t = parseDelimited('Name,Email\nMaya Chen,maya@northwind.example\nTom Okafor,tom@brightline.example');
    expect(t.delimiter).toBe(',');
    expect(t.headers).toEqual(['Name', 'Email']);
    expect(t.rows).toEqual([
      ['Maya Chen', 'maya@northwind.example'],
      ['Tom Okafor', 'tom@brightline.example'],
    ]);
    expect(t.truncated).toBe(false);
  });

  it('drops a byte-order mark, so the first header is not "\\uFEFFName"', () => {
    const t = parseDelimited('﻿Name,Email\nMaya,maya@northwind.example');
    expect(t.headers[0]).toBe('Name');
  });

  it('reads CRLF, LF and CR line ends alike', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const t = parseDelimited(['Name,Role', 'Maya,COO', 'Tom,CFO'].join(eol));
      expect(t.rows).toEqual([
        ['Maya', 'COO'],
        ['Tom', 'CFO'],
      ]);
    }
  });

  it('keeps a delimiter, a line break and a doubled quote inside a quoted cell', () => {
    const t = parseDelimited('Company,Note\r\n"Taylor & Sons, Ltd","Met at the ""Ops"" summit\r\nfollow up in May"\r\nAlder,plain');
    expect(t.rows).toEqual([
      ['Taylor & Sons, Ltd', 'Met at the "Ops" summit\nfollow up in May'],
      ['Alder', 'plain'],
    ]);
  });

  it('trims an unquoted cell, drops the spaces around quotes, and keeps what is inside them', () => {
    const t = parseDelimited('A,B,C\n  Acme Ltd  , "  spaced  " ,"x"\n');
    expect(t.rows).toEqual([['Acme Ltd', '  spaced  ', 'x']]);
  });

  it('takes the rest of the text into a cell whose quote is never closed', () => {
    const t = parseDelimited('A,B\n1,"open\n2,3');
    expect(t.rows).toEqual([['1', 'open\n2,3']]);
  });

  it('leaves out blank lines and rows of empty cells, at the end or in the middle', () => {
    const t = parseDelimited('Name,Email\n\nMaya,m@n.example\n,,\n\nTom,t@b.example\n\n\n');
    expect(t.rows).toEqual([
      ['Maya', 'm@n.example'],
      ['Tom', 't@b.example'],
    ]);
  });

  it('pads a short row and keeps a long row’s extra cells under "column N" headers', () => {
    const t = parseDelimited('Name,Email,Role\nMaya\nTom,t@b.example,CFO,extra,more');
    expect(t.headers).toEqual(['Name', 'Email', 'Role', 'column 4', 'column 5']);
    expect(t.rows).toEqual([
      ['Maya', '', '', '', ''],
      ['Tom', 't@b.example', 'CFO', 'extra', 'more'],
    ]);
  });

  it('does not widen the table for empty trailing cells an Excel export adds', () => {
    const t = parseDelimited('Name,Email,,,\nMaya,m@n.example,,,\nTom,t@b.example,,,,,');
    expect(t.headers).toEqual(['Name', 'Email']);
    expect(t.rows[1]).toEqual(['Tom', 't@b.example']);
  });

  it('names a blank header "column N" and numbers a repeated one', () => {
    const t = parseDelimited('Name,,Email,email,EMAIL,Email (2)\na,b,c,d,e,f');
    expect(t.headers).toEqual(['Name', 'column 2', 'Email', 'email (2)', 'EMAIL (3)', 'Email (2) (2)']);
    expect(new Set(t.headers.map((h) => h.toLowerCase())).size).toBe(t.headers.length);
  });

  it('reads a header with a line break in it as one line', () => {
    const t = parseDelimited('"Work\nEmail",Name\nm@n.example,Maya');
    expect(t.headers).toEqual(['Work Email', 'Name']);
  });

  it('returns nothing for empty text', () => {
    expect(parseDelimited('')).toEqual({ headers: [], rows: [], delimiter: ',', truncated: false });
    expect(parseDelimited('\n\n  \n').rows).toEqual([]);
  });

  it('returns a header and no rows for a header alone', () => {
    const t = parseDelimited('First Name,Last Name\n');
    expect(t.headers).toEqual(['First Name', 'Last Name']);
    expect(t.rows).toEqual([]);
  });
});

describe('telling the delimiter', () => {
  it('reads a semicolon file from a European Excel, commas in its values and all', () => {
    const t = parseDelimited('Name;Company;Revenue\nChen, Maya;Northwind;1,5\nOkafor, Tom;"Bright; Line";2,25\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['Name', 'Company', 'Revenue']);
    expect(t.rows).toEqual([
      ['Chen, Maya', 'Northwind', '1,5'],
      ['Okafor, Tom', 'Bright; Line', '2,25'],
    ]);
  });

  it('reads a tab-separated paste from a spreadsheet', () => {
    const t = parseDelimited('Name\tCompany\tWebsite\nMaya Chen\tNorthwind, Inc\tnorthwind.example\nTom\tBrightline\t\n');
    expect(t.delimiter).toBe('\t');
    expect(t.rows).toEqual([
      ['Maya Chen', 'Northwind, Inc', 'northwind.example'],
      ['Tom', 'Brightline', ''],
    ]);
  });

  it('counts only delimiters outside quotes', () => {
    const t = parseDelimited('Name,Note\nMaya,"a;b;c"\nTom,"d;e;f"\nAna,"g;h;i"');
    expect(t.delimiter).toBe(',');
    expect(t.rows[0]).toEqual(['Maya', 'a;b;c']);
  });

  it('keeps a comma file a comma file when one cell happens to hold a semicolon', () => {
    const t = parseDelimited('Name,Company,Email\nMaya,Northwind;Ops,m@n.example\nTom,Brightline,t@b.example');
    expect(t.delimiter).toBe(',');
    expect(t.rows[0]).toEqual(['Maya', 'Northwind;Ops', 'm@n.example']);
  });

  it('falls back to a comma for a single column', () => {
    const t = parseDelimited('Acme\nBrightline\nNorthwind');
    expect(t.delimiter).toBe(',');
    expect(t.headers).toEqual(['Acme']);
    expect(t.rows).toEqual([['Brightline'], ['Northwind']]);
  });
});

describe('the size an import is held to', () => {
  it(`keeps ${MAX_ROWS} rows and says the rest were left out`, () => {
    const lines = ['Name,Email'];
    for (let i = 0; i < MAX_ROWS + 5; i++) lines.push(`Person ${i},p${i}@acme.example`);
    const t = parseDelimited(lines.join('\n'));
    expect(t.rows).toHaveLength(MAX_ROWS);
    expect(t.rows[MAX_ROWS - 1][0]).toBe(`Person ${MAX_ROWS - 1}`);
    expect(t.truncated).toBe(true);
  });

  it(`keeps exactly ${MAX_ROWS} rows without calling it cut`, () => {
    const lines = ['Name,Email'];
    for (let i = 0; i < MAX_ROWS; i++) lines.push(`Person ${i},p${i}@acme.example`);
    lines.push('', '');
    const t = parseDelimited(lines.join('\n'));
    expect(t.rows).toHaveLength(MAX_ROWS);
    expect(t.truncated).toBe(false);
  });

  it(`keeps ${MAX_COLUMNS} columns and says the rest were left out`, () => {
    const header = Array.from({ length: 70 }, (_, i) => `h${i}`).join(',');
    const row = Array.from({ length: 70 }, (_, i) => `v${i}`).join(',');
    const t = parseDelimited(`${header}\n${row}`);
    expect(t.headers).toHaveLength(MAX_COLUMNS);
    expect(t.rows[0]).toHaveLength(MAX_COLUMNS);
    expect(t.rows[0][MAX_COLUMNS - 1]).toBe(`v${MAX_COLUMNS - 1}`);
    expect(t.truncated).toBe(true);
  });
});

describe('whether pasted text is a table', () => {
  it('is for a CSV with a header', () => {
    expect(looksTabular('First Name,Last Name,Work Email\nMaya,Chen,maya@northwind.example\nTom,Okafor,tom@brightline.example')).toBe(true);
  });

  it('is for a tab-separated paste and a semicolon file', () => {
    expect(looksTabular('Name\tCompany\nMaya\tNorthwind\nTom\tBrightline')).toBe(true);
    expect(looksTabular('Name;Company\nMaya;Northwind\nTom;Brightline')).toBe(true);
  });

  it('is not for a list of company names, one a line', () => {
    expect(looksTabular('Northwind Logistics\nBrightline Health\nAlder Analytics')).toBe(false);
  });

  it('is not for companies with their websites, since a domain is never a column name', () => {
    expect(looksTabular('Northwind, northwind.example\nBrightline, https://brightline.example\nAlder, alder.example')).toBe(false);
    expect(looksTabular('Northwind\thttps://northwind.example\nBrightline\thttps://brightline.example')).toBe(false);
  });

  it('is not for a header with no rows, or rows with no header', () => {
    expect(looksTabular('Name,Email')).toBe(false);
    expect(looksTabular('Maya,maya@northwind.example\nTom,tom@brightline.example')).toBe(false);
    expect(looksTabular('')).toBe(false);
  });

  it('is not when the rows do not split like the header', () => {
    expect(looksTabular('Name,Company,Email\nMaya\nTom\nAna, Vela')).toBe(false);
  });
});
