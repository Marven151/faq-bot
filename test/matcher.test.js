'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'alder-street-dental.json'), 'utf8'));

// The same suite runs against the source and the minified build.
const builds = [['faq-bot.js', require('../faq-bot.js')]];
if (fs.existsSync(path.join(root, 'faq-bot.min.js'))) builds.push(['faq-bot.min.js', require('../faq-bot.min.js')]);

for (const [name, F] of builds) {
  const index = F.buildIndex(data);
  const top = (q) => {
    const m = F.match(index, q);
    return { status: m.status, id: m.results[0] && m.results[0].entry.id, score: m.results[0] && m.results[0].score };
  };

  test(`${name}: normalize strips case, accents and punctuation`, () => {
    assert.equal(F.normalize('  Do YOU take Délta-Dental?? '), 'do you take delta dental');
    assert.equal(F.normalize("Don't"), 'dont');
    assert.equal(F.normalize('X-ray & cleaning'), 'x ray and cleaning');
    assert.equal(F.normalize(null), '');
  });

  test(`${name}: stem maps word forms to one root`, () => {
    for (const [a, b] of [['cleaning', 'cleaned'], ['cleanings', 'clean'], ['scheduled', 'schedule'],
      ['prices', 'price'], ['whitening', 'whiten'], ['cavities', 'cavity'], ['stopped', 'stop']]) {
      assert.equal(F.stem(a), F.stem(b), `${a} vs ${b}`);
    }
    assert.equal(F.stem('glass'), 'glass');
    assert.equal(F.stem('2026'), '2026');
  });

  test(`${name}: synonyms map variants, including phrases, to one token`, () => {
    const syn = F.compileSynonyms({ emergency: ['toothache', 'killing me', 'pain'], cost: ['how much', 'price'] });
    assert.deepEqual(F.analyze('How much is it?', syn), ['cost']);
    assert.deepEqual(F.analyze('my tooth is killing me', syn), ['tooth', 'emergency']);
    assert.deepEqual(F.analyze('Toothaches and prices', syn), ['emergency', 'cost']);
  });

  test(`${name}: editDistance handles typos and transpositions`, () => {
    assert.equal(F.editDistance('apointment', 'appointment', 2), 1);
    assert.equal(F.editDistance('insurnace', 'insurance', 2), 1);
    assert.equal(F.editDistance('cat', 'dentist', 1), 2);
  });

  test(`${name}: answers real visitor questions with the right entry`, () => {
    const cases = {
      'Do you take Delta Dental?': 'insurance',
      'do u accept metlife': 'insurance',
      'How much is a cleaning?': 'cleaning-cost',
      'my tooth is killing me': 'emergency',
      'I chipped my tooth': 'emergency',
      'Where do I park?': 'parking',
      'are you open on saturday': '_hours',
      'what are your hours': '_hours',
      "what if I don't have insurance": 'no-insurance',
      'how do i book': 'book',
      'can I reschedule my appointment': 'cancel',
      'do you see kids': 'kids',
      "I'm scared of the dentist": 'nervous',
      'teeth whitening price': 'whitening',
      'braces for my son': 'aligner',
      'implant cost': 'implant',
      'root canal': 'root-canal',
      'is an x-ray safe': 'xray',
      'do you speak spanish': 'spanish',
      "what's your address": '_location',
      'phone number': '_phone',
      'do you have payment plans': 'payment',
      'Can I pay with my HSA card?': 'payment',
      'how much is a crown': 'crown',
      'how often should I get my teeth cleaned': 'cleaning-often',
      'what should i bring to my first appointment': 'new-patient',
      'are you accepting new patients': 'new-patient'
    };
    for (const [q, id] of Object.entries(cases)) {
      const r = top(q);
      assert.equal(r.status, 'answer', `"${q}" should be answered (got ${r.status} ${r.id} ${r.score})`);
      assert.equal(r.id, id, `"${q}" matched ${r.id}`);
    }
  });

  test(`${name}: tolerates typos`, () => {
    assert.equal(top('apointment').id, 'book');
    assert.equal(top('do you take my insurence').id, 'insurance');
    assert.equal(top('how much is whitning').id, 'whitening');
  });

  test(`${name}: hands off instead of guessing on unrelated questions`, () => {
    for (const q of ['what is the weather like', 'do you fix cars', 'do you do veneers', 'do you sell car insurance']) {
      assert.notEqual(top(q).status, 'answer', `"${q}" should not get a confident answer`);
    }
  });

  test(`${name}: small talk and empty input are not matched`, () => {
    for (const q of ['hi', 'thanks!', '   ', '???']) assert.equal(F.match(index, q).status, 'empty');
  });

  test(`${name}: built-in entries come from business info and can be overridden`, () => {
    const ids = index.docs.map((d) => d.entry.id);
    assert.ok(ids.includes('_hours') && ids.includes('_location') && ids.includes('_phone'));
    const custom = F.buildIndex({
      business: { phone: '555-0100' },
      faqs: [{ id: '_phone', question: 'How do I reach you?', answer: 'Text us any time.' }]
    });
    const phones = custom.docs.filter((d) => d.entry.id === '_phone');
    assert.equal(phones.length, 1);
    assert.equal(phones[0].entry.answer, 'Text us any time.');
  });

  test(`${name}: entries without a question or answer are skipped`, () => {
    const idx = F.buildIndex({ faqs: [{ id: 'a', question: 'Q?' }, { id: 'b', answer: 'A' }, null] });
    assert.equal(idx.docs.length, 0);
    assert.equal(F.match(idx, 'anything at all').status, 'none');
  });

  test(`${name}: formats times and groups opening hours`, () => {
    assert.equal(F.formatTime('08:00'), '8 AM');
    assert.equal(F.formatTime('12:30'), '12:30 PM');
    assert.equal(F.formatTime('00:00'), '12 AM');
    assert.equal(F.formatTime('17:05'), '5:05 PM');
    assert.deepEqual(F.formatHours(data.business.hours), [
      'Mon–Tue: 8 AM–5 PM', 'Wed: 10 AM–7 PM', 'Thu: 8 AM–5 PM',
      'Fri: 8 AM–2 PM', 'Sat: 9 AM–1 PM', 'Sun: Closed'
    ]);
  });

  test(`${name}: open status uses the business's time zone`, () => {
    const h = data.business.hours;
    const tz = 'America/Los_Angeles';
    // Tuesday 2026-11-03 10:00 in Oregon is 18:00 UTC.
    assert.deepEqual(F.openStatus(h, tz, new Date('2026-11-03T18:00:00Z')), { open: true, text: 'Open now, closes at 5 PM' });
    // Tuesday 06:30 local: opens later today.
    assert.equal(F.openStatus(h, tz, new Date('2026-11-03T14:30:00Z')).text, 'Closed now, opens today at 8 AM');
    // Tuesday 18:00 local: Wednesday opens at 10.
    assert.equal(F.openStatus(h, tz, new Date('2026-11-04T02:00:00Z')).text, 'Closed now, opens tomorrow at 10 AM');
    // Saturday 14:00 local: closed Sunday, so Monday.
    assert.equal(F.openStatus(h, tz, new Date('2026-11-07T22:00:00Z')).text, 'Closed now, opens Monday at 8 AM');
    // Same instant, different zone: 18:00 UTC is 1 PM in New York on a Tuesday.
    assert.equal(F.openStatus(h, 'America/New_York', new Date('2026-11-03T18:00:00Z')).open, true);
    assert.equal(F.openStatus({ mon: [] }, tz, new Date()).text, 'Closed');
    assert.equal(F.openStatus(null), null);
  });

  test(`${name}: unanswered log is capped and survives bad storage`, () => {
    const mem = {};
    const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
    for (let i = 0; i < 205; i++) F.appendLog(storage, { question: 'q' + i });
    const log = F.readLog(storage);
    assert.equal(log.length, 200);
    assert.equal(log[0].question, 'q5');
    mem['faqbot:unanswered'] = '{not json';
    assert.deepEqual(F.readLog(storage), []);
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    assert.equal(F.appendLog(full, { question: 'x' }).length, 1);
  });

  test(`${name}: CSV export escapes quotes, commas, newlines and formulas`, () => {
    const csv = F.toCsv([
      { at: '2026-10-30T10:00:00Z', question: 'Do you take "Delta", or not?', reason: 'no-match', page: '/' },
      { at: '2026-10-30T10:01:00Z', question: '=HYPERLINK("x")\nsecond line', reason: 'unsure', page: '/faq' }
    ]);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'asked_at,question,reason,page');
    assert.equal(lines[1], '2026-10-30T10:00:00Z,"Do you take ""Delta"", or not?",no-match,/');
    assert.ok(lines[2].startsWith('2026-10-30T10:01:00Z,"\'=HYPERLINK(""x"")\nsecond'));
  });

  test(`${name}: HTML and URLs are made safe`, () => {
    assert.equal(F.escapeHtml('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
    assert.equal(F.safeUrl('javascript:alert(1)'), '');
    assert.equal(F.safeUrl(' JAVASCRIPT:alert(1)'), '');
    assert.equal(F.safeUrl('data:text/html,hi'), '');
    assert.equal(F.safeUrl('https://example.com/book'), 'https://example.com/book');
    assert.equal(F.safeUrl('#book'), '#book');
    assert.equal(F.safeUrl('/contact'), '/contact');
    assert.equal(F.safeUrl('mailto:a@b.example'), 'mailto:a@b.example');
  });
}

test('demo FAQ file is valid and every entry has an id, question and answer', () => {
  const ids = new Set();
  for (const f of data.faqs) {
    assert.ok(f.id && f.question && f.answer, JSON.stringify(f).slice(0, 60));
    assert.ok(!ids.has(f.id), 'duplicate id ' + f.id);
    ids.add(f.id);
  }
});

test('widget files stay under 30 KB together', () => {
  const size = ['faq-bot.min.js', 'faq-bot.min.css']
    .reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  assert.ok(size < 30 * 1024, `widget is ${size} bytes`);
});
