/*! faq-bot 1.0.0 | MIT License | https://github.com/Marven151/faq-bot */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FaqBot = api;
    api.autoInit();
  }
}(typeof window !== 'undefined' ? window : this, function (win) {
  'use strict';

  /* ------------------------------------------------------------------
   * Matcher: pure functions, no DOM. Tested with `node --test`.
   * ------------------------------------------------------------------ */

  var STOPWORDS = toSet(('a an and any are as at be been but by can could did do does for from get ' +
    'got had has have hello hey hi how i if im in into is it its just let me my of on or our ' +
    'please should so tell than thank thanks that the their them then there these they this to ' +
    'too u ur us was we were what whats which who will with would you youre your').split(' '));

  var ANSWER_AT = 0.5;   // confident enough to answer
  var SUGGEST_AT = 0.22; // close enough to offer "did you mean"
  var RELATED_AT = 0.45; // show as a related question under an answer

  function toSet(list) {
    var s = Object.create(null);
    for (var i = 0; i < list.length; i++) s[list[i]] = true;
    return s;
  }

  function normalize(text) {
    return String(text == null ? '' : text).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['’`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function stem(word) {
    var w = word;
    if (w.length <= 3 || /\d/.test(w)) return w;
    if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
    if (/(ches|shes|xes|zes)$/.test(w)) w = w.slice(0, -2);
    else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (/ing$/.test(w) && w.length > 5) w = undouble(w.slice(0, -3));
    else if (/ed$/.test(w) && w.length > 4) w = undouble(w.slice(0, -2));
    if (/e$/.test(w) && w.length > 4) w = w.slice(0, -1);
    return w;
  }

  function undouble(w) {
    return /([^aeioulsz])\1$/.test(w) ? w.slice(0, -1) : w;
  }

  // Optimal string alignment distance with an early exit above `max`.
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  // { canonical: [variant, "multi word variant"] } -> lookup tables.
  function compileSynonyms(synonyms) {
    var words = Object.create(null);
    var phrases = [];
    Object.keys(synonyms || {}).forEach(function (key) {
      var canonical = normalize(key).replace(/ /g, '');
      if (!canonical) return;
      words[canonical] = canonical;
      words[stem(canonical)] = canonical;
      (synonyms[key] || []).forEach(function (variant) {
        var v = normalize(variant);
        if (!v) return;
        if (v.indexOf(' ') > -1) {
          phrases.push([' ' + v + ' ', ' ' + canonical + ' ']);
        } else {
          if (!(v in words)) words[v] = canonical;
          var s = stem(v);
          if (!(s in words)) words[s] = canonical;
        }
      });
    });
    phrases.sort(function (x, y) { return y[0].length - x[0].length; });
    return { words: words, phrases: phrases };
  }

  // Text -> list of canonical tokens (stopwords removed, synonyms applied).
  function analyze(text, syn) {
    var padded = ' ' + normalize(text) + ' ';
    for (var i = 0; i < syn.phrases.length; i++) {
      while (padded.indexOf(syn.phrases[i][0]) > -1) {
        padded = padded.split(syn.phrases[i][0]).join(syn.phrases[i][1]);
      }
    }
    var out = [];
    padded.split(' ').forEach(function (raw) {
      if (!raw || STOPWORDS[raw]) return;
      if (raw in syn.words) { out.push(syn.words[raw]); return; }
      var s = stem(raw);
      out.push(s in syn.words ? syn.words[s] : s);
    });
    return out;
  }

  function hoursEntry(b) {
    var lines = formatHours(b.hours);
    if (b.hoursNote) lines.push(b.hoursNote);
    return {
      id: '_hours', dynamic: 'hours',
      question: 'What are your opening hours?',
      keywords: ['hours', 'open today', 'opening times', 'weekend'],
      answer: lines.join('\n')
    };
  }

  function builtInEntries(b) {
    var list = [];
    if (b.hours) list.push(hoursEntry(b));
    if (b.address) {
      list.push({
        id: '_location', question: 'Where are you located?',
        keywords: ['location', 'address', 'directions'],
        answer: 'We are at ' + b.address + '.',
        links: b.mapUrl ? [{ label: 'Open in Maps', url: b.mapUrl }] : []
      });
    }
    if (b.phone || b.email) {
      list.push({
        id: '_phone', question: 'How can I contact you?',
        keywords: ['phone', 'contact', 'email'],
        answer: [b.phone ? 'Call us at ' + b.phone + '.' : '', b.email ? 'Email ' + b.email + '.' : '']
          .join(' ').trim(),
        links: [b.phone ? { label: 'Call', url: 'phone' } : null, b.email ? { label: 'Email', url: 'email' } : null]
          .filter(Boolean)
      });
    }
    return list;
  }

  function buildIndex(data) {
    data = data || {};
    var syn = compileSynonyms(data.synonyms);
    var faqs = (data.faqs || []).filter(function (f) { return f && f.question && f.answer; });
    var ids = toSet(faqs.map(function (f) { return f.id; }));
    var entries = builtInEntries(data.business || {})
      .filter(function (e) { return !ids[e.id]; })
      .concat(faqs);

    var df = Object.create(null);
    var docs = entries.map(function (entry) {
      var weights = Object.create(null);
      var asked = Object.create(null); // tokens of the entry's own question
      function add(text, w, isQuestion) {
        analyze(text, syn).forEach(function (t) {
          if (!weights[t] || weights[t] < w) weights[t] = w;
          if (isQuestion) asked[t] = true;
        });
      }
      add(entry.answer, 1);
      add(entry.question, 3, true);
      var phrases = [];
      (entry.keywords || []).forEach(function (k) {
        add(k, 3);
        var n = normalize(k);
        if (n.indexOf(' ') > -1) phrases.push(' ' + n + ' ');
      });
      Object.keys(weights).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      return { entry: entry, weights: weights, asked: asked, phrases: phrases };
    });

    var n = docs.length;
    var idf = Object.create(null);
    var vocab = Object.keys(df);
    vocab.forEach(function (t) { idf[t] = Math.log(1 + n / df[t]); });
    docs.forEach(function (doc) {
      doc.strong = 0;
      Object.keys(doc.asked).forEach(function (t) { doc.strong += idf[t]; });
    });
    return {
      docs: docs, idf: idf, syn: syn, unknownIdf: Math.log(1 + n),
      vocab: vocab.concat(Object.keys(syn.words))
    };
  }

  // Map a word nobody indexed to a close known word ("apointment" -> "appointment").
  function correct(token, index) {
    if (token.length < 5) return null;
    var max = token.length >= 8 ? 2 : 1;
    var best = null, bestD = max + 1;
    for (var i = 0; i < index.vocab.length; i++) {
      var v = index.vocab[i];
      if (v.length < 4) continue;
      var d = editDistance(token, v, max);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best === null) return null;
    return best in index.syn.words ? index.syn.words[best] : best;
  }

  function match(index, query) {
    var raw = analyze(query, index.syn);
    var seen = Object.create(null);
    var terms = [];
    raw.forEach(function (t) {
      var weight = 1;
      if (!(t in index.idf)) {
        var fixed = correct(t, index);
        if (fixed && fixed in index.idf) { t = fixed; weight = 0.85; }
      }
      if (seen[t]) return;
      seen[t] = true;
      terms.push({ t: t, w: weight, idf: t in index.idf ? index.idf[t] : index.unknownIdf });
    });
    if (!terms.length) return { status: 'empty', results: [], terms: [] };

    var denom = 0;
    terms.forEach(function (q) { denom += 3 * q.idf; });
    var padded = ' ' + normalize(query) + ' ';

    // Score = how much of the visitor's question the entry covers, nudged by how much
    // of the entry's own question the visitor's question covers (breaks ties).
    var results = index.docs.map(function (doc) {
      var num = 0, strongHit = 0;
      terms.forEach(function (q) {
        var w = doc.weights[q.t];
        if (!w) return;
        num += w * q.idf * q.w;
        if (doc.asked[q.t]) strongHit += q.idf;
      });
      var precision = doc.strong ? strongHit / doc.strong : 0;
      var score = (num / denom) * (0.8 + 0.2 * precision);
      for (var i = 0; i < doc.phrases.length; i++) {
        if (padded.indexOf(doc.phrases[i]) > -1) { score += 0.2; break; }
      }
      return { entry: doc.entry, score: Math.min(1, Math.round(score * 1000) / 1000) };
    }).filter(function (r) { return r.score > 0; });
    results.sort(function (a, b) { return b.score - a.score; });

    var top = results[0];
    var status = !top ? 'none' : top.score >= ANSWER_AT ? 'answer' : top.score >= SUGGEST_AT ? 'suggest' : 'none';
    return { status: status, results: results.slice(0, 4), terms: terms.map(function (q) { return q.t; }) };
  }

  /* ---------------- Hours ---------------- */

  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

  function toMinutes(hhmm) {
    var p = String(hhmm).split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
  }

  function formatTime(hhmm) {
    var m = toMinutes(hhmm) % 1440;
    var h = Math.floor(m / 60), min = m % 60;
    var suffix = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (min ? ':' + (min < 10 ? '0' : '') + min : '') + ' ' + suffix;
  }

  function dayLabel(d) { return d.charAt(0).toUpperCase() + d.slice(1); }

  function rangeText(intervals) {
    if (!intervals || !intervals.length) return 'closed';
    return intervals.map(function (iv) { return formatTime(iv[0]) + '–' + formatTime(iv[1]); }).join(', ');
  }

  // Groups consecutive days with the same hours: "Mon–Tue: 8 AM–5 PM".
  function formatHours(hours) {
    var order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    var lines = [], start = 0;
    for (var i = 1; i <= order.length; i++) {
      var prevText = rangeText(hours[order[i - 1]]);
      if (i === order.length || rangeText(hours[order[i]]) !== prevText) {
        var label = dayLabel(order[start]) + (i - 1 > start ? '–' + dayLabel(order[i - 1]) : '');
        lines.push(label + ': ' + (prevText === 'closed' ? 'Closed' : prevText));
        start = i;
      }
    }
    return lines;
  }

  // Day of week and minutes since midnight in the business's time zone.
  function zonedNow(now, timeZone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
    var get = function (type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
      return '';
    };
    return { day: DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3)), minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
  }

  function openStatus(hours, timeZone, now) {
    if (!hours) return null;
    var z = zonedNow(now || new Date(), timeZone);
    var today = hours[DAYS[z.day]] || [];
    for (var i = 0; i < today.length; i++) {
      if (z.minutes >= toMinutes(today[i][0]) && z.minutes < toMinutes(today[i][1])) {
        return { open: true, text: 'Open now, closes at ' + formatTime(today[i][1]) };
      }
    }
    for (var offset = 0; offset < 8; offset++) {
      var key = DAYS[(z.day + offset) % 7];
      var list = (hours[key] || []).slice().sort(function (a, b) { return toMinutes(a[0]) - toMinutes(b[0]); });
      for (var j = 0; j < list.length; j++) {
        if (offset > 0 || toMinutes(list[j][0]) > z.minutes) {
          var when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : DAY_NAMES[key];
          return { open: false, text: 'Closed now, opens ' + when + ' at ' + formatTime(list[j][0]) };
        }
      }
    }
    return { open: false, text: 'Closed' };
  }

  /* ---------------- Unanswered log ---------------- */

  var LOG_KEY = 'faqbot:unanswered';
  var LOG_MAX = 200;

  function readLog(storage) {
    try { return JSON.parse(storage.getItem(LOG_KEY) || '[]') || []; } catch (e) { return []; }
  }

  function appendLog(storage, item) {
    var list = readLog(storage);
    list.push(item);
    if (list.length > LOG_MAX) list = list.slice(-LOG_MAX);
    try { storage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e) { /* storage full or blocked */ }
    return list;
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheet apps from running it as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(items) {
    var rows = [['asked_at', 'question', 'reason', 'page']];
    items.forEach(function (it) { rows.push([it.at, it.question, it.reason, it.page]); });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Only http(s), mailto, tel and relative links make it into the widget.
  function safeUrl(url) {
    var u = String(url || '').trim();
    var scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(u);
    if (scheme) return /^(https?|mailto|tel)$/i.test(scheme[1]) ? u : '';
    return u;
  }

  function telHref(phone) { return 'tel:' + String(phone).replace(/[^\d+]/g, ''); }

  function mailtoHref(email, subject, body) {
    return 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* ------------------------------------------------------------------
   * Widget: DOM only from here on.
   * ------------------------------------------------------------------ */

  var doc = win.document;

  var ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-5 15-2.5-6.5z"/></svg>';

  function Widget(options, data) {
    this.o = options;
    this.data = data;
    this.b = data.business || {};
    this.index = buildIndex(data);
    this.storage = options.storage || safeStorage();
    this.isOpen = false;
    this.mount();
  }

  var proto = Widget.prototype;

  function safeStorage() {
    try {
      var s = win.localStorage;
      s.setItem('faqbot:test', '1');
      s.removeItem('faqbot:test');
      return s;
    } catch (e) {
      var mem = {};
      return {
        getItem: function (k) { return k in mem ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
  }

  proto.resolveUrl = function (url) {
    var b = this.b;
    if (url === 'phone') return b.phone ? telHref(b.phone) : '';
    if (url === 'email') return b.email ? 'mailto:' + b.email : '';
    if (url === 'booking') return safeUrl(b.bookingUrl);
    if (url === 'contact') return safeUrl(b.contactUrl);
    return safeUrl(url);
  };

  proto.mount = function () {
    var o = this.o, b = this.b, self = this;
    var host = doc.createElement('div');
    host.id = 'faqbot-root';
    if (o.accent) host.style.setProperty('--fqb-accent', o.accent);
    doc.body.appendChild(host);
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var name = esc(b.name || 'Questions');
    var actions = '';
    if (b.phone) actions += '<a class="fqb-action" href="' + esc(telHref(b.phone)) + '">Call ' + esc(b.phone) + '</a>';
    if (b.bookingUrl) actions += '<a class="fqb-action fqb-action-main" href="' + esc(this.resolveUrl('booking')) + '">' + esc(b.bookingLabel || 'Book online') + '</a>';
    if (b.hours) actions += '<button type="button" class="fqb-action" data-ask="_hours">Hours</button>';

    shadow.innerHTML =
      '<link rel="stylesheet" href="' + esc(o.css) + '">' +
      '<div class="fqb fqb-' + (o.position === 'left' ? 'left' : 'right') + '" style="visibility:hidden">' +
      '<button type="button" class="fqb-launcher" aria-expanded="false" aria-controls="fqb-panel">' +
      ICON_CHAT + '<span>' + esc(o.label || 'Questions?') + '</span></button>' +
      '<section class="fqb-panel" id="fqb-panel" role="dialog" aria-labelledby="fqb-title" hidden>' +
      '<header class="fqb-head"><div><h2 id="fqb-title">' + name + '</h2>' +
      '<p class="fqb-status"></p></div>' +
      '<button type="button" class="fqb-close" aria-label="Close questions">' + ICON_CLOSE + '</button></header>' +
      (actions ? '<div class="fqb-actions" role="group" aria-label="Contact ' + name + '">' + actions + '</div>' : '') +
      '<div class="fqb-log" role="log" aria-live="polite" aria-label="Conversation" tabindex="0"></div>' +
      '<form class="fqb-form" autocomplete="off"><label class="fqb-sr" for="fqb-input">Ask a question</label>' +
      '<input id="fqb-input" class="fqb-input" type="text" maxlength="300" placeholder="Ask a question" enterkeyhint="send">' +
      '<button type="submit" class="fqb-send" aria-label="Send question">' + ICON_SEND + '</button></form>' +
      (this.data.disclaimer ? '<p class="fqb-foot">' + esc(this.data.disclaimer) + '</p>' : '') +
      '</section></div>';

    this.root = shadow.querySelector('.fqb');
    this.launcher = shadow.querySelector('.fqb-launcher');
    this.panel = shadow.querySelector('.fqb-panel');
    this.log = shadow.querySelector('.fqb-log');
    this.input = shadow.querySelector('.fqb-input');
    this.statusEl = shadow.querySelector('.fqb-status');

    var link = shadow.querySelector('link');
    var reveal = function () { self.root.style.visibility = ''; };
    link.addEventListener('load', reveal);
    link.addEventListener('error', reveal);
    win.setTimeout(reveal, 1500);

    this.launcher.addEventListener('click', function () { self.toggle(); });
    shadow.querySelector('.fqb-close').addEventListener('click', function () { self.close(); });
    shadow.querySelector('.fqb-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = self.input.value.trim();
      if (!q) return;
      self.input.value = '';
      self.ask(q);
    });
    this.panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
    });
    this.panel.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-ask],[data-q],[data-feedback],[data-owner]') : null;
      if (!t) return;
      if (t.hasAttribute('data-ask')) self.showEntry(t.getAttribute('data-ask'));
      else if (t.hasAttribute('data-q')) self.ask(t.getAttribute('data-q'));
      else if (t.hasAttribute('data-feedback')) self.feedback(t);
      else self.ownerAction(t.getAttribute('data-owner'));
    });

    this.updateStatus();
    win.setInterval(function () { self.updateStatus(); }, 60000);
    this.greet();
    if (this.ownerMode()) this.open();
    win.addEventListener('hashchange', function () { if (self.ownerMode()) { self.open(); self.renderOwner(); } });
  };

  proto.ownerMode = function () {
    return this.o.owner || /(^|[#&?])faqbot-owner\b|[?&]faqbot=owner\b/.test(win.location.hash + win.location.search);
  };

  proto.updateStatus = function () {
    var s = openStatus(this.b.hours, this.b.timeZone);
    if (!s) return;
    this.statusEl.textContent = s.text;
    this.statusEl.setAttribute('data-open', s.open ? 'yes' : 'no');
  };

  proto.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this.panel.hidden = false;
    this.root.classList.add('fqb-is-open');
    this.launcher.setAttribute('aria-expanded', 'true');
    if (this.ownerMode()) this.renderOwner();
    var input = this.input;
    win.setTimeout(function () { input.focus(); }, 30);
  };

  proto.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    this.root.classList.remove('fqb-is-open');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.focus();
  };

  proto.toggle = function () { if (this.isOpen) this.close(); else this.open(); };

  proto.add = function (who, html) {
    var el = doc.createElement('div');
    el.className = 'fqb-msg fqb-' + who;
    el.innerHTML = html;
    this.log.appendChild(el);
    // Long answers: show their start, not their end.
    var log = this.log;
    log.scrollTop = who === 'bot' && el.offsetHeight > log.clientHeight - 24 ? el.offsetTop - 12 : log.scrollHeight;
    return el;
  };

  proto.chips = function (questions) {
    if (!questions.length) return '';
    return '<div class="fqb-chips">' + questions.map(function (q) {
      return '<button type="button" class="fqb-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('') + '</div>';
  };

  proto.greet = function () {
    var d = this.data;
    var text = d.greeting || 'Hi! Ask me anything about ' + (this.b.name || 'us') + '.';
    this.add('bot', '<p>' + esc(text) + '</p>' + this.chips(d.starters || []));
  };

  proto.answerHtml = function (entry) {
    var self = this;
    var html = '';
    if (entry.dynamic === 'hours') {
      var s = openStatus(this.b.hours, this.b.timeZone);
      if (s) html += '<p><strong>' + esc(s.text) + '.</strong></p>';
    }
    html += String(entry.answer).split(/\n+/).map(function (line) {
      return '<p>' + esc(line) + '</p>';
    }).join('');
    var links = (entry.links || []).map(function (l) {
      var href = self.resolveUrl(l.url);
      return href ? '<a class="fqb-link" href="' + esc(href) + '"' +
        (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>' : '';
    }).join('');
    if (links) html += '<div class="fqb-links">' + links + '</div>';
    return html;
  };

  proto.findEntry = function (id) {
    for (var i = 0; i < this.index.docs.length; i++) {
      if (this.index.docs[i].entry.id === id) return this.index.docs[i].entry;
    }
    return null;
  };

  proto.showEntry = function (id) {
    var entry = this.findEntry(id);
    if (!entry) return;
    if (!this.isOpen) this.open();
    this.add('user', '<p>' + esc(entry.question) + '</p>');
    this.add('bot', this.answerHtml(entry));
  };

  proto.ask = function (question) {
    if (!this.isOpen) this.open();
    this.add('user', '<p>' + esc(question) + '</p>');
    var m = match(this.index, question);
    this.lastQuestion = question;

    if (m.status === 'empty') {
      var thanks = /thank/i.test(question);
      this.add('bot', '<p>' + (thanks ? 'You are welcome. Anything else?' :
        'Ask me about hours, prices, insurance or appointments. A few people ask:') + '</p>' +
        (thanks ? '' : this.chips(this.data.starters || [])));
      return m;
    }
    if (m.status === 'answer') {
      var best = m.results[0];
      var related = m.results.slice(1).filter(function (r) { return r.score >= RELATED_AT; })
        .slice(0, 2).map(function (r) { return r.entry.question; });
      this.add('bot', this.answerHtml(best.entry) +
        (related.length ? '<p class="fqb-note">Related:</p>' + this.chips(related) : '') +
        '<div class="fqb-feedback" role="group" aria-label="Was this helpful?"><span>Did this answer it?</span>' +
        '<button type="button" data-feedback="yes">Yes</button><button type="button" data-feedback="no">No</button></div>');
      return m;
    }
    if (m.status === 'suggest') {
      this.add('bot', '<p>I am not sure I understood. Did you mean one of these?</p>' +
        this.chips(m.results.slice(0, 3).map(function (r) { return r.entry.question; })) +
        '<p class="fqb-note">None of these? </p>' + this.handoffLinks(question));
      this.record(question, 'unsure');
      return m;
    }
    this.handoff(question, 'no-match');
    return m;
  };

  proto.handoffLinks = function (question) {
    var b = this.b, links = [];
    if (b.email) {
      links.push('<a class="fqb-link" href="' + esc(mailtoHref(b.email, 'Question from your website',
        'Hi,\n\n' + question + '\n\nThanks,\n')) + '">Email the question</a>');
    }
    if (b.phone) links.push('<a class="fqb-link" href="' + esc(telHref(b.phone)) + '">Call ' + esc(b.phone) + '</a>');
    if (b.contactUrl) links.push('<a class="fqb-link" href="' + esc(this.resolveUrl('contact')) + '">Contact form</a>');
    return '<div class="fqb-links">' + links.join('') + '</div>';
  };

  proto.handoff = function (question, reason) {
    this.add('bot', '<p>I do not have an answer for that yet, so I have passed it on to the team. ' +
      'For a quick reply, send it to them directly:</p>' + this.handoffLinks(question));
    this.record(question, reason);
  };

  proto.feedback = function (button) {
    var group = button.parentNode;
    var helpful = button.getAttribute('data-feedback') === 'yes';
    group.innerHTML = '<span>' + (helpful ? 'Thanks for letting us know.' : 'Sorry about that.') + '</span>';
    if (!helpful && this.lastQuestion) this.handoff(this.lastQuestion, 'not-helpful');
  };

  proto.record = function (question, reason) {
    var item = { at: new Date().toISOString(), question: question, reason: reason, page: win.location.pathname };
    appendLog(this.storage, item);
    if (this.o.logEndpoint && win.navigator.sendBeacon) {
      try {
        win.navigator.sendBeacon(this.o.logEndpoint, new Blob([JSON.stringify(item)], { type: 'text/plain' }));
      } catch (e) { /* the local log still has it */ }
    }
    if (this.ownerBox) this.renderOwner();
  };

  proto.renderOwner = function () {
    var items = readLog(this.storage);
    if (!this.ownerBox) {
      this.ownerBox = doc.createElement('div');
      this.ownerBox.className = 'fqb-owner';
      this.panel.insertBefore(this.ownerBox, this.log);
    }
    var list = items.slice(-5).reverse().map(function (it) {
      return '<li>' + esc(it.question) + '</li>';
    }).join('');
    this.ownerBox.innerHTML = '<p><strong>Owner view:</strong> ' + items.length +
      ' unanswered question' + (items.length === 1 ? '' : 's') + ' saved in this browser.</p>' +
      (list ? '<ul>' + list + '</ul>' : '') +
      '<div class="fqb-links"><button type="button" class="fqb-link" data-owner="export"' + (items.length ? '' : ' disabled') +
      '>Export CSV</button><button type="button" class="fqb-link" data-owner="clear"' + (items.length ? '' : ' disabled') +
      '>Clear</button></div>';
  };

  proto.ownerAction = function (action) {
    if (action === 'export') this.exportUnanswered();
    if (action === 'clear' && win.confirm('Delete all saved unanswered questions from this browser?')) {
      this.storage.removeItem(LOG_KEY);
      this.renderOwner();
    }
  };

  proto.getUnanswered = function () { return readLog(this.storage); };

  proto.exportUnanswered = function () {
    var csv = toCsv(readLog(this.storage));
    var url = win.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = doc.createElement('a');
    a.href = url;
    a.download = 'faqbot-unanswered-' + new Date().toISOString().slice(0, 10) + '.csv';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 1000);
    return csv;
  };

  /* ---------------- Setup ---------------- */

  function init(options) {
    options = options || {};
    var ready = options.data ? Promise.resolve(options.data) : loadData(options.faq);
    return ready.then(function (data) {
      var start = function () { return new Widget(options, data); };
      if (doc.readyState === 'loading') {
        return new Promise(function (resolve) {
          doc.addEventListener('DOMContentLoaded', function () { resolve(start()); });
        });
      }
      return start();
    });
  }

  function loadData(src) {
    if (!src) return Promise.reject(new Error('faq-bot: set data-faq to your FAQ JSON file'));
    if (src.charAt(0) === '#') {
      var el = doc.querySelector(src);
      return el ? Promise.resolve(JSON.parse(el.textContent)) : Promise.reject(new Error('faq-bot: ' + src + ' not found'));
    }
    return win.fetch(src, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('faq-bot: could not load ' + src + ' (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  var currentScript = typeof document !== 'undefined' &&
    (document.currentScript || document.querySelector('script[data-faq]'));

  function autoInit() {
    var s = currentScript;
    if (!s || !s.getAttribute('data-faq')) return;
    var src = s.getAttribute('src') || '';
    var api = win.FaqBot;
    api.ready = init({
      faq: s.getAttribute('data-faq'),
      css: s.getAttribute('data-css') || src.replace(/\.js(\?.*)?$/, '.css$1'),
      accent: s.getAttribute('data-accent'),
      position: s.getAttribute('data-position'),
      label: s.getAttribute('data-label'),
      logEndpoint: s.getAttribute('data-log-endpoint')
    }).then(function (w) { api.instance = w; return w; }, function (err) {
      if (win.console) win.console.error(err);
    });
  }

  return {
    version: '1.0.0',
    init: init,
    autoInit: autoInit,
    normalize: normalize,
    stem: stem,
    analyze: analyze,
    compileSynonyms: compileSynonyms,
    buildIndex: buildIndex,
    match: match,
    editDistance: editDistance,
    formatTime: formatTime,
    formatHours: formatHours,
    openStatus: openStatus,
    toCsv: toCsv,
    escapeHtml: esc,
    safeUrl: safeUrl,
    readLog: readLog,
    appendLog: appendLog,
    thresholds: { answer: ANSWER_AT, suggest: SUGGEST_AT, related: RELATED_AT }
  };
}));
