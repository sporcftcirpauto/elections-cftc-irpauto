/* Espace équipe – publication des tracts sur le dépôt GitHub du site.
   Accès : bouton cadenas en haut à droite du site, puis mot de passe de l'équipe, qui
   déchiffre la clé GitHub enregistrée dans tracts/acces.json. Configuration : publier.html#config.
   Chaque publication ajoute le fichier (et son aperçu) dans tracts/ et met à jour
   tracts/tracts.json en un seul commit ; GitHub Pages republie le site ensuite. */
(function () {
  'use strict';

  var OWNER = 'quent-arch';
  var REPO = 'elections-cftc-irpauto';
  var BRANCH = 'main';
  var DATA_PATH = 'tracts/tracts.json';
  var ACCESS_PATH = 'tracts/acces.json';
  var ITERATIONS = 600000;
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
  // La session est liée à la version du mot de passe : après un changement de mot de passe,
  // les appareils restés connectés doivent se reconnecter.
  function readToken(version) {
    try {
      var store = localStorage.getItem(STORE_KEY) ? localStorage : sessionStorage;
      var t = store.getItem(STORE_KEY);
      if (t && version && store.getItem(STORE_KEY + '-v') !== version) { clearToken(); return null; }
      return t;
    } catch (e) { return null; }
  }
  function saveToken(t, remember, version) {
    try {
      clearToken();
      var store = remember ? localStorage : sessionStorage;
      store.setItem(STORE_KEY, t);
      if (version) store.setItem(STORE_KEY + '-v', version);
    } catch (e) { /* stockage indisponible : la clé reste en mémoire pour cette visite */ }
  }
  function clearToken() {
    try {
      [localStorage, sessionStorage].forEach(function (s) { s.removeItem(STORE_KEY); s.removeItem(STORE_KEY + '-v'); });
    } catch (e) {}
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
    if (err.status === 401) return 'GitHub refuse la clé d\'accès du site (incomplète, supprimée ou expirée). L\'administrateur doit créer une nouvelle clé GitHub et refaire la configuration de l\'accès.';
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

  /* ---------- Chiffrement de la clé GitHub par le mot de passe de l'équipe ----------
     La clé GitHub est enregistrée sur le site chiffrée (AES-GCM) dans tracts/acces.json.
     La clé de chiffrement est dérivée du mot de passe (PBKDF2-SHA256, 600 000 itérations) :
     sans le mot de passe, le fichier est illisible. */
  var enc = new TextEncoder();
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function cleanPassword(p) { return String(p || '').normalize('NFC'); }
  function deriveKey(password, salt, iterations) {
    return crypto.subtle.importKey('raw', enc.encode('cftc-tracts:' + cleanPassword(password)), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function sealToken(tok, password) {
    var salt = rand(16), iv = rand(12);
    return deriveKey(password, salt, ITERATIONS)
      .then(function (key) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify({ token: tok }))); })
      .then(function (ct) {
        return {
          v: 2, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
          sel: b64(salt), iv: b64(iv), donnees: b64(new Uint8Array(ct)), cree_le: new Date().toISOString()
        };
      });
  }
  function openToken(acc, password) {
    return deriveKey(password, unb64(acc.sel), acc.iterations || ITERATIONS)
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(acc.iv) }, key, unb64(acc.donnees)); })
      .then(function (plain) {
        var d = JSON.parse(new TextDecoder().decode(plain));
        if (!d || typeof d.token !== 'string') throw new Error('contenu inattendu');
        return d.token;
      });
  }

  // Configuration d'accès : la dernière version sur GitHub (un changement de mot de passe
  // compte tout de suite) ; si GitHub ne répond pas, celle publiée sur le site.
  function fetchJson(url, headers) {
    return fetch(url, { headers: headers || {}, cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function loadAccess() {
    return fetchJson(API + REPO_PATH + '/contents/' + ACCESS_PATH + '?ref=' + BRANCH, { 'Accept': 'application/vnd.github.raw+json' })
      .catch(function () { return fetchJson(ACCESS_PATH + '?t=' + Date.now()); })
      .then(function (a) { return a && a.v === 2 && a.sel && a.iv && a.donnees ? a : null; });
  }

  /* ---------- Écrans : connexion, configuration, publication ---------- */
  var access = null;
  var PANELS = ['locked-panel', 'login-panel', 'setup-panel', 'app'];
  function show(id) { PANELS.forEach(function (p) { $(p).hidden = p !== id; }); }

  var LOCKED = {
    absent: 'L\'espace équipe n\'est pas encore activé : l\'administrateur du site doit d\'abord choisir le mot de passe.',
    reseau: 'Impossible de charger l\'espace équipe pour le moment. Vérifiez votre connexion internet puis rechargez la page.',
    navigateur: 'Ce navigateur est trop ancien pour l\'espace équipe. Utilisez une version récente de Chrome, Edge, Firefox ou Safari.'
  };
  function showLocked(kind) {
    $('locked-msg').textContent = LOCKED[kind] || LOCKED.absent;
    show('locked-panel');
  }
  function showLogin() {
    show('login-panel');
    $('password').value = '';
    setTimeout(function () { $('password').focus(); }, 0);
  }
  function showApp() {
    show('app');
    if (!$('date').value) $('date').value = today();
    loadList();
  }
  function showSetup() {
    show('setup-panel');
    $('setup-step').hidden = false;
    $('setup-done').hidden = true;
    var known = token || readToken();
    $('setup-token-field').hidden = !!known;
    $('setup-help').hidden = !!known;
    $('setup-pass').value = '';
    $('setup-pass2').value = '';
  }
  function logout() {
    token = null;
    clearToken();
    if (access) showLogin(); else route();
  }
  function check() {
    return api(REPO_PATH).then(function (repo) {
      if (repo && repo.permissions && repo.permissions.push === false) { var e = new Error('lecture seule'); e.status = 403; throw e; }
      return true;
    });
  }

  function route() {
    clearInterval(watchTimer);
    clearNotice();
    access = null;
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) { showLocked('navigateur'); return; }
    if (location.hash === '#config') { showSetup(); return; }
    show(null);
    notify('info', 'Chargement…');
    loadAccess().then(function (a) {
      if (location.hash === '#config') return;
      clearNotice();
      if (!a) { token = null; clearToken(); showLocked('absent'); return; }
      access = a;
      token = token || readToken(a.cree_le);
      if (!token) { showLogin(); return; }
      return check().then(showApp, function (err) {
        token = null; clearToken();
        showLogin();
        if (err && err.status === 401) notify('error', explain(err));
      });
    }).catch(function () {
      if (location.hash === '#config') return;
      clearNotice();
      showLocked('reseau');
    });
  }

  /* Connexion avec le mot de passe de l'équipe */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = $('password').value;
    if (!pass) { notify('error', 'Entrez le mot de passe.'); return; }
    if (!access) { route(); return; }
    var btn = $('login-btn');
    btn.disabled = true;
    notify('info', 'Vérification du mot de passe…');
    openToken(access, pass).then(function (tok) {
      token = tok;
      return check().then(function () {
        saveToken(tok, $('remember').checked, access.cree_le);
        $('password').value = '';
        clearNotice();
        showApp();
      }, function (err) {
        token = null;
        notify('error', 'Le mot de passe est bon, mais GitHub refuse l\'accès. ' + explain(err));
      });
    }, function () {
      notify('error', 'Mot de passe incorrect.');
      $('password').select();
    }).then(function () { btn.disabled = false; });
  });

  /* Configuration : choix du mot de passe de l'équipe */
  $('setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var known = token || readToken();
    var tok = known || $('setup-token').value.trim();
    var p1 = $('setup-pass').value, p2 = $('setup-pass2').value;
    if (!tok) { notify('error', 'Collez la clé d\'accès GitHub.'); return; }
    if (cleanPassword(p1).length < 12) { notify('error', 'Le mot de passe doit contenir au moins 12 caractères.'); return; }
    if (p1 !== p2) { notify('error', 'Les deux mots de passe ne sont pas identiques.'); return; }
    var btn = $('setup-btn');
    btn.disabled = true;
    token = tok;
    var sealed;
    notify('info', 'Vérification de la clé GitHub…');
    check().then(function () {
      notify('info', 'Enregistrement du mot de passe…');
      return sealToken(tok, p1);
    }).then(function (s) {
      sealed = s;
      return commit(function () {
        return {
          entries: [{ path: ACCESS_PATH, mode: '100644', type: 'blob', content: JSON.stringify(s, null, 2) + '\n' }],
          message: 'Espace équipe : nouveau mot de passe'
        };
      });
    }).then(function () {
      access = sealed;
      saveToken(tok, false, sealed.cree_le);
      $('setup-token').value = '';
      $('setup-pass').value = '';
      $('setup-pass2').value = '';
      $('setup-step').hidden = true;
      $('setup-done').hidden = false;
      notify('success', 'Le mot de passe de l\'équipe est enregistré.');
    }).catch(function (err) {
      token = null;
      if (known && err && err.status === 401) { clearToken(); showSetup(); }
      notify('error', 'Le mot de passe n\'a pas été enregistré. ' + explain(err));
    }).then(function () { btn.disabled = false; });
  });

  $('go-app').addEventListener('click', function () {
    history.replaceState(null, '', location.pathname + location.search);
    route();
  });
  $('change-access').addEventListener('click', function () { location.hash = 'config'; });
  $('logout').addEventListener('click', function () { logout(); clearNotice(); });

  window.addEventListener('hashchange', route);
  route();
})();
