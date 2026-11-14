(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var nav = document.getElementById('menu');
  var burger = document.querySelector('.burger');
  var toTop = document.querySelector('.to-top');

  /* ---------- Menu mobile ---------- */
  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    burger.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
  }
  burger.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('is-open') && !e.target.closest('.site-header')) setMenu(false);
  });

  /* ---------- En-tête et bouton retour en haut ---------- */
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    header.classList.toggle('is-scrolled', y > 8);
    toTop.classList.toggle('is-visible', y > 700);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Lien actif dans le menu ---------- */
  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]:not(.btn)'));
  var sections = links.map(function (a) { return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window) {
    var visible = {};
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var current = null;
      sections.forEach(function (s) { if (visible[s.id] && !current) current = s.id; });
      links.forEach(function (a) { a.classList.toggle('is-active', current && a.getAttribute('href') === '#' + current); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Apparition au défilement ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Filtre de l'équipe par collège ---------- */
  var filters = document.querySelectorAll('.filter');
  var cards = document.querySelectorAll('.cand');
  var status = document.getElementById('team-status');
  var labels = { all: "toute l'équipe", employes: 'collège Employés', maitrise: 'collège Agents de maîtrise', cadres: 'collège Cadres' };

  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.getAttribute('data-filter');
      filters.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var n = 0;
      cards.forEach(function (c) {
        var show = f === 'all' || c.getAttribute('data-college') === f;
        c.hidden = !show;
        c.classList.remove('is-entering');
        if (show) {
          n++;
          void c.offsetWidth;
          c.classList.add('is-entering');
        }
      });
      if (status) status.textContent = n + ' candidats affichés : ' + labels[f];
    });
  });

  /* ---------- Nos tracts (liste publiée depuis la page « Publier un tract ») ---------- */
  var tractsSection = document.getElementById('tracts');
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var TRACTS_SHOWN = 6;

  function safePath(p) { return typeof p === 'string' && /^tracts\/[A-Za-z0-9._-]+$/.test(p) ? p : null; }
  function parseDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function icon(id) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'i');
    s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(SVG_NS, 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }

  function videoLength(sec) {
    sec = Math.round(+sec || 0);
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m ? m + '\'' + (s < 10 ? '0' : '') + s : s + ' s';
  }

  function tractCard(t) {
    var file = safePath(t.fichier);
    var video = safePath(t.video);
    var preview = safePath(t.apercu) || (t.type === 'image' ? file : null);
    var day = parseDay(t.date);
    var isNew = day && (Date.now() - day.getTime()) < 8 * 24 * 3600 * 1000;
    var li = node('li', 'tract');

    if (file) {
      var cover = node('a', 'tract-cover');
      cover.href = file; cover.target = '_blank'; cover.rel = 'noopener';
      cover.setAttribute('aria-label', 'Ouvrir le tract « ' + t.titre + ' »');
      if (preview) {
        var img = node('img');
        img.src = preview; img.alt = ''; img.loading = 'lazy';
        img.onerror = function () { img.replaceWith(fallback()); };
        cover.appendChild(img);
      } else {
        cover.appendChild(fallback());
      }
      if (isNew) cover.appendChild(node('span', 'tract-new', 'Nouveau'));
      li.appendChild(cover);
    }
    // La vidéo se place sous le tract (ou en haut de la carte s'il n'y a qu'elle)
    if (video) li.appendChild(videoBlock(t, video, isNew && !file));

    var body = node('div', 'tract-body');
    if (day) {
      var d = node('p', 'tract-date');
      d.appendChild(icon('i-calendar'));
      d.appendChild(document.createTextNode(day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })));
      body.appendChild(d);
    }
    body.appendChild(node('h3', '', t.titre));
    if (t.resume) body.appendChild(node('p', 'tract-resume', t.resume));
    if (file) {
      var actions = node('p', 'tract-actions');
      var a = node('a', 'btn btn-pink btn-sm', t.type === 'image' ? 'Voir le tract ' : 'Lire le tract ');
      a.href = file; a.target = '_blank'; a.rel = 'noopener';
      a.appendChild(icon('i-ext'));
      actions.appendChild(a);
      body.appendChild(actions);
    }
    li.appendChild(body);
    return li;
  }
  function fallback() {
    var f = node('span', 'tract-fallback');
    f.appendChild(icon('i-file'));
    f.appendChild(document.createTextNode('TRACT CFTC'));
    return f;
  }

  /* Vidéo d'un tract : l'image de la vidéo, puis le lecteur à la place au premier clic
     (rien n'est téléchargé tant que personne ne lance la vidéo) */
  function videoBlock(t, src, isNew) {
    var box = node('div', 'tract-video');
    var ratio = t.video_largeur > 0 && t.video_hauteur > 0 ? t.video_largeur / t.video_hauteur : 16 / 9;
    box.style.aspectRatio = String(Math.min(2, Math.max(0.8, ratio)));  // vidéo verticale : cadre 4:5 au plus haut
    var poster = safePath(t.video_apercu);
    var len = videoLength(t.video_duree);

    var bg = null;
    if (poster) {
      bg = node('img', 'tract-video-bg');
      bg.src = poster; bg.alt = ''; bg.loading = 'lazy';
      box.appendChild(bg);
    }
    var start = node('button', 'tract-video-start');
    start.type = 'button';
    var sec = Math.round(+t.video_duree || 0);
    start.setAttribute('aria-label', 'Lire la vidéo « ' + t.titre + ' »' +
      (sec ? ', durée ' + (sec >= 60 ? Math.floor(sec / 60) + ' min ' : '') + (sec % 60 ? sec % 60 + ' s' : '') : ''));
    if (poster) {
      var im = node('img', 'tract-video-poster');
      im.src = poster; im.alt = ''; im.loading = 'lazy';
      im.onerror = function () { im.remove(); if (bg) bg.remove(); };
      start.appendChild(im);
    }
    var play = node('span', 'tract-play');
    play.appendChild(node('span', 'tract-play-btn'));
    start.appendChild(play);
    var badge = node('span', 'tract-video-badge');
    badge.appendChild(icon('i-play'));
    badge.appendChild(document.createTextNode('Vidéo' + (len ? ' · ' + len : '')));
    start.appendChild(badge);
    if (isNew) start.appendChild(node('span', 'tract-new', 'Nouveau'));

    start.addEventListener('click', function () {
      track('video-tract-' + slug(t.id || src), 'Vidéo du tract : ' + t.titre);
      var v = node('video');
      v.controls = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-label', 'Vidéo : ' + t.titre);
      if (poster) v.poster = poster;
      v.src = src;
      start.replaceWith(v);
      if (v.focus) v.focus({ preventScroll: true });
      var p = v.play();  // lancée pendant le clic : le son est autorisé
      if (p && p.catch) p.catch(function () { /* lecture refusée : les commandes restent disponibles */ });
    });
    box.appendChild(start);
    return box;
  }

  // Une seule vidéo à la fois : en lancer une met les autres en pause
  document.addEventListener('play', function (e) {
    document.querySelectorAll('video').forEach(function (v) { if (v !== e.target && !v.paused) v.pause(); });
  }, true);

  function renderTracts(list) {
    list = (list || []).filter(function (t) { return t && t.titre && (safePath(t.fichier) || safePath(t.video)); });
    list.sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || String(b.publie_le || '').localeCompare(String(a.publie_le || ''));
    });
    // Aucun tract publié : le message « Nos tracts et vidéos arrivent très bientôt » reste affiché.
    if (!list.length) return;
    var ul = document.getElementById('tracts-list');
    list.forEach(function (t, i) {
      var li = tractCard(t);
      if (i >= TRACTS_SHOWN) li.hidden = true;
      ul.appendChild(li);
    });
    ul.hidden = false;
    document.getElementById('tracts-empty').hidden = true;
    if (list.length > TRACTS_SHOWN) {
      var wrap = document.getElementById('tracts-more-wrap');
      wrap.hidden = false;
      document.getElementById('tracts-more').addEventListener('click', function () {
        ul.querySelectorAll('.tract[hidden]').forEach(function (li) { li.hidden = false; });
        wrap.hidden = true;
      });
    }
  }

  if (tractsSection && window.fetch) {
    fetch('tracts/tracts.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) renderTracts(data.tracts); })
      .catch(function () { /* liste indisponible : le message d'attente reste affiché */ });
  }

  /* ---------- « L'essentiel en 1'30 » : le bouton descend jusqu'à la vidéo et la lance ---------- */
  var videoBtn = document.getElementById('video-btn');
  var player = document.getElementById('video-player');
  if (videoBtn && player && player.play) {
    videoBtn.addEventListener('click', function () {
      // Lancée pendant le clic, la lecture avec le son est autorisée par les navigateurs.
      if (player.paused) {
        var p = player.play();
        if (p && p.catch) p.catch(function () { /* lecture refusée : la vidéo reste prête, avec ses commandes */ });
      }
    });
  }

  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  /* ---------- Mesure d'audience (GoatCounter : anonyme, sans cookie) ----------
     Chaque événement est compté une fois par visiteur. Les noms ci-dessous sont repris
     tels quels par le tableau de bord de l'espace équipe (assets/js/stats.js). */
  var gcQueue = [];
  function track(path, title) {
    var gc = window.goatcounter;
    if (gc && typeof gc.count === 'function') {
      try { gc.count({ path: path, title: title, event: true }); } catch (e) { /* mesure indisponible */ }
    } else if (gcQueue.length < 60) {
      gcQueue.push([path, title]);  // count.js se charge en différé : on attend qu'il soit prêt
    }
  }
  var gcTries = 0;
  var gcWait = setInterval(function () {
    var gc = window.goatcounter;
    if (gc && typeof gc.count === 'function') {
      clearInterval(gcWait);
      gcQueue.splice(0).forEach(function (e) { track(e[0], e[1]); });
    } else if (++gcTries > 60) {
      clearInterval(gcWait);  // bloqué (bloqueur de publicité…) : on abandonne
      gcQueue = [];
    }
  }, 500);
  function slug(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  // Clics sur les documents, les tracts et les boutons principaux
  var DOCS = {
    'cftc-profession-de-foi': 'Profession de foi',
    'cftc-liste-candidats': 'Liste des candidats',
    'cftc-nos-engagements': 'Nos engagements',
    'cftc-notre-ambition': 'Notre ambition',
    'cftc-notre-bilan': 'Notre bilan',
    'profession-de-foi-cftc-irp-auto-2026': 'Document complet (4 pages)'
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    var tract = a.closest('.tract');
    if (tract) {
      var file = href.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      var h = tract.querySelector('h3');
      track('tract-' + slug(file), 'Tract : ' + (h ? h.textContent : file));
      return;
    }
    var pdf = /([^\/?#]+)\.pdf(?:[?#].*)?$/i.exec(href);
    if (pdf) { track('pdf-' + slug(pdf[1]), 'PDF : ' + (DOCS[pdf[1]] || pdf[1])); return; }
    if (a.id === 'video-btn') track('bouton-video', 'Bouton « L\'essentiel en 1\'30 »');
    else if (href === '#vote' && a.classList.contains('btn')) track('bouton-entrez-dans-l-histoire', 'Bouton « Entrez dans l\'histoire »');
    else if (href === '#questions' && a.classList.contains('btn')) track('bouton-vos-questions', 'Bouton « Vos questions »');
  });

  // Vidéo : lancée, regardée à moitié, regardée jusqu'au bout
  if (player) {
    var vSeen = {};
    var vOnce = function (k, path, title) { if (!vSeen[k]) { vSeen[k] = true; track(path, title); } };
    player.addEventListener('play', function () { vOnce('play', 'video-lancee', 'Vidéo : lancée'); });
    player.addEventListener('timeupdate', function () {
      if (player.duration && player.currentTime >= player.duration / 2) vOnce('half', 'video-moitie', 'Vidéo : regardée à moitié');
    });
    player.addEventListener('ended', function () { vOnce('end', 'video-terminee', 'Vidéo : regardée jusqu\'au bout'); });
  }

  // Parties du site lues : la section reste au milieu de l'écran pendant au moins 2 secondes
  var SECTIONS = {
    ambition: 'Notre ambition', bilan: 'Notre bilan', engagements: 'Nos engagements', video: 'Vidéo',
    equipe: 'Notre équipe', tracts: 'Nos tracts & vidéos', 'comment-voter': 'Comment voter ?',
    questions: 'Vos questions', vote: 'Jouons collectif (bas de page)'
  };
  if ('IntersectionObserver' in window) {
    var secTimers = {};
    var secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.id;
        clearTimeout(secTimers[id]);
        if (en.isIntersecting) {
          secTimers[id] = setTimeout(function () {
            secObs.unobserve(en.target);
            track('section-' + id, 'Section lue : ' + SECTIONS[id]);
          }, 2000);
        }
      });
    }, { rootMargin: '-40% 0px -40% 0px' });
    Object.keys(SECTIONS).forEach(function (id) { var el = document.getElementById(id); if (el) secObs.observe(el); });
  }

  // Temps passé sur le site (page visible à l'écran) : paliers de 10 s à 10 min
  var MILESTONES = [[10, '10s', '10 secondes'], [30, '30s', '30 secondes'], [60, '1min', '1 minute'],
                    [120, '2min', '2 minutes'], [300, '5min', '5 minutes'], [600, '10min', '10 minutes']];
  var activeSec = 0, nextMilestone = 0;
  var timeTimer = setInterval(function () {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    activeSec++;
    while (nextMilestone < MILESTONES.length && activeSec >= MILESTONES[nextMilestone][0]) {
      var m = MILESTONES[nextMilestone++];
      track('temps-' + m[1], 'Temps passé : ' + m[2] + ' ou plus');
    }
    if (nextMilestone >= MILESTONES.length) clearInterval(timeTimer);
  }, 1000);

  /* ---------- Vos questions : envoi du formulaire à syndicat.cftc@irpauto.fr (via FormSubmit) ---------- */
  var qForm = document.getElementById('questions-form');
  if (qForm && window.fetch) {
    var Q_TO = 'syndicat.cftc@irpauto.fr';
    // En local, jamais d'envoi réel : l'adresse de test n'existe pas (les essais simulent la réponse).
    var Q_URL = LOCAL ? '/__test-formulaire' : 'https://formsubmit.co/ajax/' + Q_TO;
    var qMsg = document.getElementById('q-message');
    var qCount = document.getElementById('q-count');
    var qStatus = document.getElementById('q-status');
    var qSend = document.getElementById('q-send');
    var qDone = document.getElementById('q-done');
    var Q_FIELDS = ['q-nom', 'q-prenom', 'q-email', 'q-objet', 'q-message'];

    var qCountUpdate = function () {
      var n = qMsg.value.length;
      qCount.textContent = n + ' / 5000 caractères';
      qCount.classList.toggle('is-near', n > 4500);
    };
    qMsg.addEventListener('input', qCountUpdate);

    var fieldError = function (input, text) {
      var field = input.closest('.q-field');
      var err = field.querySelector('.q-err');
      field.classList.toggle('is-invalid', !!text);
      input.setAttribute('aria-invalid', text ? 'true' : 'false');
      if (text) {
        if (!err) { err = node('span', 'q-err'); err.id = input.id + '-err'; field.appendChild(err); }
        err.textContent = text;
        input.setAttribute('aria-describedby', (input === qMsg ? 'q-count ' : '') + err.id);
      } else if (err) {
        err.remove();
        if (input === qMsg) input.setAttribute('aria-describedby', 'q-count'); else input.removeAttribute('aria-describedby');
      }
    };
    var checkField = function (input) {
      var val = input.value.trim();
      if (!val) return 'Ce champ est obligatoire.';
      if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) return 'Vérifiez l\'adresse e-mail (exemple : prenom.nom@exemple.fr).';
      return '';
    };
    Q_FIELDS.forEach(function (id) {
      var input = document.getElementById(id);
      input.addEventListener('input', function () { if (input.getAttribute('aria-invalid') === 'true') fieldError(input, checkField(input)); });
    });

    var qSetStatus = function (kind, content) {
      qStatus.className = 'q-status' + (kind ? ' is-' + kind : '');
      qStatus.textContent = '';
      if (content) qStatus.appendChild(typeof content === 'string' ? document.createTextNode(content) : content);
      qStatus.hidden = !content;
    };
    var mailtoHref = function (d) {
      var body = 'Nom : ' + d.nom + '\nPrénom : ' + d.prenom + '\nE-mail : ' + d.email + '\n\n' + d.message;
      if (body.length > 1500) body = body.slice(0, 1500) + '…';
      return 'mailto:' + Q_TO + '?subject=' + encodeURIComponent('Vos questions : ' + d.objet) + '&body=' + encodeURIComponent(body);
    };

    qForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstBad = null;
      Q_FIELDS.forEach(function (id) {
        var input = document.getElementById(id);
        var msg = checkField(input);
        fieldError(input, msg);
        if (msg && !firstBad) firstBad = input;
      });
      if (firstBad) { qSetStatus('error', 'Merci de compléter les champs indiqués.'); firstBad.focus(); return; }

      var d = {
        nom: document.getElementById('q-nom').value.trim(),
        prenom: document.getElementById('q-prenom').value.trim(),
        email: document.getElementById('q-email').value.trim(),
        objet: document.getElementById('q-objet').value.trim(),
        message: qMsg.value.trim()
      };
      var showDone = function () {
        qForm.reset(); qCountUpdate(); qSetStatus('', '');
        qForm.hidden = true; qDone.hidden = false; qDone.focus();
      };
      if (document.getElementById('q-site').value) { showDone(); return; }  // robot : on fait semblant

      qSend.disabled = true;
      qSetStatus('info', 'Envoi en cours…');
      fetch(Q_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          'Nom': d.nom, 'Prénom': d.prenom, 'email': d.email, 'Objet': d.objet, 'Message': d.message,
          _subject: 'Site CFTC – Vos questions : ' + d.objet, _template: 'table', _captcha: 'false'
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || String(j.success) !== 'true') throw new Error(j.message || 'HTTP ' + r.status);
        });
      }).then(function () {
        showDone();
        track('question-envoyee', 'Formulaire « Vos questions » envoyé');
      }).catch(function () {
        var span = node('span', '', 'Le message n\'a pas pu être envoyé. Réessayez dans un instant, ou ');
        var link = node('a', '', 'envoyez-le avec votre messagerie');
        link.href = mailtoHref(d);
        span.appendChild(link);
        span.appendChild(document.createTextNode(' à ' + Q_TO + '.'));
        qSetStatus('error', span);
      }).then(function () { qSend.disabled = false; });
    });
    document.getElementById('q-again').addEventListener('click', function () {
      qDone.hidden = true; qForm.hidden = false;
      document.getElementById('q-objet').focus();
    });
  }

  /* ---------- Compte à rebours du scrutin (heure de Paris) ---------- */
  var VOTE_START = Date.UTC(2026, 10, 22, 23, 0, 0); // lundi 23 novembre 2026, 0h00 à Paris
  var VOTE_END = Date.UTC(2026, 10, 25, 15, 0, 0);   // mercredi 25 novembre 2026, 16h00 à Paris
  // Test en local uniquement : index.html?maintenant=2026-11-24T10:00 simule une autre date.
  var clockShift = 0;
  if (LOCAL) {
    var sim = /[?&]maintenant=([^&]+)/.exec(location.search);
    var simT = sim ? Date.parse(decodeURIComponent(sim[1])) : NaN;
    if (!isNaN(simT)) clockShift = simT - Date.now();
  }
  function now() { return Date.now() + clockShift; }

  var band = document.getElementById('decompte');
  var cd = document.getElementById('countdown');
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function setUnit(id, value, one, many, pad) {
    document.getElementById(id).textContent = pad ? two(value) : String(value);
    document.getElementById(id + '-l').textContent = value > 1 ? many : one;
  }
  function setHtml(el, html) { if (el.innerHTML !== html) el.innerHTML = html; }
  function tick() {
    var t = now();
    var open = t >= VOTE_START && t < VOTE_END;
    if (band) {
      if (open) {
        var left = Math.ceil((VOTE_END - t) / 60000);  // minutes restantes, arrondies au-dessus
        setUnit('cd-j', Math.floor(left / 1440), 'jour', 'jours');
        setUnit('cd-h', Math.floor(left % 1440 / 60), 'heure', 'heures', true);
        setUnit('cd-m', left % 60, 'minute', 'minutes', true);
      }
      if (band.hidden === open) {
        band.hidden = !open;
        document.documentElement.classList.toggle('cd-on', open);
      }
    }
    if (cd) {
      if (t < VOTE_START) {
        var d0 = new Date(t);
        var days = Math.round((VOTE_START - new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()) / 864e5);
        setHtml(cd, days <= 1 ? 'Ouverture du vote <b>demain</b>&nbsp;!' : 'Ouverture du vote dans <b>' + days + '&nbsp;jours</b>');
      } else if (open) {
        setHtml(cd, '<b>Le vote est ouvert</b> jusqu\'au mercredi 25 novembre à 16h00&nbsp;!');
      }
      cd.hidden = t >= VOTE_END;
    }
    return t < VOTE_END;
  }
  if (band || cd) {
    var cdTimer = setInterval(function () { if (!tick()) clearInterval(cdTimer); }, 1000);
    tick();
  }
})();
