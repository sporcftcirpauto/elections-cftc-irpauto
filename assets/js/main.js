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

  function tractCard(t) {
    var file = safePath(t.fichier);
    var preview = safePath(t.apercu) || (t.type === 'image' ? file : null);
    var day = parseDay(t.date);
    var li = node('li', 'tract');

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
    if (day && (Date.now() - day.getTime()) < 8 * 24 * 3600 * 1000) cover.appendChild(node('span', 'tract-new', 'Nouveau'));
    li.appendChild(cover);

    var body = node('div', 'tract-body');
    if (day) {
      var d = node('p', 'tract-date');
      d.appendChild(icon('i-calendar'));
      d.appendChild(document.createTextNode(day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })));
      body.appendChild(d);
    }
    body.appendChild(node('h3', '', t.titre));
    if (t.resume) body.appendChild(node('p', 'tract-resume', t.resume));
    var actions = node('p', 'tract-actions');
    var a = node('a', 'btn btn-pink btn-sm', t.type === 'image' ? 'Voir le tract ' : 'Lire le tract ');
    a.href = file; a.target = '_blank'; a.rel = 'noopener';
    a.appendChild(icon('i-ext'));
    actions.appendChild(a);
    body.appendChild(actions);
    li.appendChild(body);
    return li;
  }
  function fallback() {
    var f = node('span', 'tract-fallback');
    f.appendChild(icon('i-file'));
    f.appendChild(document.createTextNode('TRACT CFTC'));
    return f;
  }

  function renderTracts(list) {
    list = (list || []).filter(function (t) { return t && t.titre && safePath(t.fichier); });
    list.sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || String(b.publie_le || '').localeCompare(String(a.publie_le || ''));
    });
    // Aucun tract publié : le message « Nos tracts arrivent très bientôt » reste affiché.
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

  /* ---------- Compte à rebours du scrutin ---------- */
  var cd = document.getElementById('countdown');
  if (cd) {
    var start = new Date(2026, 10, 23, 0, 0, 0);  // 23 novembre 2026
    var end = new Date(2026, 10, 26, 0, 0, 0);    // fin du 25 novembre 2026
    var now = new Date();
    var day = 24 * 60 * 60 * 1000;
    if (now < start) {
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var d = Math.round((start - today) / day);
      cd.innerHTML = d <= 1
        ? 'Ouverture du vote <b>demain</b>&nbsp;!'
        : 'Ouverture du vote dans <b>' + d + '&nbsp;jours</b>';
      cd.hidden = false;
    } else if (now < end) {
      cd.innerHTML = '<b>Le vote est ouvert</b> jusqu\'au 25 novembre&nbsp;!';
      cd.hidden = false;
    }
  }
})();
