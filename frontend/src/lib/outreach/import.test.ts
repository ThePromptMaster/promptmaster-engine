import { describe, expect, it } from 'vitest';

import type { ContactRow, EarlierContact } from './contacts';
import { blankContact, parseJson } from './contacts';
import { parseDelimited } from './csv';
import {
  suppressedBy,
  applyHistory,
  contactKey,
  contactKeys,
  domainOf,
  DUPLICATE_REASON,
  GENERAL_INBOX_LOCALS,
  guessMapping,
  HEADER_SYNONYMS,
  inboxKind,
  isWebmail,
  markDuplicates,
  nextImportId,
  normalizeEmail,
  normalizeHeader,
  rowsFromCompanyList,
  rowsFromTable,
  SUPPRESSED_REASON,
} from './import';

function ids(prefix = 'c') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function contact(id: string, fields: Partial<ContactRow>): ContactRow {
  return { ...blankContact(id), ...fields };
}

// Sean's first test, 26 Nov: ten rows from a Clay export, two people already emailed, one person
// listed twice, a company with only a public inbox, and rows with fields missing. CRLF line ends
// and a line break inside a quoted cell, as a Windows export writes them.
const CLAY = [
  'First Name,Last Name,Job Title,Company Name,Company Domain,Work Email,Person Linkedin Url',
  'Maya,Chen,Head of Operations,Northwind Logistics,northwind.example,maya.chen@northwind.example,https://www.linkedin.com/in/maya-chen',
  'Tom,Okafor,VP Sales,Brightline Health,https://www.Brightline.example/about,Tom.Okafor@Brightline.example,',
  'Priya,Raman,COO,Harbor Freight Co,harbor.example,priya@harbor.example,',
  'Lena,Fischer,,Alder Analytics,alder.example,,https://www.linkedin.com/in/lena-fischer',
  ',,,Quarry Labs,quarry.example,info@quarry.example,',
  'Sam,Taylor,Founder,"Taylor & Sons, Ltd",,Sam.Taylor@Gmail.com,',
  'Ana,Souza,"Head of Growth\r\nEMEA",Vela Studio,vela.example,ana@vela.example,',
  'Sam,Taylor,Founder,"Taylor & Sons, Ltd",,samtaylor@gmail.com,',
  'Ravi,Mehta,Partner,Kestrel Partners,kestrel.example,,',
  'Jun,Ito,,,,jun.ito@pinecrest.example,',
].join('\r\n') + '\r\n\r\n';

const HISTORY: EarlierContact[] = [
  { address: 'maya.chen@northwind.example', on: '2026-09-01', source: 'promptmaster', subject: 'A first note' },
  { address: 'MAYA.CHEN@northwind.example', on: '2026-10-15T09:30:00Z', source: 'mailbox', subject: 'Following up' },
  { address: 'tom.okafor@brightline.example', source: 'manual' },
  { address: 'ceo@alder.example', name: 'Dana Alder', on: '2026-08-01', source: 'mailbox' },
  { address: 'old.friend@gmail.com', on: '2026-07-01', source: 'mailbox' },
];

describe("Sean's first list: ten Clay rows through import, duplicates and history", () => {
  const table = parseDelimited(CLAY);
  const mapping = guessMapping(table.headers);
  const imported = rowsFromTable({ headers: table.headers, rows: table.rows, mapping, importId: 'i1', makeId: ids() });
  const { rows: deduped, duplicates } = markDuplicates([], imported);
  const rows = applyHistory(deduped, HISTORY, [{ domain: 'kestrel.example' }]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  it('reads all ten rows and maps every Clay column', () => {
    expect(table.rows).toHaveLength(10);
    expect(mapping).toEqual({
      first_name: 'First Name',
      last_name: 'Last Name',
      role: 'Job Title',
      company: 'Company Name',
      website: 'Company Domain',
      email: 'Work Email',
      linkedin: 'Person Linkedin Url',
    });
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']);
    expect(rows.every((r) => r.import_id === 'i1')).toBe(true);
  });

  it('keeps each row exactly as imported, line break and all', () => {
    const given = parseJson<Record<string, string>>(byId.c7.given);
    expect(given).toEqual({
      'First Name': 'Ana',
      'Last Name': 'Souza',
      'Job Title': 'Head of Growth\nEMEA',
      'Company Name': 'Vela Studio',
      'Company Domain': 'vela.example',
      'Work Email': 'ana@vela.example',
      'Person Linkedin Url': '',
    });
    expect(Object.keys(parseJson<Record<string, string>>(byId.c1.given) ?? {})).toEqual(table.headers);
    expect(byId.c7.role).toBe('Head of Growth EMEA');
  });

  it('fills the contact fields from the list, saying which came from it', () => {
    expect(byId.c1).toMatchObject({
      name: 'Maya Chen',
      role: 'Head of Operations',
      company: 'Northwind Logistics',
      website: 'northwind.example',
      domain: 'northwind.example',
      email: 'maya.chen@northwind.example',
      email_kind: 'named',
      email_status: 'given',
      src_email: 'import',
      src_role: 'import',
      added: '',
    });
    expect(byId.c2).toMatchObject({ website: 'https://www.Brightline.example/about', domain: 'brightline.example', email: 'Tom.Okafor@Brightline.example' });
  });

  it('marks the person listed twice, with their Gmail address in another case and without its dots', () => {
    expect(duplicates).toBe(1);
    expect(byId.c8).toMatchObject({ duplicate_of: 'c6', status: 'skip', reason: DUPLICATE_REASON });
    expect(byId.c6.duplicate_of).toBe('');
  });

  it('holds the two people already emailed for a decision, with the latest contact', () => {
    expect(byId.c1.status).toBe('decide');
    expect(byId.c1.reason).toBe('Contacted before: 2026-10-15.');
    expect(parseJson<EarlierContact>(byId.c1.contacted)).toMatchObject({ source: 'mailbox', subject: 'Following up' });
    expect(byId.c2.status).toBe('decide');
    expect(byId.c2.reason).toBe('Contacted before: date unknown.');
    expect(rows.filter((r) => r.contacted)).toHaveLength(2);
  });

  it('calls the company with only info@ a general inbox, with no person', () => {
    expect(byId.c5).toMatchObject({ company: 'Quarry Labs', name: '', email: 'info@quarry.example', email_kind: 'general', domain: 'quarry.example' });
  });

  it('keeps rows with fields missing, and fills only what is there', () => {
    expect(byId.c4).toMatchObject({ name: 'Lena Fischer', role: '', src_role: '', email: '', email_kind: '', email_status: '', src_email: '', status: '' });
    expect(byId.c10).toMatchObject({ name: 'Jun Ito', company: '', website: '', domain: 'pinecrest.example', status: '' });
  });

  it('notes a colleague contacted at the same company, without holding the row', () => {
    expect(parseJson<EarlierContact>(byId.c4.colleague)).toMatchObject({ address: 'ceo@alder.example', name: 'Dana Alder' });
    expect(byId.c4.status).toBe('');
  });

  it('never treats a Gmail address as a company domain', () => {
    expect(byId.c6.domain).toBe('');
    expect(byId.c6.colleague).toBe('');
    expect(byId.c8.colleague).toBe('');
  });

  it('skips the company on the do-not-contact list', () => {
    expect(byId.c9).toMatchObject({ status: 'skip', reason: SUPPRESSED_REASON });
  });

  it('leaves the clean rows untouched', () => {
    for (const id of ['c3', 'c7', 'c10']) {
      expect(byId[id]).toMatchObject({ status: '', reason: '', contacted: '', colleague: '', duplicate_of: '' });
    }
  });
});

describe('guessing which column is which', () => {
  it('lists the Clay names among the synonyms, lower case', () => {
    expect(HEADER_SYNONYMS.email).toContain('work email');
    expect(HEADER_SYNONYMS.website).toContain('company domain');
    expect(HEADER_SYNONYMS.linkedin).toContain('person linkedin url');
    for (const list of Object.values(HEADER_SYNONYMS)) for (const s of list) expect(s).toBe(s.toLowerCase());
  });

  it('matches whatever the case, spacing or underscores', () => {
    expect(normalizeHeader('  Work_Email ')).toBe('work email');
    expect(guessMapping(['FIRST_NAME', 'last  name', ' Work_Email ', 'Title', 'E-Mail'])).toEqual({
      first_name: 'FIRST_NAME',
      last_name: 'last  name',
      role: 'Title',
      email: ' Work_Email ',
    });
  });

  it('prefers a full name column for the name, and the person’s LinkedIn over the company’s', () => {
    const m = guessMapping(['Company Linkedin Url', 'Full Name', 'First Name', 'Person Linkedin Url', 'Name']);
    expect(m).toMatchObject({ name: 'Full Name', first_name: 'First Name', linkedin: 'Person Linkedin Url' });
    expect(Object.values(m)).not.toContain('Company Linkedin Url');
  });

  it('takes an exact header before one that only contains a synonym', () => {
    expect(guessMapping(['Primary Email', 'Email']).email).toBe('Email');
    expect(guessMapping(['Primary Email', 'Phone']).email).toBe('Primary Email');
    expect(guessMapping(['Find Work Email', 'Current Company', 'Web Address', 'Email (2)'])).toEqual({
      email: 'Find Work Email',
      company: 'Current Company',
      website: 'Web Address',
    });
  });

  it('does not read a column about a value as the value', () => {
    const m = guessMapping(['Email Status', 'Company Size', 'Last Contacted', 'Contact Owner', 'Deal Name', 'Company LinkedIn URL']);
    expect(m).toEqual({});
  });

  it('never reads one column for two fields', () => {
    const m = guessMapping(['Company Website']);
    expect(m).toEqual({ website: 'Company Website' });
    const all = guessMapping(['Name', 'Contact', 'Person', 'Company', 'Account', 'Website', 'Domain', 'Email', 'Work Email']);
    const values = Object.values(all);
    expect(new Set(values).size).toBe(values.length);
    expect(all).toMatchObject({ name: 'Name', company: 'Company', website: 'Website', email: 'Email' });
  });

  it('maps nothing for headers it does not know', () => {
    expect(guessMapping(['Notes', 'Phone', 'City'])).toEqual({});
    expect(guessMapping([])).toEqual({});
  });
});

describe('addresses and domains', () => {
  it('normalizes an address for matching only', () => {
    expect(normalizeEmail('  Maya.Chen@Northwind.Example ')).toBe('maya.chen@northwind.example');
    expect(normalizeEmail('mailto:Tom@Brightline.example')).toBe('tom@brightline.example');
    expect(normalizeEmail('MAILTO:tom@brightline.example?subject=Hi')).toBe('tom@brightline.example');
    expect(normalizeEmail('Maya Chen <maya@northwind.example>')).toBe('maya@northwind.example');
  });

  it('reads Gmail addresses as one inbox whatever the dots or "+tag"', () => {
    expect(normalizeEmail('Sam.Taylor+crm@Gmail.com')).toBe('samtaylor@gmail.com');
    expect(normalizeEmail('s.a.m.taylor@googlemail.com')).toBe('samtaylor@gmail.com');
    // Elsewhere a dot or a tag may be a different inbox.
    expect(normalizeEmail('sam.taylor+crm@taylor.example')).toBe('sam.taylor+crm@taylor.example');
  });

  it('returns nothing for what is not an address', () => {
    for (const v of ['', '   ', 'n/a', '-', 'maya@', '@northwind.example', 'maya@northwind', 'maya chen', 'mailto:']) {
      expect(normalizeEmail(v)).toBe('');
    }
  });

  it('reads the domain from a website or an address', () => {
    expect(domainOf('https://www.Acme.com/about')).toBe('acme.com');
    expect(domainOf('http://acme.co.uk?ref=x')).toBe('acme.co.uk');
    expect(domainOf('www.acme.com')).toBe('acme.com');
    expect(domainOf('acme.com')).toBe('acme.com');
    expect(domainOf('ACME.com:8080/x#top')).toBe('acme.com');
    expect(domainOf('//cdn.acme.com/path')).toBe('cdn.acme.com');
    expect(domainOf('Maya.Chen@Northwind.Example')).toBe('northwind.example');
    expect(domainOf('@acme.com')).toBe('acme.com');
    expect(domainOf('mailto:tom@brightline.example')).toBe('brightline.example');
  });

  it('returns nothing when there is no domain', () => {
    for (const v of ['', 'Acme Inc', 'acme', 'n/a', 'https://', 'maya@']) expect(domainOf(v)).toBe('');
  });

  it('tells a general inbox from a person', () => {
    expect(GENERAL_INBOX_LOCALS).toContain('info');
    expect(GENERAL_INBOX_LOCALS).toContain('partnerships');
    expect(inboxKind('info@quarry.example')).toBe('general');
    expect(inboxKind('Sales+UK@quarry.example')).toBe('general');
    expect(inboxKind('hello@quarry.example')).toBe('general');
    expect(inboxKind('noreply@quarry.example')).toBe('general');
    expect(inboxKind('no-reply@quarry.example')).toBe('general');
    expect(inboxKind('maya.chen@northwind.example')).toBe('named');
    expect(inboxKind('information.desk@quarry.example')).toBe('named');
    expect(inboxKind('')).toBe('');
    expect(inboxKind('n/a')).toBe('');
  });

  it('knows a personal mailbox’s domain', () => {
    for (const d of ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.de', 'gmx.net', ' GMAIL.COM ']) {
      expect(isWebmail(d)).toBe(true);
    }
    for (const d of ['acme.com', 'northwind.example', 'yahoo-partners.com', 'gmailer.com', '']) expect(isWebmail(d)).toBe(false);
  });
});

describe('rows from a table', () => {
  const headers = ['Full Name', 'First', 'Last', 'Email', 'Website', 'Notes'];
  const mapping = guessMapping(headers);

  it('takes the full name, or joins first and last', () => {
    const rows = rowsFromTable({
      headers,
      rows: [
        ['Maya Chen', 'M', 'C', '', '', ''],
        ['', 'Tom', 'Okafor', '', '', ''],
        ['', '', 'Raman', '', '', ''],
      ],
      mapping,
      importId: 'i2',
      makeId: ids('r'),
    });
    expect(rows.map((r) => r.name)).toEqual(['Maya Chen', 'Tom Okafor', 'Raman']);
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('leaves out a row with nothing in any mapped column, and does not spend an id on it', () => {
    const rows = rowsFromTable({
      headers,
      rows: [
        ['', '', '', '', '', 'only a note'],
        ['', '', '', '', 'acme.com', ''],
      ],
      mapping,
      importId: 'i2',
      makeId: ids('r'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'r1', website: 'acme.com', domain: 'acme.com' });
  });

  it('keeps the address as written, and leaves out a cell that holds none', () => {
    const rows = rowsFromTable({
      headers,
      rows: [
        ['Maya Chen', '', '', ' Maya.Chen@Northwind.example ', '', ''],
        ['Tom Okafor', '', '', 'n/a', '', ''],
      ],
      mapping,
      importId: 'i2',
      makeId: ids('r'),
    });
    expect(rows[0]).toMatchObject({ email: 'Maya.Chen@Northwind.example', domain: 'northwind.example', email_status: 'given' });
    expect(rows[1]).toMatchObject({ email: '', email_kind: '', email_status: '', src_email: '' });
    expect(parseJson<Record<string, string>>(rows[1].given)?.Email).toBe('n/a');
  });

  it('takes the domain from the website before the address', () => {
    const [row] = rowsFromTable({
      headers,
      rows: [['Maya Chen', '', '', 'maya@northwind-mail.example', 'https://northwind.example', '']],
      mapping,
      importId: 'i2',
      makeId: ids('r'),
    });
    expect(row.domain).toBe('northwind.example');
  });

  it('keeps the file’s column order in what was given, even for a header that reads as a number', () => {
    const [row] = rowsFromTable({
      headers: ['Name', '2026'],
      rows: [['Maya', 'yes']],
      mapping: { name: 'Name' },
      importId: 'i2',
      makeId: ids('r'),
    });
    expect(row.given).toBe('{"Name":"Maya","2026":"yes"}');
  });

  it('ignores a mapping to a column that is not there', () => {
    const rows = rowsFromTable({ headers: ['Name'], rows: [['Maya']], mapping: { name: 'Name', email: 'Email' }, importId: 'i2', makeId: ids() });
    expect(rows[0]).toMatchObject({ name: 'Maya', email: '' });
  });
});

describe('rows from a list of companies', () => {
  const list = [
    'Northwind Logistics',
    'Brightline Health, brightline.example',
    'Harbor Freight Co - https://www.Harbor.example/en',
    'alder.example',
    'Quarry Labs\thttps://quarry.example',
    '',
    '  ',
    '- Vela Studio (vela.example)',
    '3. Coca-Cola Bottlers',
    'Kestrel Partners, info@kestrel.example',
  ].join('\r\n');
  const rows = rowsFromCompanyList(list, 'i3', ids('k'));

  it('makes one row a non-empty line', () => {
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.import_id === 'i3')).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  });

  it('reads the company and its website in each form', () => {
    expect(rows.map((r) => [r.company, r.website, r.domain])).toEqual([
      ['Northwind Logistics', '', ''],
      ['Brightline Health', 'brightline.example', 'brightline.example'],
      ['Harbor Freight Co', 'https://www.Harbor.example/en', 'harbor.example'],
      ['', 'alder.example', 'alder.example'],
      ['Quarry Labs', 'https://quarry.example', 'quarry.example'],
      ['Vela Studio', 'vela.example', 'vela.example'],
      ['Coca-Cola Bottlers', '', ''],
      ['Kestrel Partners', '', 'kestrel.example'],
    ]);
  });

  it('keeps each line exactly as it was', () => {
    expect(parseJson<{ line: string }>(rows[2].given)).toEqual({ line: 'Harbor Freight Co - https://www.Harbor.example/en' });
    expect(parseJson<{ line: string }>(rows[5].given)).toEqual({ line: '- Vela Studio (vela.example)' });
  });

  it('reads an address on the line as the company’s inbox', () => {
    expect(rows[7]).toMatchObject({ email: 'info@kestrel.example', email_kind: 'general', email_status: 'given', src_email: 'import' });
  });

  it('skips a first line that only names the columns', () => {
    const r = rowsFromCompanyList('Company, Website\nAcme, acme.com', 'i1', ids());
    expect(r).toHaveLength(1);
    expect(r[0].company).toBe('Acme');
  });

  it('keeps a bracket that belongs to the name', () => {
    const [r] = rowsFromCompanyList('Acme (UK) - acme.co.uk', 'i1', ids());
    expect(r).toMatchObject({ company: 'Acme (UK)', domain: 'acme.co.uk' });
  });

  it('returns nothing for empty text', () => {
    expect(rowsFromCompanyList('', 'i1', ids())).toEqual([]);
    expect(rowsFromCompanyList('\n\n', 'i1', ids())).toEqual([]);
  });
});

describe('marking duplicates', () => {
  const maya = contact('a1', { name: 'Maya Chen', domain: 'northwind.example', email: 'maya.chen@northwind.example' });
  const tom = contact('a2', { name: 'Tom Okafor', domain: 'brightline.example', email: '' });

  it('keys a row on its address and on its name at its domain', () => {
    expect(contactKeys(maya)).toEqual(['email:maya.chen@northwind.example', 'person:maya chen|northwind.example']);
    expect(contactKey(tom)).toBe('person:tom okafor|brightline.example');
    expect(contactKey(contact('x', { company: 'Acme' }))).toBe('');
  });

  it('matches an incoming row to an existing one, and leaves the existing rows as they were', () => {
    const existing = [maya, tom];
    const incoming = [
      contact('b1', { name: 'Maya C', domain: 'northwind.example', email: 'MAYA.CHEN@northwind.example' }),
      contact('b2', { name: ' tom  OKAFOR ', domain: 'Brightline.example', email: 'tom@brightline.example' }),
      contact('b3', { name: 'Priya Raman', domain: 'harbor.example', email: 'priya@harbor.example' }),
    ];
    const { rows, duplicates } = markDuplicates(existing, incoming);
    expect(duplicates).toBe(2);
    expect(rows[0]).toBe(maya);
    expect(rows[1]).toBe(tom);
    expect(rows.slice(2).map((r) => [r.id, r.duplicate_of, r.status, r.reason])).toEqual([
      ['b1', 'a1', 'skip', DUPLICATE_REASON],
      ['b2', 'a2', 'skip', DUPLICATE_REASON],
      ['b3', '', '', ''],
    ]);
    expect(incoming[0].duplicate_of).toBe('');
  });

  it('checks a batch against itself, pointing every repeat at the first', () => {
    const incoming = [
      contact('b1', { name: 'Sam Taylor', email: 'sam.taylor@gmail.com' }),
      contact('b2', { name: 'Sam Taylor', domain: 'taylor.example', email: 'SamTaylor@gmail.com' }),
      contact('b3', { name: 'Sam Taylor', domain: 'taylor.example', email: '' }),
    ];
    const { rows, duplicates } = markDuplicates([], incoming);
    expect(duplicates).toBe(2);
    expect(rows.map((r) => r.duplicate_of)).toEqual(['', 'b1', 'b1']);
  });

  it('does not match on a name without a domain, or a company without a person', () => {
    const incoming = [
      contact('b1', { name: 'Sam Taylor' }),
      contact('b2', { name: 'Sam Taylor' }),
      contact('b3', { company: 'Acme', domain: 'acme.com' }),
      contact('b4', { company: 'Acme', domain: 'acme.com' }),
    ];
    expect(markDuplicates([], incoming).duplicates).toBe(0);
  });
});

describe('earlier contact and the do-not-contact list', () => {
  const history: EarlierContact[] = [
    { address: 'maya.chen@northwind.example', on: '2026-10-01', source: 'mailbox', subject: 'Later' },
    { address: 'maya.chen@northwind.example', on: '2026-03-01', source: 'promptmaster', subject: 'Earlier' },
    { address: 'maya.chen@northwind.example', source: 'manual', subject: 'Undated' },
    { address: 'ops@harbor.example', on: '2026-05-01', source: 'mailbox' },
    { address: 'ceo@harbor.example', on: '2026-06-01', source: 'mailbox' },
  ];

  it('takes the most recent contact, and holds a ready row for a decision', () => {
    const rows = [contact('a1', { email: 'Maya.Chen@northwind.example', domain: 'northwind.example', status: 'ready' })];
    const [out] = applyHistory(rows, history, []);
    expect(parseJson<EarlierContact>(out.contacted)?.subject).toBe('Later');
    expect(out).toMatchObject({ status: 'decide', reason: 'Contacted before: 2026-10-01.' });
  });

  it('notes earlier contact on a row already decided, without moving it', () => {
    const rows = [contact('a1', { email: 'maya.chen@northwind.example', status: 'skip', reason: 'Not a fit.' })];
    const [out] = applyHistory(rows, history, []);
    expect(out).toMatchObject({ status: 'skip', reason: 'Not a fit.' });
    expect(out.contacted).not.toBe('');
  });

  it('notes the latest colleague at the same domain, and leaves the row’s status', () => {
    const rows = [contact('a1', { name: 'Priya Raman', email: 'priya@harbor.example', domain: 'harbor.example', status: 'ready' })];
    const [out] = applyHistory(rows, history, []);
    expect(parseJson<EarlierContact>(out.colleague)?.address).toBe('ceo@harbor.example');
    expect(out).toMatchObject({ status: 'ready', contacted: '' });
  });

  it('finds a colleague from the work address when the row has no domain of its own', () => {
    const [out] = applyHistory([contact('a1', { email: 'priya@harbor.example' })], history, []);
    expect(parseJson<EarlierContact>(out.colleague)?.address).toBe('ceo@harbor.example');
  });

  it('never makes two Gmail users colleagues', () => {
    const [out] = applyHistory(
      [contact('a1', { email: 'someone.else@gmail.com' })],
      [{ address: 'friend@gmail.com', on: '2026-01-01', source: 'mailbox' }],
      [],
    );
    expect(out.colleague).toBe('');
    expect(out.contacted).toBe('');
  });

  it('matches earlier contact on a Gmail address however its dots fall', () => {
    const [out] = applyHistory(
      [contact('a1', { email: 'Sam.Taylor@gmail.com' })],
      [{ address: 'samtaylor+news@googlemail.com', on: '2026-02-02', source: 'mailbox' }],
      [],
    );
    expect(out).toMatchObject({ status: 'decide', reason: 'Contacted before: 2026-02-02.' });
  });

  it('lets the do-not-contact list win over everything, by address or by domain', () => {
    const rows = [
      contact('a1', { email: 'maya.chen@northwind.example', domain: 'northwind.example', status: 'ready' }),
      contact('a2', { email: 'priya@harbor.example', domain: 'harbor.example', status: 'decide', reason: 'Two candidates.' }),
      contact('a3', { email: 'jun@pinecrest.example', domain: 'pinecrest.io' }),
      contact('a4', { name: 'Tom Okafor', domain: 'brightline.example' }),
    ];
    const out = applyHistory(rows, history, [
      { address: ' Maya.Chen@Northwind.example ' },
      { domain: 'harbor.example' },
      { domain: '@pinecrest.example' },
    ]);
    expect(out.map((r) => [r.status, r.reason])).toEqual([
      ['skip', SUPPRESSED_REASON],
      ['skip', SUPPRESSED_REASON],
      ['skip', SUPPRESSED_REASON],
      ['', ''],
    ]);
    expect(out[0].contacted).not.toBe('');
  });

  it('keeps a duplicate a duplicate', () => {
    const dup = contact('a2', { email: 'maya.chen@northwind.example', duplicate_of: 'a1', status: 'skip', reason: DUPLICATE_REASON });
    const [plain] = applyHistory([dup], history, []);
    expect(plain).toMatchObject({ duplicate_of: 'a1', status: 'skip', reason: DUPLICATE_REASON });
    const [blocked] = applyHistory([dup], history, [{ domain: 'northwind.example' }]);
    expect(blocked).toMatchObject({ duplicate_of: 'a1', status: 'skip', reason: SUPPRESSED_REASON });
  });

  it('returns new rows and never changes the ones it was given', () => {
    const row = contact('a1', { email: 'maya.chen@northwind.example', status: '' });
    const before = { ...row };
    const [out] = applyHistory([row], history, [{ domain: 'northwind.example' }]);
    expect(out).not.toBe(row);
    expect(row).toEqual(before);
  });
});

describe('import ids', () => {
  it('counts on from the highest', () => {
    expect(nextImportId([])).toBe('i1');
    expect(nextImportId([{ id: 'i1' }, { id: 'i3' }, { id: 'i2' }])).toBe('i4');
    expect(nextImportId([{ id: 'x9' }, { id: 'i10' }, { id: '' }])).toBe('i11');
  });
});

describe('suppressedBy (27 Nov pass)', () => {
  it('stops every spelling of an opted-out Gmail address, and a suppressed domain', () => {
    const list = [{ address: 'jane.doe@gmail.com', domain: null }, { address: null, domain: 'acme.example' }];
    expect(suppressedBy('JaneDoe+news@googlemail.com', list)).toBe('jane.doe@gmail.com');
    expect(suppressedBy('sam@ACME.example', list)).toBe('acme.example');
    expect(suppressedBy('jane.doe@work.example', list)).toBeNull();
    // Outside Gmail a dot or a +tag can be another person: compared as written.
    expect(suppressedBy('j.ane@work.example', [{ address: 'jane@work.example' }])).toBeNull();
  });
});
