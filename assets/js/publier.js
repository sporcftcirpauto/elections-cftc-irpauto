/* Espace équipe – publication des tracts sur le dépôt GitHub du site.
   Chaque publication ajoute le fichier (et son aperçu) dans tracts/ et met à jour
   tracts/tracts.json en un seul commit ; GitHub Pages republie le site ensuite. */
(function () {
  'use strict';

  var OWNER = 'quent-arch';
  var REPO = 'elections-cftc-irpauto';
  var BRANCH = 'main';
  var DATA_PATH = 'tracts/tracts.json';
  var MAX_SIZE = 20 * 1024 * 1024;
  var TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
  var STORE_KEY = 'cftc-tracts-cle';

  // Serveur de test : uniquement quand la page est ouverte en local.
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var API = (LOCAL && new URLSearchParams(location.search).get('api')) || 'https://api.github.com';
  var REPO_PATH = '/repos/' + OWNER + '/' + REPO;

  var token = null;
  var thumbBlob = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }

  /* ---------- Stockage de la clé (sur cet appareil uniquement) ---------- */
  function readToken() {
    try { return localStorage.getItem(STORE_KEY) || sessionStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function saveToken(t, remember) {
    try {
      localStorage.removeItem(STORE_KEY); sessionStorage.removeItem(STORE_KEY);
      (remember ? localStorage : sessionStorage).setItem(STORE_KEY, t);
    } catch (e) { /* stockage indisponible : la clé reste en mémoire pour cette visite */ }
  }
  function clearToken() {
    try { localStorage.removeItem(STORE_KEY); sessionStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  /* ---------- Messages ---------- */
  var ICONS = { info: 'i-info', success: 'i-check', error: 'i-alert' };
  function notify(kind, text, link) {
    var box = $('notice');
    box.className = 'notice notice-' + kind;
    box.textContent = '';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i'); svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + ICONS[kind]);
    svg.appendChild(use);
    var p = document.createElement('p');
    p.textContent = text;
    if (link) {
      p.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = link.href; a.textContent = link.text;
      if (link.blank) { a.target = '_blank'; a.rel = 'noopener'; }
      p.appendChild(a);
    }
    box.appendChild(svg); box.appendChild(p);
    box.hidden = false;
    if (kind !== 'info') box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearNotice() { $('notice').hidden = true; }

  /* ---------- Appels à l'API GitHub ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': opts.accept || 'application/vnd.github+json', 'Authorization': 'Bearer ' + token };
    var init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          var err = new Error('HTTP ' + res.status);
          err.status = res.status;
          try { err.detail = JSON.parse(txt).message; } catch (e) { err.detail = txt; }
          throw err;
        });
      }
      if (opts.raw) return res.text();
      return res.status === 204 ? null : res.json();
    });
  }

  function explain(err) {
    if (!err || !err.status) return 'Impossible de joindre GitHub. Vérifiez votre connexion internet puis réessayez.';
    if (err.status === 401) return 'GitHub refuse la clé d\'accès (incomplète, supprimée ou expirée). Reconnectez-vous avec une nouvelle clé.';
    if (err.status === 403) return 'La clé n\'a pas le droit de modifier le site. Sur GitHub, vérifiez que la permission « Contents » est réglée sur « Read and write ».';
    if (err.status === 404) return 'La clé n\'a pas accès au site (dépôt ' + OWNER + '/' + REPO + '). Vérifiez que ce dépôt est bien sélectionné dans la clé.';
    if (err.status === 409 || err.status === 422) return 'Le site a été modifié en même temps par quelqu\'un d\'autre. Réessayez dans quelques secondes.';
    return 'GitHub a répondu une erreur (' + err.status + (err.detail ? ' : ' + err.detail : '') + '). Réessayez dans un instant.';
  }

  function readData(ref) {
    return api(REPO_PATH + '/contents/' + DATA_PATH + '?ref=' + encodeURIComponent(ref), { accept: 'application/vnd.github.raw+json', raw: true })
      .then(function (txt) {
        var d = JSON.parse(txt);
        if (!d || !Array.isArray(d.tracts)) d = { tracts: [] };
        return d;
      })
      .catch(function (err) {
        if (err.status === 404) return { tracts: [] };
        throw err;
      });
  }

  // Lit la dernière version du site, prépare les changements et crée un commit.
  // En cas de modification simultanée, recommence une fois sur la nouvelle version.
  function commit(prepare, attempt) {
    attempt = attempt || 0;
    var head, baseTree, plan;
    return api(REPO_PATH + '/git/ref/heads/' + BRANCH)
      .then(function (ref) { head = ref.object.sha; return api(REPO_PATH + '/git/commits/' + head); })
      .then(function (c) { baseTree = c.tree.sha; return readData(head); })
      .then(function (data) { plan = prepare(data); return api(REPO_PATH + '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: plan.entries } }); })
      .then(function (tree) { return api(REPO_PATH + '/git/commits', { method: 'POST', body: { message: plan.message, tree: tree.sha, parents: [head] } }); })
      .then(function (c) { return api(REPO_PATH + '/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: c.sha, force: false } }); })
      .then(function () { return plan; })
      .catch(function (err) {
        if ((err.status === 409 || err.status === 422) && attempt === 0) return commit(prepare, 1);
        throw err;
      });
  }

  /* ---------- Outils ---------- */
  var ACCENTS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  function slugify(s) {
    return s.normalize('NFD').replace(ACCENTS, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'tract';
  }
  function safePath(p) { return typeof p === 'string' && /^tracts\/[A-Za-z0-9._-]+$/.test(p) ? p : null; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function frDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko'; }
  function sortTracts(list) {
    list.sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || String(b.publie_le || '').localeCompare(String(a.publie_le || ''));
    });
  }
  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ---------- Aperçu (première page du PDF ou image réduite) ---------- */
  function canvasToJpeg(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.82); });
  }
  function pdfThumb(file) {
    var ready = window.pdfjsLib ? Promise.resolve() : loadScript(PDFJS + 'pdf.min.js', PDFJS_SRI);
    return ready.then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) { return pdf.getPage(1); })
      .then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: 760 / base.width });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return canvasToJpeg(canvas); });
      });
  }
  function imageThumb(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = Math.min(760, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvasToJpeg(canvas).then(resolve);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      img.src = url;
    });
  }

  /* ---------- Choix du fichier ---------- */
  var fileInput = $('fichier');
  var dropzone = $('dropzone');

  function resetFile() {
    fileInput.value = '';
    thumbBlob = null;
    $('dz-empty').hidden = false;
    $('dz-file').hidden = true;
    var img = $('thumb');
    if (img.src) URL.revokeObjectURL(img.src);
    img.removeAttribute('src'); img.hidden = true;
    $('thumb-ico').style.display = '';
  }

  function onFile() {
    var file = fileInput.files && fileInput.files[0];
    thumbBlob = null;
    dropzone.parentNode.classList.remove('has-error');
    if (!file) { resetFile(); return; }
    if (!TYPES[file.type]) { resetFile(); notify('error', 'Ce type de fichier n\'est pas accepté. Choisissez un PDF, un JPG ou un PNG.'); return; }
    if (file.size > MAX_SIZE) { resetFile(); notify('error', 'Le fichier est trop lourd (' + size(file.size) + '). La taille maximale est de 20 Mo.'); return; }
    clearNotice();
    $('dz-empty').hidden = true;
    $('dz-file').hidden = false;
    $('file-name').textContent = file.name;
    $('file-info').textContent = (TYPES[file.type] === 'pdf' ? 'PDF' : 'Image') + ' · ' + size(file.size) + ' · préparation de l\'aperçu…';
    var img = $('thumb');
    img.hidden = true; $('thumb-ico').style.display = '';
    var make = TYPES[file.type] === 'pdf' ? pdfThumb(file) : imageThumb(file);
    make.then(function (blob) {
      if (fileInput.files[0] !== file || !blob) return;
      thumbBlob = blob;
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      img.hidden = false; $('thumb-ico').style.display = 'none';
      $('file-info').textContent = (TYPES[file.type] === 'pdf' ? 'PDF' : 'Image') + ' · ' + size(file.size);
    }).catch(function () {
      if (fileInput.files[0] !== file) return;
      $('file-info').textContent = (TYPES[file.type] === 'pdf' ? 'PDF' : 'Image') + ' · ' + size(file.size) + ' · aperçu indisponible (le tract sera publié quand même)';
    });
  }

  fileInput.addEventListener('change', onFile);
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function () { dropzone.classList.remove('is-over'); });
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      onFile();
    }
  });

  $('resume').addEventListener('input', function () { $('resume-count').textContent = this.value.length; });

  /* ---------- Publication ---------- */
  function fieldError(id, on) { $(id).closest('.field').classList.toggle('has-error', on); }

  $('tract-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var titre = $('titre').value.trim().replace(/\s+/g, ' ');
    var date = $('date').value;
    var resume = $('resume').value.trim();
    var file = fileInput.files && fileInput.files[0];

    fieldError('titre', !titre);
    fieldError('date', !/^\d{4}-\d{2}-\d{2}$/.test(date));
    fieldError('fichier', !file);
    if (!titre || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !file) {
      notify('error', 'Merci de renseigner le titre, la date et le fichier du tract.');
      return;
    }

    var ext = TYPES[file.type];
    var btn = $('publish-btn');
    busy = true; btn.disabled = true;
    var fileSha, thumbSha = null, entry;

    notify('info', 'Envoi du fichier (' + size(file.size) + ')… Merci de ne pas fermer la page.');
    toBase64(file)
      .then(function (b64) { return api(REPO_PATH + '/git/blobs', { method: 'POST', body: { content: b64, encoding: 'base64' } }); })
      .then(function (blob) {
        fileSha = blob.sha;
        if (!thumbBlob) return null;
        notify('info', 'Envoi de l\'aperçu…');
        return toBase64(thumbBlob).then(function (b64) {
          return api(REPO_PATH + '/git/blobs', { method: 'POST', body: { content: b64, encoding: 'base64' } });
        }).then(function (b) { thumbSha = b.sha; });
      })
      .then(function () {
        notify('info', 'Mise à jour de la liste des tracts…');
        return commit(function (data) {
          var ids = data.tracts.map(function (t) { return t.id; });
          var id = date + '-' + slugify(titre), n = 2;
          while (ids.indexOf(id) !== -1) id = date + '-' + slugify(titre) + '-' + (n++);
          entry = {
            id: id,
            titre: titre,
            date: date,
            resume: resume,
            fichier: 'tracts/' + id + '.' + ext,
            apercu: thumbSha ? 'tracts/' + id + '-apercu.jpg' : null,
            type: ext === 'pdf' ? 'pdf' : 'image',
            publie_le: new Date().toISOString()
          };
          data.tracts.push(entry);
          sortTracts(data.tracts);
          var entries = [{ path: entry.fichier, mode: '100644', type: 'blob', sha: fileSha }];
          if (thumbSha) entries.push({ path: entry.apercu, mode: '100644', type: 'blob', sha: thumbSha });
          entries.push({ path: DATA_PATH, mode: '100644', type: 'blob', content: JSON.stringify(data, null, 2) + '\n' });
          return { entries: entries, message: 'Tract : ' + titre };
        });
      })
      .then(function () {
        notify('success', 'Tract publié ! Il apparaîtra sur le site d\'ici 1 à 2 minutes.', { href: './#tracts', text: 'Voir la rubrique « Nos tracts »', blank: true });
        $('tract-form').reset();
        $('date').value = today();
        $('resume-count').textContent = '0';
        resetFile();
        loadList();
        watchOnline(entry.id, true);
      })
      .catch(function (err) {
        if (err && err.status === 401) { logout(); }
        notify('error', 'Le tract n\'a pas été publié. ' + explain(err));
      })
      .then(function () { busy = false; btn.disabled = false; });
  });

  // Surveille la version en ligne du site jusqu'à ce que le changement y soit visible.
  var watchTimer = null;
  function watchOnline(id, shouldExist) {
    clearInterval(watchTimer);
    var tries = 0;
    watchTimer = setInterval(function () {
      tries++;
      fetch('tracts/tracts.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var present = !!(d && Array.isArray(d.tracts) && d.tracts.some(function (t) { return t.id === id; }));
          if (present === shouldExist) {
            clearInterval(watchTimer);
            if (shouldExist) notify('success', 'C\'est en ligne : le tract est visible sur le site.', { href: './#tracts', text: 'Voir le tract sur le site', blank: true });
            else notify('success', 'C\'est fait : le tract n\'apparaît plus sur le site.');
          }
        })
        .catch(function () {});
      if (tries >= 30) {
        clearInterval(watchTimer);
        notify('info', 'L\'enregistrement est fait. Le site met parfois quelques minutes de plus à se mettre à jour : rechargez la page du site un peu plus tard.');
      }
    }, 10000);
  }

  /* ---------- Liste et suppression ---------- */
  function loadList() {
    var ul = $('admin-list');
    ul.textContent = '';
    var wait = document.createElement('li');
    wait.className = 'empty'; wait.textContent = 'Chargement de la liste…';
    ul.appendChild(wait);
    return api(REPO_PATH + '/git/ref/heads/' + BRANCH)
      .then(function (ref) { return readData(ref.object.sha); })
      .then(function (data) { renderList(data.tracts); })
      .catch(function (err) {
        wait.textContent = 'Impossible de charger la liste. ' + explain(err);
      });
  }

  function renderList(list) {
    var ul = $('admin-list');
    ul.textContent = '';
    sortTracts(list);
    if (!list.length) {
      var li0 = document.createElement('li');
      li0.className = 'empty';
      li0.textContent = 'Aucun tract publié pour le moment. La rubrique « Nos tracts » apparaîtra sur le site dès le premier tract.';
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'admin-item';

      var th = document.createElement('span');
      th.className = 'admin-item-thumb';
      var prev = safePath(t.apercu) || (t.type === 'image' ? safePath(t.fichier) : null);
      var ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ico.setAttribute('class', 'i');
      var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      u.setAttribute('href', '#i-file'); ico.appendChild(u);
      if (prev) {
        var img = document.createElement('img');
        img.src = prev + '?t=' + Date.now(); img.alt = '';
        img.onerror = function () { img.replaceWith(ico); };
        th.appendChild(img);
      } else th.appendChild(ico);

      var txt = document.createElement('span');
      txt.className = 'admin-item-txt';
      var strong = document.createElement('strong'); strong.textContent = t.titre;
      var meta = document.createElement('span'); meta.textContent = frDate(t.date) + (t.type === 'image' ? ' · image' : ' · PDF');
      txt.appendChild(strong); txt.appendChild(meta);

      var actions = document.createElement('span');
      actions.className = 'admin-item-actions';
      if (safePath(t.fichier)) {
        var view = document.createElement('a');
        view.className = 'link-btn'; view.href = t.fichier; view.target = '_blank'; view.rel = 'noopener';
        view.textContent = 'Voir';
        actions.appendChild(view);
      }
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'link-btn btn-danger';
      del.textContent = 'Supprimer';
      del.addEventListener('click', function () { removeTract(t, del); });
      actions.appendChild(del);

      li.appendChild(th); li.appendChild(txt); li.appendChild(actions);
      ul.appendChild(li);
    });
  }

  function removeTract(t, btn) {
    if (busy) return;
    if (!window.confirm('Retirer le tract « ' + t.titre + ' » du site ?\n\nIl ne sera plus visible par les salariés.')) return;
    busy = true; btn.disabled = true;
    notify('info', 'Suppression du tract « ' + t.titre + ' »…');
    commit(function (data) {
      var found = data.tracts.filter(function (x) { return x.id === t.id; })[0];
      if (!found) { var e = new Error('introuvable'); e.status = 0; e.gone = true; throw e; }
      data.tracts = data.tracts.filter(function (x) { return x.id !== t.id; });
      var entries = [];
      [found.fichier, found.apercu].forEach(function (p) {
        if (safePath(p) && !entries.some(function (x) { return x.path === p; })) entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
      });
      entries.push({ path: DATA_PATH, mode: '100644', type: 'blob', content: JSON.stringify(data, null, 2) + '\n' });
      return { entries: entries, message: 'Suppression du tract : ' + found.titre };
    })
      .then(function () {
        notify('success', 'Tract supprimé. Il disparaîtra du site d\'ici 1 à 2 minutes.');
        loadList();
        watchOnline(t.id, false);
      })
      .catch(function (err) {
        if (err && err.gone) { notify('info', 'Ce tract avait déjà été supprimé.'); loadList(); return; }
        if (err && err.status === 401) { logout(); }
        notify('error', 'Le tract n\'a pas été supprimé. ' + explain(err));
        btn.disabled = false;
      })
      .then(function () { busy = false; });
  }

  $('refresh').addEventListener('click', loadList);

  /* ---------- Connexion ---------- */
  function showLogin() {
    $('app').hidden = true;
    $('login-panel').hidden = false;
  }
  function showApp(login) {
    $('who').textContent = login;
    $('login-panel').hidden = true;
    $('app').hidden = false;
    if (!$('date').value) $('date').value = today();
    loadList();
  }
  function logout() {
    token = null;
    clearToken();
    showLogin();
  }
  function check() {
    return api(REPO_PATH).then(function (repo) {
      if (repo && repo.permissions && repo.permissions.push === false) { var e = new Error('lecture seule'); e.status = 403; throw e; }
      return api('/user').then(function (u) { return u.login; }).catch(function () { return 'membre de l\'équipe'; });
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var value = $('token').value.trim();
    if (!value) { notify('error', 'Collez votre clé d\'accès GitHub.'); return; }
    var btn = $('login-btn');
    btn.disabled = true;
    token = value;
    notify('info', 'Vérification de la clé…');
    check().then(function (login) {
      saveToken(value, $('remember').checked);
      $('token').value = '';
      clearNotice();
      showApp(login);
    }).catch(function (err) {
      token = null;
      notify('error', 'Connexion impossible. ' + explain(err));
    }).then(function () { btn.disabled = false; });
  });

  $('logout').addEventListener('click', function () { logout(); clearNotice(); });

  // Au chargement : reprendre la session si une clé est enregistrée sur cet appareil.
  token = readToken();
  if (token) {
    notify('info', 'Connexion…');
    check().then(function (login) { clearNotice(); showApp(login); }).catch(function (err) {
      if (err && (err.status === 401 || err.status === 403 || err.status === 404)) {
        logout();
        notify('error', 'Votre session a expiré. ' + explain(err));
      } else {
        showLogin();
        notify('error', explain(err));
      }
    });
  } else {
    showLogin();
  }
})();
