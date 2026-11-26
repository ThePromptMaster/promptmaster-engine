import { describe, expect, it } from 'vitest';

import { logoSize, renderEmail, safeHttpsUrl } from './render';
import { unresolvedPlaceholders } from './placeholders';

const sender = {
  from_name: 'Sean Moran',
  from_address: 'sean@promptmasterv1.com',
  postal_address: '1 Main Street, Springfield',
  opt_out_line: 'Reply "unsubscribe" and I will not write again.',
  commercial: true,
};
const signature = {
  name: 'Sean Moran',
  title: 'Founder',
  company: 'PromptMaster',
  website: 'https://promptmasterv1.com',
  links: [{ label: 'Book a demo', url: 'https://promptmasterv1.com/demo' }],
  logo_width: 120,
};
const logo = { url: 'https://cdn.example/l/abc.png', width: 600, height: 150 };

// Sean, 26 Nov: "Put my PromptMaster signature and logo underneath … The contact details should
// still be readable if the recipient's email app hides images."
describe('an outreach email as it goes out', () => {
  const out = renderEmail({ sender, signature, logo, subject: ' A quick look ', body: 'Hi Alex,\n\nTry it at https://promptmasterv1.com.\nThanks,' });

  it('puts the logo under the signature details, sized and named', () => {
    const name = out.html.indexOf('Sean Moran');
    const img = out.html.indexOf('<img');
    expect(name).toBeGreaterThan(-1);
    expect(img).toBeGreaterThan(name);
    expect(out.html).toContain('width="120" height="30"');
    expect(out.html).toContain('alt="PromptMaster logo"');
  });

  it('keeps the details readable as text with images off', () => {
    const off = renderEmail({ sender, signature, logo, subject: 's', body: 'Hi', imagesOff: true });
    expect(off.html).not.toContain('<img');
    expect(off.html).toContain('PromptMaster logo');
    expect(off.html).toContain('Founder');
    expect(out.text).toContain('--\nSean Moran\nFounder\nPromptMaster\nhttps://promptmasterv1.com');
  });

  it('links only https addresses, and lists every link in order', () => {
    expect(out.html).toContain('<a href="https://promptmasterv1.com"');
    expect(out.links).toEqual(['https://promptmasterv1.com', 'https://promptmasterv1.com/demo']);
    const unsafe = renderEmail({ sender, signature: null, logo: null, subject: 's', body: 'See http://x.co and javascript:alert(1)' });
    expect(unsafe.html).not.toContain('<a ');
    expect(unsafe.links).toEqual([]);
  });

  it('escapes what the user typed', () => {
    const r = renderEmail({ sender, signature: null, logo: null, subject: 's', body: '<script>x</script> & "q"' });
    expect(r.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;');
    expect(r.html).not.toContain('<script>');
  });

  it('carries the postal address and the opt-out line on a commercial email, and says when one is missing', () => {
    expect(out.html).toContain('1 Main Street, Springfield');
    expect(out.text).toContain('unsubscribe');
    const bare = renderEmail({ sender: { ...sender, postal_address: '' }, signature, logo, subject: 's', body: 'Hi' });
    expect(bare.warnings).toContainEqual({ kind: 'compliance_missing', missing: ['postal_address'] });
    expect(renderEmail({ sender: { ...sender, commercial: false, postal_address: '' }, signature, logo, subject: 's', body: 'Hi' }).warnings).toEqual([]);
  });

  // "Check … whether the signature appears twice."
  it('warns when the text already carries the signature', () => {
    const twice = renderEmail({ sender, signature, logo, subject: 's', body: 'Hi Alex,\n\nThanks,\nSean Moran\nFounder, PromptMaster\npromptmasterv1.com' });
    expect(twice.warnings[0]).toMatchObject({ kind: 'signature_in_body' });
    expect(out.warnings).toEqual([]);
  });

  it('keeps the logo in shape at any width, within 40 to 300 px', () => {
    expect(logoSize(logo, 200)).toEqual({ width: 200, height: 50 });
    expect(logoSize(logo, 999)).toEqual({ width: 300, height: 75 });
    expect(logoSize(logo, 1)).toEqual({ width: 40, height: 10 });
  });

  it('only https addresses count as safe', () => {
    expect(safeHttpsUrl(' https://a.co/x ')).toBe('https://a.co/x');
    expect(safeHttpsUrl('http://a.co')).toBeNull();
    expect(safeHttpsUrl('https://a b.co')).toBeNull();
  });
});

// "Hold anything with an unresolved placeholder."
describe('placeholders left in an email', () => {
  it('finds the usual ones, once each', () => {
    expect(unresolvedPlaceholders('Hi {{first_name}}, see [Company name] at <company> by TBD. {{ first_name }}')).toEqual([
      '{{first_name}}',
      '{{ first_name }}',
      '[Company name]',
      '<company>',
      'TBD',
    ]);
  });

  it('leaves citations, numbers and ordinary words alone', () => {
    expect(unresolvedPlaceholders('As [S3] and [1] show, <br> the Xbox team in XL sizes said so.')).toEqual([]);
  });
});
