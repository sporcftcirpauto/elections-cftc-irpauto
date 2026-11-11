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
