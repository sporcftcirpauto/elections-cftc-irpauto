/* Espace équipe – tableau de bord des statistiques du site (GoatCounter).
   Le site envoie ses mesures à GoatCounter (anonymes, sans cookie, voir main.js).
   Ici, on les relit avec une clé API GoatCounter en lecture seule. Cette clé est enregistrée
   dans tracts/stats.json, chiffrée (AES-GCM) avec une clé dérivée de la clé GitHub de
   l'espace équipe (HKDF-SHA256) : seules les personnes connectées peuvent l'utiliser. */
(function () {
  'use strict';

  var A = window.CFTC_ADMIN;
  if (!A || !window.fetch || !window.crypto || !crypto.subtle || !document.getElementById('tab-stats')) return;

  var CODE = 'sporcftcirpauto';
  // En local uniquement : ?gc=http://localhost:8767/gc pointe vers une fausse API de test.
  var GC = (A.local && new URLSearchParams(location.search).get('gc')) || 'https://' + CODE + '.goatcounter.com';
  var GC_API = GC + '/api/v0';
  var STATS_PATH = 'tracts/stats.json';
  var SITE_START = new Date(2026, 10, 12);   // premier jour de mesure
  var TAB_KEY = 'cftc-admin-onglet';
  var NBSP = ' ';

  var gcKey = null;
  var started = false;
  var period = '7j';
  var cache = {};
  var loading = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svgIcon(id) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#' + id); s.appendChild(u);
    return s;
  }

  /* ---------- Messages ---------- */
  function msg(kind, text) {
    var box = $('stats-msg');
    box.className = 'notice notice-' + kind;
    box.textContent = '';
    box.appendChild(svgIcon(kind === 'error' ? 'i-alert' : kind === 'success' ? 'i-check' : 'i-info'));
    box.appendChild(el('p', '', text));
    box.hidden = false;
  }
  function clearMsg() { $('stats-msg').hidden = true; }

  /* ---------- Onglets « Tracts » / « Statistiques du site » ---------- */
  var tabs = [$('tab-btn-tracts'), $('tab-btn-stats')];
  function selectTab(name, focus) {
    tabs.forEach(function (b) {
      var on = b.id === 'tab-btn-' + name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) b.focus();
    });
    var box = document.querySelector('.admin-container');
    if (box) box.classList.toggle('is-wide', name === 'stats');
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* préférence non mémorisée */ }
    if (name === 'stats') openStats();
  }
  tabs.forEach(function (b, i) {
    b.addEventListener('click', function () { selectTab(b.id.replace('tab-btn-', '')); });
    b.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.id.replace('tab-btn-', ''), true);
    });
  });
  function lastTab() { try { return localStorage.getItem(TAB_KEY) === 'stats' ? 'stats' : 'tracts'; } catch (e) { return 'tracts'; } }

  document.addEventListener('equipe:connecte', function () { selectTab(lastTab()); });
  document.addEventListener('equipe:deconnecte', function () { gcKey = null; started = false; cache = {}; });
  // stats.js peut se charger après la connexion automatique
  if (A.token() && !$('app').hidden) selectTab(lastTab());

  /* ---------- Clé GoatCounter chiffrée avec la clé GitHub de l'espace équipe ---------- */
  var enc = new TextEncoder();
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(str) { var s = atob(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function aesKey(salt) {
    return crypto.subtle.importKey('raw', enc.encode(A.token() || ''), 'HKDF', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: enc.encode('cftc-stats-goatcounter') },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function seal(key) {
    var salt = rand(16), iv = rand(12);
    return aesKey(salt)
      .then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify({ cle: key }))); })
      .then(function (ct) {
        return { v: 1, service: 'goatcounter', code: CODE, kdf: 'HKDF-SHA256', sel: b64(salt), iv: b64(iv),
                 donnees: b64(new Uint8Array(ct)), cree_le: new Date().toISOString() };
      });
  }
  function unseal(obj) {
    return aesKey(unb64(obj.sel))
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, k, unb64(obj.donnees)); })
      .then(function (plain) {
        var d = JSON.parse(new TextDecoder().decode(plain));
        if (!d || typeof d.cle !== 'string') throw new Error('contenu inattendu');
        return d.cle;
      });
  }
  function readStatsFile() {
    return A.api(A.repoPath + '/contents/' + STATS_PATH + '?ref=' + A.branch, { accept: 'application/vnd.github.raw+json', raw: true })
      .then(function (txt) {
        var o = JSON.parse(txt);
        return o && o.v === 1 && o.sel && o.iv && o.donnees ? o : null;
      }, function (err) { if (err.status === 404) return null; throw err; });
  }

  /* ---------- API GoatCounter ---------- */
  function gc(path, params, retried) {
    var qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(GC_API + path + (qs ? '?' + qs : ''), { headers: { 'Authorization': 'Bearer ' + gcKey }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 429 && !retried) {
          return new Promise(function (ok) { setTimeout(ok, 1200); }).then(function () { return gc(path, params, true); });
        }
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; e.gc = true; throw e; }
        return r.json();
      }, function () { var e = new Error('réseau'); e.status = 0; e.gc = true; throw e; });
  }
  function explainGc(err) {
    if (!err || !err.gc) return A.explain(err);
    if (err.status === 401) return 'GoatCounter refuse la clé : vérifiez qu\'elle a été copiée en entier, ou créez-en une nouvelle.';
    if (err.status === 403) return 'Cette clé n\'a pas le droit de lire les statistiques : en la créant sur GoatCounter, cochez « Read statistics ».';
    if (err.status === 404) return 'Le compte GoatCounter « ' + CODE + ' » est introuvable : vérifiez le code choisi à l\'inscription.';
    if (err.status === 429) return 'Trop de demandes en même temps : réessayez dans quelques secondes.';
    if (!err.status) return 'Impossible de joindre GoatCounter. Vérifiez que le compte « ' + CODE + ' » existe et votre connexion internet.';
    return 'GoatCounter a répondu une erreur (' + err.status + '). Réessayez dans un instant.';
  }

  /* ---------- Ouverture de l'onglet ---------- */
  function showSetup(text) {
    $('stats-dash').hidden = true;
    $('stats-setup').hidden = false;
    if (text) msg('info', text); else clearMsg();
  }
  function showDash() {
    $('stats-setup').hidden = true;
    $('stats-dash').hidden = false;
    syncSkip();
  }
  function openStats() {
    if (started) { if (gcKey) { showDash(); load(period); } return; }
    started = true;
    msg('info', 'Chargement des statistiques…');
    readStatsFile().then(function (obj) {
      if (!obj) { showSetup(); return; }
      return unseal(obj).then(function (k) {
        gcKey = k;
        showDash();
        return load(period);
      }, function () {
        showSetup('La clé GoatCounter enregistrée ne peut plus être lue (la clé GitHub de l\'espace équipe a changé). Collez-la à nouveau ci-dessous.');
      });
    }).catch(function (err) {
      started = false;
      if (err && err.status === 401) A.logout();
      msg('error', 'Impossible de lire la configuration des statistiques. ' + A.explain(err));
    });
  }

  /* ---------- Enregistrement de la clé ---------- */
  $('stats-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var key = $('stats-key').value.trim();
    if (!key) { msg('error', 'Collez la clé API GoatCounter.'); $('stats-key').focus(); return; }
    var btn = $('stats-save');
    btn.disabled = true;
    msg('info', 'Vérification de la clé auprès de GoatCounter…');
    var previous = gcKey;
    gcKey = key;
    var r = range('jour');
    gc('/stats/total', { start: iso(r.start), end: iso(r.end) })
      .then(function () { msg('info', 'Enregistrement de la clé sur le site…'); return seal(key); })
      .then(function (sealed) {
        return A.commit(function () {
          return {
            entries: [{ path: STATS_PATH, mode: '100644', type: 'blob', content: JSON.stringify(sealed, null, 2) + '\n' }],
            message: 'Espace équipe : clé des statistiques'
          };
        });
      })
      .then(function () {
        $('stats-key').value = '';
        cache = {};
        showDash();
        msg('success', 'Les statistiques sont connectées.');
        load(period, true, true);
      })
      .catch(function (err) {
        gcKey = previous;
        if (err && !err.gc && err.status === 401) A.logout();
        msg('error', 'La clé n\'a pas été enregistrée. ' + explainGc(err));
      })
      .then(function () { btn.disabled = false; });
  });
  $('stats-change').addEventListener('click', function () {
    showSetup('Collez la nouvelle clé API GoatCounter : elle remplacera l\'ancienne pour toute l\'équipe.');
    $('stats-key').focus();
  });

  /* ---------- Ne pas compter mes visites (même réglage que #toggle-goatcounter) ---------- */
  function syncSkip() {
    try { $('stats-skip').checked = localStorage.getItem('skipgc') === 't'; } catch (e) { $('stats-skip').disabled = true; }
  }
  $('stats-skip').addEventListener('change', function () {
    try {
      if (this.checked) localStorage.setItem('skipgc', 't'); else localStorage.removeItem('skipgc');
      msg('success', this.checked ? 'Vos visites sur ce navigateur ne seront plus comptées.' : 'Vos visites sur ce navigateur sont de nouveau comptées.');
    } catch (err) { msg('error', 'Ce navigateur ne permet pas d\'enregistrer ce réglage.'); }
  });

  /* ---------- Périodes ---------- */
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function range(p) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var end = new Date(now); end.setMinutes(0, 0, 0); end.setHours(end.getHours() + 1);
    var start = p === 'jour' ? today : p === '7j' ? addDays(today, -6) : p === '30j' ? addDays(today, -29) : new Date(SITE_START);
    if (start < SITE_START) start = new Date(SITE_START);
    if (start > today) start = today;
    var days = [];
    for (var d = new Date(start); d <= today; d = addDays(d, 1)) days.push(d);
    return { start: start, end: end, days: days, today: today };
  }

  var segs = Array.prototype.slice.call(document.querySelectorAll('.seg-btn'));
  segs.forEach(function (b) {
    b.addEventListener('click', function () { if (!loading) load(b.getAttribute('data-period')); });
  });
  function updateSeg() {
    segs.forEach(function (b) {
      var on = b.getAttribute('data-period') === period;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  $('stats-refresh').addEventListener('click', function () { if (!loading) load(period, true); });

  /* ---------- Chargement ---------- */
  function setLoading(on) {
    loading = on;
    $('stats-dash').classList.toggle('is-loading', on);
    $('stats-refresh').disabled = on;
    if (on) $('stats-updated').textContent = 'Chargement…';
  }
  function load(p, force, keepMsg) {
    period = p;
    updateSeg();
    if (cache[p] && !force) { render(cache[p]); return Promise.resolve(); }
    var r = range(p);
    var params = { start: iso(r.start), end: iso(r.end) };
    var out = { r: r, period: p };
    setLoading(true);
    return gc('/stats/hits', Object.assign({ limit: 100 }, params))
      .then(function (h) { out.hits = h.hits || []; return gc('/stats/toprefs', Object.assign({ limit: 8 }, params)); })
      .then(function (t) { out.refs = t.stats || []; return gc('/stats/sizes', params); })
      .then(function (s) {
        out.sizes = s.stats || [];
        out.at = new Date();
        cache[p] = out;
        if (!keepMsg) clearMsg();
        if (period === p) render(out);
      })
      .catch(function (err) {
        msg('error', 'Les statistiques n\'ont pas pu être chargées. ' + explainGc(err));
        $('stats-updated').textContent = '';
      })
      .then(function () { setLoading(false); if (cache[p]) stamp(cache[p]); });
  }
  function stamp(d) {
    $('stats-updated').textContent = 'Mis à jour à ' + d.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Calculs ---------- */
  var TIME_STEPS = [[10, '10s', 'Plus de 10 secondes'], [30, '30s', 'Plus de 30 secondes'], [60, '1min', 'Plus d\'1 minute'],
                    [120, '2min', 'Plus de 2 minutes'], [300, '5min', 'Plus de 5 minutes'], [600, '10min', 'Plus de 10 minutes']];
  var SECTIONS = [['ambition', 'Notre ambition'], ['bilan', 'Notre bilan'], ['engagements', 'Nos engagements'], ['video', 'Vidéo'],
                  ['equipe', 'Notre équipe'], ['tracts', 'Nos tracts & vidéos'], ['comment-voter', 'Comment voter ?'],
                  ['questions', 'Vos questions'], ['vote', 'Jouons collectif (bas de page)']];
  var DOCS = [['pdf-cftc-profession-de-foi', 'Profession de foi'], ['pdf-cftc-liste-candidats', 'Liste des candidats'],
              ['pdf-cftc-nos-engagements', 'Nos engagements'], ['pdf-cftc-notre-ambition', 'Notre ambition'],
              ['pdf-cftc-notre-bilan', 'Notre bilan'], ['pdf-profession-de-foi-cftc-irp-auto-2026', 'Document complet (4 pages)']];
  var BUTTONS = [['bouton-entrez-dans-l-histoire', '« Entrez dans l\'histoire »'], ['bouton-vos-questions', '« Vos questions »'],
                 ['bouton-video', '« L\'essentiel en 1\'30 »']];

  function analyse(d) {
    var ev = {}, titles = {}, visitors = 0, perDay = {}, perHour = [];
    for (var i = 0; i < 24; i++) perHour.push(0);
    var todayKey = dayKey(d.r.today);
    d.hits.forEach(function (h) {
      if (h.event) { ev[h.path] = (ev[h.path] || 0) + (h.count || 0); titles[h.path] = h.title; return; }
      visitors += h.count || 0;
      (h.stats || []).forEach(function (s) {
        perDay[s.day] = (perDay[s.day] || 0) + (s.daily || 0);
        if (s.day === todayKey && s.hourly) s.hourly.forEach(function (v, k) { if (k < 24) perHour[k] += v || 0; });
      });
    });
    return { ev: ev, titles: titles, visitors: visitors, perDay: perDay, perHour: perHour };
  }
  // Temps moyen estimé à partir des paliers (aire sous la courbe « encore là après t secondes »)
  function averageTime(ev, n) {
    if (!n) return null;
    var pts = [[0, 1]];
    TIME_STEPS.forEach(function (s) { pts.push([s[0], Math.min(1, (ev['temps-' + s[1]] || 0) / n)]); });
    for (var i = 1; i < pts.length; i++) pts[i][1] = Math.min(pts[i][1], pts[i - 1][1]);
    var t = 0;
    for (i = 1; i < pts.length; i++) t += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2;
    return t + pts[pts.length - 1][1] * 300;  // au-delà de 10 minutes : on compte 5 minutes de plus
  }

  /* ---------- Mise en forme ---------- */
  function fmt(n) { return Math.round(n).toLocaleString('fr-FR'); }
  function pct(part, total) { return total ? Math.round(part / total * 100) + NBSP + '%' : '–'; }
  function duration(sec) {
    if (sec === null) return '–';
    sec = Math.round(sec);
    if (sec < 60) return sec + NBSP + 's';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + NBSP + 'min' + (s ? ' ' + pad(s) + NBSP + 's' : '');
  }
  function dayLabel(key, long) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return long ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function plural(n, one, many) { return n > 1 ? many : one; }

  /* ---------- Affichage ---------- */
  function render(d) {
    var a = analyse(d);
    stamp(d);
    var n = a.visitors;
    var docsTotal = 0, tractsTotal = 0;
    Object.keys(a.ev).forEach(function (k) {
      if (k.indexOf('pdf-') === 0) docsTotal += a.ev[k];
      if (k.indexOf('tract-') === 0) tractsTotal += a.ev[k];
    });
    var avg = averageTime(a.ev, n);
    var video = a.ev['video-lancee'] || 0;

    // Chiffres clés
    var tiles = $('stats-tiles');
    tiles.textContent = '';
    var oneDay = d.r.days.length === 1;   // aujourd'hui seulement (ou site ouvert aujourd'hui)
    var when = oneDay ? 'aujourd\'hui' : d.period === 'tout' || d.r.start.getTime() === SITE_START.getTime()
      ? 'depuis le ' + dayLabel(dayKey(SITE_START), false) : 'sur ' + d.r.days.length + NBSP + 'jours';
    tile(tiles, 'Visiteurs', fmt(n), when, true);
    tile(tiles, 'Temps moyen sur le site', n ? '≈' + NBSP + duration(avg) : '–',
         n ? pct(a.ev['temps-1min'] || 0, n) + ' restent plus d\'1 minute' : 'pas encore de visite');
    tile(tiles, 'Vidéo lancée', fmt(video),
         video ? pct(video, n) + ' des visiteurs · ' + fmt(a.ev['video-terminee'] || 0) + ' jusqu\'au bout' : 'pas encore lancée');
    tile(tiles, 'Documents ouverts', fmt(docsTotal + tractsTotal),
         fmt(docsTotal) + ' PDF · ' + fmt(tractsTotal) + ' ' + plural(tractsTotal, 'tract', 'tracts'));
    tile(tiles, 'Questions envoyées', fmt(a.ev['question-envoyee'] || 0), 'formulaire « Vos questions »');

    // Visiteurs par jour (ou par heure pour aujourd'hui)
    var series;
    if (oneDay) {
      $('stats-chart-title').textContent = 'Visiteurs par heure, aujourd\'hui';
      series = a.perHour.map(function (v, h) { return { label: h + 'h', long: 'De ' + h + 'h à ' + (h + 1) + 'h', value: v }; });
    } else {
      $('stats-chart-title').textContent = 'Visiteurs par jour';
      series = d.r.days.map(function (day) {
        var k = dayKey(day);
        return { label: dayLabel(k, false), long: dayLabel(k, true), value: a.perDay[k] || 0 };
      });
    }
    columns($('stats-chart'), series, oneDay ? 'heure' : 'jour');

    // Vidéo, documents, boutons
    var rows = [{ group: 'Vidéo' },
      { label: 'Lancée', value: video },
      { label: 'Regardée à moitié', value: a.ev['video-moitie'] || 0 },
      { label: 'Regardée jusqu\'au bout', value: a.ev['video-terminee'] || 0 },
      { group: 'Documents PDF' }];
    DOCS.forEach(function (x) { rows.push({ label: x[1], value: a.ev[x[0]] || 0 }); });
    var tractRows = Object.keys(a.ev).filter(function (k) { return k.indexOf('tract-') === 0; })
      .sort(function (x, y) { return a.ev[y] - a.ev[x]; })
      .map(function (k) { return { label: String(a.titles[k] || k).replace(/^Tract : /, ''), value: a.ev[k] }; });
    rows.push({ group: 'Tracts' });
    if (tractRows.length) rows = rows.concat(tractRows); else rows.push({ note: 'Aucun tract ouvert sur cette période.' });
    var tractVideos = Object.keys(a.ev).filter(function (k) { return k.indexOf('video-tract-') === 0; })
      .sort(function (x, y) { return a.ev[y] - a.ev[x]; })
      .map(function (k) { return { label: String(a.titles[k] || k).replace(/^Vidéo du tract : /, ''), value: a.ev[k] }; });
    if (tractVideos.length) rows = rows.concat([{ group: 'Vidéos des tracts' }], tractVideos);
    rows.push({ group: 'Boutons' });
    BUTTONS.forEach(function (x) { rows.push({ label: x[1], value: a.ev[x[0]] || 0 }); });
    barList($('stats-clicks'), rows, n, 'visiteurs');

    // Parties du site lues (dans l'ordre de la page)
    barList($('stats-sections'), SECTIONS.map(function (x) { return { label: x[1], value: a.ev['section-' + x[0]] || 0 }; }), n, 'visiteurs');

    // Temps passé
    var tRows = [{ label: 'Moins de 10 secondes', value: Math.max(0, n - (a.ev['temps-10s'] || 0)) }]
      .concat(TIME_STEPS.map(function (s) { return { label: s[2], value: Math.min(n, a.ev['temps-' + s[1]] || 0) }; }));
    barList($('stats-time'), tRows, n, 'visiteurs');

    // Provenance
    var refTotal = d.refs.reduce(function (s, x) { return s + (x.count || 0); }, 0);
    barList($('stats-refs'), d.refs.slice(0, 7).map(function (x) { return { label: refName(x.name), value: x.count || 0 }; }), refTotal, 'visiteurs', true);

    // Appareils
    var dev = { 'Téléphone': 0, 'Tablette': 0, 'Ordinateur': 0, 'Inconnu': 0 };
    d.sizes.forEach(function (x) {
      var k = x.id === 'phone' || x.id === 'largephone' ? 'Téléphone' : x.id === 'tablet' ? 'Tablette'
            : x.id === 'desktop' || x.id === 'desktophd' ? 'Ordinateur' : 'Inconnu';
      dev[k] += x.count || 0;
    });
    var devTotal = Object.keys(dev).reduce(function (s, k) { return s + dev[k]; }, 0);
    barList($('stats-devices'), Object.keys(dev).filter(function (k) { return dev[k] || k !== 'Inconnu'; })
      .map(function (k) { return { label: k, value: dev[k] }; }), devTotal, 'visiteurs', true);
  }

  var REFS = {
    'teams.microsoft.com': 'Microsoft Teams', 'teams.live.com': 'Microsoft Teams', 'statics.teams.cdn.office.net': 'Microsoft Teams',
    'outlook.office.com': 'Outlook (e-mail)', 'outlook.office365.com': 'Outlook (e-mail)', 'outlook.live.com': 'Outlook (e-mail)',
    'mail.google.com': 'Gmail', 'www.google.com': 'Google', 'www.google.fr': 'Google', 'www.bing.com': 'Bing',
    'www.linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn', 'l.facebook.com': 'Facebook', 'm.facebook.com': 'Facebook',
    'www.facebook.com': 'Facebook', 'web.whatsapp.com': 'WhatsApp', 'android-app://com.whatsapp': 'WhatsApp'
  };
  function refName(name) {
    if (!name || name === '(no data)' || name === '(unknown)') return 'Accès direct (lien, favori, QR code)';
    return REFS[name] || name;
  }

  function tile(parent, label, value, sub, hero) {
    var t = el('div', 'stile' + (hero ? ' stile-hero' : ''));
    t.appendChild(el('p', 'stile-label', label));
    t.appendChild(el('p', 'stile-value', value));
    t.appendChild(el('p', 'stile-sub', sub));
    parent.appendChild(t);
  }

  // Liste de barres horizontales : une seule couleur, valeur et part écrites à côté
  function barList(box, rows, total, unit, shareOfTotal) {
    box.textContent = '';
    var data = rows.filter(function (r) { return 'value' in r; });
    if (!total || !data.length) { box.appendChild(el('p', 'stats-empty', 'Pas encore de données sur cette période.')); return; }
    var ul = el('ul', 'blist');
    rows.forEach(function (r) {
      if (r.group) { ul.appendChild(el('li', 'bl-group', r.group)); return; }
      if (r.note) { ul.appendChild(el('li', 'bl-note', r.note)); return; }
      var li = el('li', 'bl-row');
      var share = total ? r.value / total : 0;
      li.appendChild(el('span', 'bl-label', r.label));
      var track = el('span', 'bl-track');
      var bar = el('span', 'bl-bar');
      bar.style.width = Math.max(r.value ? 1.5 : 0, Math.min(100, share * 100)) + '%';
      track.appendChild(bar);
      li.appendChild(track);
      var val = el('span', 'bl-val');
      val.appendChild(el('b', '', fmt(r.value)));
      val.appendChild(el('small', '', pct(r.value, total)));
      li.appendChild(val);
      li.title = r.label + ' : ' + fmt(r.value) + ' ' + unit + ' (' + pct(r.value, total) + (shareOfTotal ? ' du total' : ' des visiteurs') + ')';
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  // Histogramme en colonnes avec info-bulle au survol et tableau des chiffres
  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }
  function columns(box, series, unitLabel) {
    box.textContent = '';
    var max = series.reduce(function (m, s) { return Math.max(m, s.value); }, 0);
    var total = series.reduce(function (m, s) { return m + s.value; }, 0);
    if (!total) { box.appendChild(el('p', 'stats-empty', 'Pas encore de visite sur cette période.')); return; }
    var top = niceMax(max);
    var plot = el('div', 'vc-plot');
    plot.setAttribute('role', 'group');
    plot.setAttribute('aria-label', 'Visiteurs par ' + unitLabel + ' (détail dans le tableau ci-dessous)');
    var grid = el('div', 'vc-grid');
    [1, 0.5, 0].forEach(function (f) {
      var line = el('div', 'vc-line');
      line.style.bottom = (f * 100) + '%';
      line.appendChild(el('span', 'vc-tick', fmt(top * f)));
      grid.appendChild(line);
    });
    plot.appendChild(grid);
    var cols = el('div', 'vc-cols');
    var tip = el('div', 'vc-tip');
    tip.hidden = true;
    var every = Math.max(1, Math.ceil(series.length / 8));
    var maxIndex = series.map(function (s) { return s.value; }).lastIndexOf(max);
    series.forEach(function (s, i) {
      var c = el('button', 'vc-col');
      c.type = 'button';
      c.setAttribute('aria-label', s.long + ' : ' + fmt(s.value) + ' ' + plural(s.value, 'visiteur', 'visiteurs'));
      var bar = el('span', 'vc-bar');
      bar.style.height = (s.value / top * 100) + '%';
      if (s.value && s.value / top < 0.012) bar.style.height = '2px';
      c.appendChild(bar);
      if (i === maxIndex && max) {
        var peak = el('span', 'vc-peak', fmt(max));
        peak.style.bottom = (max / top * 100) + '%';
        c.appendChild(peak);
      }
      var lab = el('span', 'vc-x', (i % every === 0 || i === series.length - 1) && (series.length - 1 - i >= every || i === series.length - 1) ? s.label : '');
      c.appendChild(lab);
      var showTip = function () {
        tip.textContent = '';
        tip.appendChild(el('strong', '', fmt(s.value) + ' ' + plural(s.value, 'visiteur', 'visiteurs')));
        tip.appendChild(el('span', '', s.long));
        tip.hidden = false;
        var pr = plot.getBoundingClientRect(), cr = c.getBoundingClientRect();
        var x = cr.left - pr.left + cr.width / 2;
        tip.style.left = Math.max(70, Math.min(pr.width - 70, x)) + 'px';
        tip.style.bottom = 'calc(' + Math.min(100, s.value / top * 100) + '% + 30px)';
      };
      c.addEventListener('pointerenter', showTip);
      c.addEventListener('focus', showTip);
      c.addEventListener('pointerleave', function () { tip.hidden = true; });
      c.addEventListener('blur', function () { tip.hidden = true; });
      cols.appendChild(c);
    });
    plot.appendChild(cols);
    plot.appendChild(tip);
    box.appendChild(plot);

    // Tableau des chiffres (accessibilité, lecture précise)
    var det = el('details', 'vc-table');
    det.appendChild(el('summary', '', 'Voir les chiffres'));
    var table = el('table');
    var thead = el('thead'), trh = el('tr');
    trh.appendChild(el('th', '', unitLabel === 'heure' ? 'Heure' : 'Jour'));
    trh.appendChild(el('th', '', 'Visiteurs'));
    thead.appendChild(trh); table.appendChild(thead);
    var tbody = el('tbody');
    series.forEach(function (s) {
      var tr = el('tr');
      tr.appendChild(el('td', '', s.long));
      tr.appendChild(el('td', '', fmt(s.value)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    det.appendChild(table);
    box.appendChild(det);
  }
})();
