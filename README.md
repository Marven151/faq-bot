# faq-bot

[![tests](https://github.com/Marven151/faq-bot/actions/workflows/test.yml/badge.svg)](https://github.com/Marven151/faq-bot/actions/workflows/test.yml)

A FAQ assistant for a small business website. Visitors type a question ("do you take MetLife?", "my tooth is killing me", "where do I park?") and get the answer from the business's own FAQ, with the phone number, opening hours and booking link one tap away. When it does not know, it hands the visitor to the office by email or phone and saves the question so the owner can add an answer.

**Live demo:** https://marven151.github.io/faq-bot/ (a fictional dental practice, Alder Street Dental)

It runs entirely in the visitor's browser: no AI service, no API keys, no monthly fees, no visitor data sent anywhere. The whole widget is one script and one stylesheet, 29 KB together (about 10 KB gzipped).

## The offer

**FAQ assistant for your website, set up from your FAQ: $150–$300, one-time.**

| | Basic, $150 | Standard, $300 |
|---|---|---|
| Questions and answers written from your existing FAQ, website and price list | up to 20 | up to 50 |
| Hours, "open now" status, phone and booking link | yes | yes |
| Colors matched to your site, installed on your site (WordPress, Squarespace, Wix, Webflow, Shopify or plain HTML) | yes | yes |
| Unanswered questions sent to a Google Sheet you own, not just stored in one browser | | yes |
| One round of tuning after two weeks, using the questions visitors actually asked | | yes |

Delivery: 2 business days from receiving your FAQ (or your website address, if the answers are already on it).

**Optional upgrade later:** when the FAQ has grown and you want free-form answers, the same widget can call an AI model (for example Claude or GPT) that answers only from your FAQ, with the current matcher kept as the fallback. That needs a small server-side proxy so no API key is exposed, and adds a usage cost of a few dollars a month for a typical small business. Quoted separately.

### What the visitor gets

- Answers in plain language from your FAQ, tolerant of typos ("apointment"), word forms ("cleaned", "cleanings") and the words people really use ("toothache", "how much", "do you take").
- Suggestions ("Did you mean...?") when a question is close but not clear.
- A hand-off instead of a guess: email with the question already filled in, a call button, or your contact form.
- Works with a keyboard and a screen reader (labelled controls, ARIA live region for new answers, Escape to close, focus returned to the button) and fills the screen on phones.

### What the owner gets

- A list of every question the assistant could not answer, or that a visitor marked as unhelpful, with an **Export CSV** button. Open your site with `#faqbot-owner` at the end of the address to see it.
- One JSON file with the questions and answers, which anyone can edit.

The built-in list lives in the browser's `localStorage`, so on its own it only shows questions asked in that browser. That is fine for testing, but to collect questions from every visitor, set `data-log-endpoint` (see below) to a Google Apps Script web app or any URL that accepts a POST. The Standard setup includes this.

## Install

1. Copy `faq-bot.min.js`, `faq-bot.min.css` and your FAQ file (start from [`demo/alder-street-dental.json`](demo/alder-street-dental.json)) to your site.
2. Add one line before `</body>`:

```html
<script src="/faq-bot.min.js" data-faq="/faq.json" defer></script>
```

The stylesheet is loaded automatically from next to the script. Optional attributes:

| Attribute | What it does | Default |
|---|---|---|
| `data-faq` | URL of the FAQ JSON, or `#id` of a `<script type="application/json">` on the page | required |
| `data-accent` | Main color, any CSS color | `#0b6e4f` |
| `data-label` | Text on the button | `Questions?` |
| `data-position` | `right` or `left` | `right` |
| `data-css` | Stylesheet URL, if it is not next to the script | same name, `.css` |
| `data-log-endpoint` | URL that receives each unanswered question as JSON (via `sendBeacon`) | none |

From your own scripts: `FaqBot.ready.then(bot => bot.ask('Are you open Saturday?'))`, plus `bot.open()`, `bot.close()`, `bot.getUnanswered()` and `bot.exportUnanswered()`.

The widget renders inside a Shadow DOM, so your site's CSS cannot break it and its CSS cannot leak into your site. It inherits your site's font. All text from the FAQ and from visitors is escaped, and links are limited to `http(s)`, `mailto`, `tel` and relative URLs.

## The FAQ file

```json
{
  "business": {
    "name": "Alder Street Dental",
    "phone": "(503) 555-0142",
    "email": "hello@alderstreetdental.example",
    "address": "214 Alder Street, Fernwood, OR",
    "bookingUrl": "https://example.com/book",
    "contactUrl": "/contact",
    "timeZone": "America/Los_Angeles",
    "hours": { "mon": [["08:00", "17:00"]], "sat": [["09:00", "13:00"]], "sun": [] }
  },
  "greeting": "Hi! I can answer questions about...",
  "starters": ["Do you take my insurance?", "How much is a cleaning?"],
  "disclaimer": "Answers come from the practice's FAQ.",
  "synonyms": { "cost": ["price", "how much", "fee"], "emergency": ["toothache", "killing me"] },
  "faqs": [
    {
      "id": "cleaning-cost",
      "question": "How much is a cleaning?",
      "keywords": ["cleaning", "cost", "exam"],
      "answer": "A cleaning, exam and x-rays costs $189 for self-pay patients.",
      "links": [{ "label": "Book a cleaning", "url": "booking" }]
    }
  ]
}
```

- `hours` use 24-hour times in the business's `timeZone`, so "Open now, closes at 5 PM" is right for a visitor in another state. A day can have several ranges (`[["08:00","12:30"],["13:15","17:00"]]`).
- Hours, address and phone answers are created automatically from `business`. Add an entry with the id `_hours`, `_location` or `_phone` to replace one.
- In `links`, the `url` can be a real URL or one of `phone`, `email`, `booking`, `contact`.
- Line breaks in an answer become paragraphs.

## How the matching works

No model, just careful text matching, which is fast, predictable and free:

1. Both the visitor's question and every FAQ entry are normalized: lowercase, accents and punctuation removed, `don't` becomes `dont`.
2. Multi-word synonyms are replaced first (`"how much"` becomes `cost`, `"killing me"` becomes `emergency`), then single words, then a light stemmer maps word forms together (`cleanings`, `cleaned`, `cleaning`).
3. Common filler words are dropped. Unknown words longer than four letters are matched to a known word one or two typos away.
4. Each entry is scored by how much of the question it covers, with rare words counting more than common ones (inverse document frequency), words in the entry's question and keywords counting three times more than words in its answer, and a bonus when a multi-word keyword appears verbatim.
5. A score of 0.5 or more is answered. Between 0.22 and 0.5 the visitor gets "Did you mean...?" choices. Below that, the hand-off.

## Development

No packages to install. Node 22 or newer.

```bash
node build.js    # writes faq-bot.min.js and faq-bot.min.css from the sources
node --test      # runs test/matcher.test.js against the source and the minified build
```

To try the demo locally, serve the folder (the FAQ file is fetched, so `file://` will not work):

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

The tests cover normalization, stemming, synonyms, typo distance, 27 real visitor questions against the demo FAQ, hand-off on unrelated questions, opening hours across time zones, the capped unanswered log, CSV escaping (including spreadsheet formula injection) and HTML/URL escaping. The demo page was also checked in headless Chrome at 1280 and 390 pixels wide: keyboard open and close, focus return, live region, hand-off, logging, owner export and the full-screen phone layout.

## Credits

Built by Marcin Świerczyński ([Marven151](https://github.com/Marven151)). Alder Street Dental, Fernwood and every name, price and phone number in the demo are made up. MIT License.
