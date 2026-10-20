/* Guest photo and video uploads for the Union Square yearbook. Photos are shrunk on the phone before sending; videos go up in small parts. */
(function () {
  var MAXSEC = 23;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function vidType(f) {
    var t = (f.type || '').toLowerCase(), n = (f.name || '').toLowerCase();
    if (t === 'video/mp4' || t === 'video/quicktime' || t === 'video/webm') return t;
    if (/\.(mov|qt)$/.test(n)) return 'video/quicktime';
    if (/\.(mp4|m4v)$/.test(n) || t === 'video/x-m4v') return 'video/mp4';
    if (/\.webm$/.test(n)) return 'video/webm';
    return t.indexOf('video/') === 0 ? 'video/mp4' : '';
  }
  function isVideo(f) { return (f.type || '').indexOf('video/') === 0 || /\.(mov|qt|mp4|m4v|webm)$/i.test(f.name || ''); }
  function shrink(f) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () {
        var M = 2000, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, M / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (!b) return no(new Error('This photo could not be read. Please try a different one.'));
          thumbOf(im, w, h).then(function (t) { ok({ blob: b, thumb: t }); });
        }, 'image/jpeg', 0.85);
      };
      im.onerror = function () { URL.revokeObjectURL(url); no(new Error('This photo could not be read. Please choose a JPG or PNG.')); };
      im.src = url;
    });
  }
  function thumbOf(el, w, h) {
    return new Promise(function (ok) {
      try {
        var k = Math.min(1, 640 / Math.max(w, h)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        c.toBlob(function (b) { ok(b && b.size < 600000 ? b : null); }, 'image/jpeg', 0.75);
      } catch (e) { ok(null); }
    });
  }
  function videoInfo(f) {
    return new Promise(function (ok) {
      var v = document.createElement('video'), url = URL.createObjectURL(f), done = false, d = 0;
      function fin(t) { if (done) return; done = true; URL.revokeObjectURL(url); ok({ d: d, thumb: t || null }); }
      v.preload = 'auto'; v.muted = true; v.playsInline = true;
      v.onloadedmetadata = function () { d = v.duration; try { v.currentTime = Math.min(0.5, (d || 1) / 2); } catch (e) { fin(null); } };
      v.onseeked = function () { if (v.videoWidth) thumbOf(v, v.videoWidth, v.videoHeight).then(fin); else fin(null); };
      v.onerror = function () { fin(null); };
      setTimeout(function () { fin(null); }, 8000); v.src = url;
    });
  }
  function duration(f) {
    return new Promise(function (ok) {
      var v = document.createElement('video'), url = URL.createObjectURL(f), done = false;
      function fin(d) { if (done) return; done = true; URL.revokeObjectURL(url); ok(d); }
      v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = function () { fin(v.duration); }; v.onerror = function () { fin(0); };
      setTimeout(function () { fin(0); }, 6000); v.src = url;
    });
  }
  function j(r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Upload failed. Please try again.'); return d; }); }
  function put(id, i, blob, tries) {
    return fetch('/api/media?id=' + id + '&part=' + i, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob }).then(j)
      .catch(function (e) { if (tries > 0) return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return put(id, i, blob, tries - 1); }); throw e; });
  }
  function upload(file, meta, prog) {
    prog = prog || function () {};
    var vid = isVideo(file), type, blobP;
    if (vid) {
      type = vidType(file);
      if (!type) return Promise.reject(new Error('Please choose an MP4 or MOV video.'));
      blobP = videoInfo(file).then(function (x) { if (x.d && x.d > MAXSEC) throw new Error('That video is ' + Math.round(x.d) + ' seconds. Please keep it to 20 seconds, one for each of our 20 years.'); return { blob: file, thumb: x.thumb }; });
    } else { type = 'image/jpeg'; blobP = shrink(file); }
    return blobP.then(function (pk) {
      var blob = pk.blob;
      return fetch('/api/media?op=start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: type, size: blob.size, name: meta.name, from: meta.from, caption: meta.caption }) }).then(j).then(function (s) {
        var n = Math.ceil(blob.size / s.chunk), i = 0;
        function next() {
          if (i >= n) return fetch('/api/media?op=done&id=' + s.id, { method: 'POST' }).then(j);
          var part = blob.slice(i * s.chunk, Math.min(blob.size, (i + 1) * s.chunk));
          return put(s.id, i, part, 2).then(function () { i++; prog(i / n); return next(); });
        }
        prog(0);
        var tp = pk.thumb ? fetch('/api/media?id=' + s.id + '&part=t', { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: pk.thumb }).catch(function () {}) : Promise.resolve();
        return tp.then(next);
      });
    }).then(function (d) { return d.item; });
  }
  function uploadMany(files, meta, status) {
    files = Array.prototype.slice.call(files || []);
    var out = [], errs = [], i = 0, n = files.length;
    function one() {
      if (i >= n) return Promise.resolve();
      var f = files[i], k = i + 1; i++;
      return upload(f, meta, function (p) { status('Uploading ' + k + ' of ' + n + (p > 0 && p < 1 ? ' (' + Math.round(p * 100) + '%)' : '') + '...'); })
        .then(function (it) { out.push(it); }, function (e) { errs.push((f.name || 'File ' + k) + ': ' + e.message); })
        .then(one);
    }
    return one().then(function () { return { items: out, errors: errs }; });
  }
  var listP = null;
  function items(fresh) { if (!listP || fresh) listP = fetch('/api/media').then(function (r) { return r.ok ? r.json() : { items: [] }; }).then(function (d) { return d.items || []; }).catch(function () { return []; }); return listP; }
  function src(it) { return '/api/media?file=' + it.id; }
  function small(it) { return it.thumb ? src(it) + '&thumb=1' : src(it); }
  function tile(it, big) {
    var who = esc(it.name) + (it.from ? ', ' + esc(it.from) : '');
    var media = it.kind === 'vid'
      ? '<video src="' + src(it) + '#t=0.1" controls playsinline preload="' + (it.thumb ? 'none" poster="' + small(it) : 'metadata') + '"></video>'
      : '<a href="' + src(it) + '" class="mz" data-id="' + it.id + '"><img src="' + small(it) + '" alt="' + (it.caption ? esc(it.caption) : 'Photo shared by ' + who) + '" loading="lazy"></a>';
    return '<figure class="gm' + (big ? ' big' : '') + '">' + media + '<figcaption>' + (it.caption ? esc(it.caption) + ' ' : '') + '<span class="who">' + who + '</span></figcaption></figure>';
  }
  function lightbox() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.mz'); if (!a) return; e.preventDefault();
      var d = document.createElement('div'); d.className = 'mzbox'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Photo');
      d.innerHTML = '<button type="button" aria-label="Close">&times;</button><img src="' + a.getAttribute('href') + '" alt="">';
      function close() { d.remove(); document.removeEventListener('keydown', k); }
      function k(ev) { if (ev.key === 'Escape') close(); }
      d.addEventListener('click', close); document.addEventListener('keydown', k); document.body.appendChild(d); d.querySelector('button').focus();
    });
  }
  window.USQ = { upload: upload, uploadMany: uploadMany, items: items, tile: tile, esc: esc, lightbox: lightbox };
})();
