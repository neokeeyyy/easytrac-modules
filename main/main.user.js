// ==UserScript==
// @name         EASYTRAC Main
// @namespace    easytrac.main
// @version      2.0.3
// @description  Orquestador modular EASYTRAC — automatización SIRETRAC (Gas LP)
// @author       ojuel
// @match        https://siretrac.cne.gob.mx/*
// @match        http://siretrac.cne.gob.mx/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.3/modules/shared.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.3/modules/module-acs.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.3/modules/module-acs-rep.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.3/modules/module-stoolkit.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.3/modules/module-sales.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.3/modules/module-acuses.js
// @updateURL    https://raw.githubusercontent.com/neokeeyyy/easytrac-modules/main/main/main.user.js
// @downloadURL  https://raw.githubusercontent.com/neokeeyyy/easytrac-modules/main/main/main.user.js
// @run-at       document-idle
// @updateMode   notify
// ==/UserScript==

(function () {
  'use strict';

  /* ================================================================
   *  EASYTRAC MAIN — Orquestador modular
   *
   *  1. Inicializa el namespace window.ET (shared.js ya lo creó)
   *  2. Exponer GM APIs al namespace
   *  3. Inyectar CSS global
   *  4. Iniciar cada módulo registrado
   *  5. UI global: botón de emergencia + panel de estado
   * ================================================================ */

  var ET = window.ET;
  if (!ET) {
    console.error('[ET Main] window.ET no existe. ¿shared.js se cargó?');
    return;
  }

  /* ---- 1. GM APIs ---- */
  ET.storage = {
    get: function (k) {
      try { return GM_getValue(k); }
      catch (e) { return null; }
    },
    set: function (k, v) {
      try { GM_setValue(k, v); }
      catch (e) { /* silencio */ }
    }
  };

  ET.download = function (url, name) {
    try { GM_download({ url: url, name: name }); }
    catch (e) { console.error('[ET] GM_download fallback:', e); }
  };

  ET.style = function (css) {
    try { GM_addStyle(css); }
    catch (e) {
      var s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    }
  };

  /* ---- 2. jQuery y ventana de página ---- */
  // ET.$ = jQuery del sandbox (@require). ET.win = ventana real de la página.
  // ET.$page = jQuery DE LA PÁGINA (con DataTables, validate, datepicker,
  // moment y demás plugins de SIRETRAC): es el que deben usar los backends.
  ET.$ = window.jQuery || window.$ || null;
  ET.win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  ET.$page = ET.win.jQuery || ET.win.$ || ET.$;

  /* ---- 3. Event bus (complementario a shared.js) ---- */
  var _handlers = {};
  ET.on = function (event, handler) {
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(handler);
  };
  ET.emit = function (event, data) {
    var list = _handlers[event];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error('[ET]', event, e); }
    }
  };

  /* ---- 4. Estado global ---- */
  ET.state = ET.state || {};
  ET.state.config = ET.storage.get('et_config') || {};
  ET.state.ui = { panels: {}, activeTab: {} };
  ET.state.session = {};

  ET.config = {
    cargar: function () {
      var raw = ET.storage.get('et_config');
      if (raw && typeof raw === 'object') ET.state.config = Object.assign({}, ET.state.config, raw);
      return ET.state.config;
    },
    guardar: function (key, val) {
      if (arguments.length === 1 && typeof key === 'object') {
        Object.assign(ET.state.config, key);
      } else if (arguments.length === 2) {
        ET.state.config[key] = val;
      }
      ET.storage.set('et_config', ET.state.config);
    },
    get: function (key, def) {
      return ET.state.config[key] !== undefined ? ET.state.config[key] : def;
    },
    set: function (key, val) {
      ET.state.config[key] = val;
      ET.storage.set('et_config', ET.state.config);
    }
  };
  ET.config.cargar();

  /* ---- 5. Utils globales ---- */
  ET.utils.pad2 = function (n) { return String(n).padStart(2, '0'); };
  ET.utils.isoToDMA = function (iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return iso || '';
    return p[2] + '/' + p[1] + '/' + p[0];
  };
  ET.utils.parseDia = function (s) {
    var p = String(s || '').split('/');
    if (p.length !== 3) return new Date();
    return new Date(+p[2], +p[1] - 1, +p[0]);
  };
  ET.utils.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  ET.utils.norm = function (s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  };
  ET.utils.esc = function (x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  ET.utils.verboseLog = function (tag, data) {
    try { console.log('[ET][' + tag + '] ' + JSON.stringify(data, null, 2)); }
    catch (e) { console.log('[ET][' + tag + ']', data); }
  };
  ET.utils.$ = function (sel) { return document.querySelector(sel); };
  ET.utils.$$ = function (sel) { return document.querySelectorAll(sel); };

  /* ---- 6. Inicializar módulos ---- */
  var modOrder = ['shared', 'acs', 'acsRep', 'stoolkit', 'sales', 'acuses'];
  var initResults = {};

  modOrder.forEach(function (name) {
    var mod = ET.modules[name];
    if (!mod) {
      console.warn('[ET Main] Módulo no registrado:', name);
      initResults[name] = { ok: false, error: 'no registrado' };
      return;
    }
    if (typeof mod.init !== 'function') {
      initResults[name] = { ok: true, note: 'sin init' };
      return;
    }
    try {
      mod.init(ET);
      if (mod.css) ET.style(mod.css);
      initResults[name] = { ok: true, version: mod.version };
      ET.utils.verboseLog('init OK', { module: name, version: mod.version });
    } catch (e) {
      console.error('[ET Main] Error init ' + name + ':', e);
      mod.error = e.message;
      mod.enabled = false;
      initResults[name] = { ok: false, error: e.message };
    }
  });

  ET.utils.verboseLog('main', { results: initResults, version: ET.version });

  /* ---- 7. Ventana flotante de herramientas ---- */
  (function () {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(link);

    var btn = document.createElement('button');
    btn.id = 'et-floating-button';
    btn.type = 'button';
    btn.title = 'Abrir herramientas EASYTRAC';
    btn.innerHTML = '<i class="fa-solid fa-universal-access"></i>';
    btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:48px;height:48px;border-radius:50%;border:none;background:#6f6f6f;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);';

    var win = document.createElement('div');
    win.id = 'et-floating-window';
    win.style.cssText = 'position:fixed;top:60px;right:16px;width:420px;max-height:80vh;overflow:auto;z-index:2147483646;display:none;background:#fff;color:#222;border:1px solid #6f6f6f;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.35);font:12px roboto,Arial,sans-serif;resize:both;';

    var tabbar = document.createElement('div');
    tabbar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:1px solid #ddd;background:#f1f1f1;';
    var pane = document.createElement('div');
    pane.style.cssText = 'padding:10px;';

    var sections = [
      { id: 'autocompra', label: 'AUTOCOMPRA', modules: ['acs', 'acsRep'] },
      { id: 'autoventa', label: 'AUTOVENTA', modules: ['sales'] },
      { id: 'stoolkit', label: 'TOOLKIT', modules: ['stoolkit'] },
      { id: 'acuses', label: 'ACUSES DOWNLOADER', modules: ['acuses'] }
    ];

    function sectionHTML(ids) {
      return ids.map(function (name) {
        var mod = ET.modules[name];
        var res = initResults[name] || {};
        var html = '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #eee">';
        html += '<b>' + name + '</b> — v' + (mod && mod.version ? mod.version : '?') + ' — ' + (res.ok ? 'ok' : (res.error || 'no registrado')) + '<br>';
        if (mod && mod.api && Object.keys(mod.api).length) {
          html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">';
          Object.keys(mod.api).forEach(function (k) {
            html += '<button type="button" data-mod="' + name + '" data-fn="' + k + '" style="background:#6f6f6f;color:#fff;border:none;border-radius:999px;padding:4px 8px;font-size:11px;cursor:pointer;">' + k + '</button>';
          });
          html += '</div>';
        }
        html += '</div>';
        return html;
      }).join('');
    }

    function showSection(idx) {
      var s = sections[idx];
      pane.innerHTML = sectionHTML(s.modules);
      var buttons = tabbar.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].style.background = i === idx ? '#6f6f6f' : '#fff';
        buttons[i].style.color = i === idx ? '#fff' : '#222';
      }
    }

    sections.forEach(function (s, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.label;
      b.dataset.idx = String(idx);
      b.style.cssText = 'border:1px solid #bbb;background:#fff;color:#222;border-radius:999px;padding:5px 9px;cursor:pointer;font-size:11px;';
      b.addEventListener('click', function () { showSection(idx); });
      tabbar.appendChild(b);
    });

    pane.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-mod]') : null;
      if (!b) return;
      var modName = b.getAttribute('data-mod');
      var fn = b.getAttribute('data-fn');
      var mod = ET.modules[modName];
      if (!mod || !mod.api || typeof mod.api[fn] !== 'function') return;
      try {
        var r = mod.api[fn]();
        if (r && typeof r.then === 'function') {
          r.then(function (v) {
            var pre = pane.querySelector('pre[data-out="' + modName + '"]');
            if (!pre) { pre = document.createElement('pre'); pre.setAttribute('data-out', modName); pane.appendChild(pre); }
            pre.textContent = typeof v === 'undefined' ? 'ok' : JSON.stringify(v, null, 2);
          }, function (e) {
            var pre = pane.querySelector('pre[data-out="' + modName + '"]');
            if (!pre) { pre = document.createElement('pre'); pre.setAttribute('data-out', modName); pane.appendChild(pre); }
            pre.textContent = 'ERROR: ' + (e && e.message ? e.message : e);
          });
        }
      } catch (e) {
        var pre = pane.querySelector('pre[data-out="' + modName + '"]');
        if (!pre) { pre = document.createElement('pre'); pre.setAttribute('data-out', modName); pane.appendChild(pre); }
        pre.textContent = 'ERROR: ' + e.message;
      }
    });

    win.appendChild(tabbar);
    win.appendChild(pane);
    showSection(0);

    btn.addEventListener('click', function () { win.style.display = win.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') win.style.display = 'none'; });

    document.body.appendChild(btn);
    document.body.appendChild(win);
  })();

  /* ---- 8. Exportar para debug ---- */
  window.ET_DEBUG = {
    initResults: initResults,
    modules: ET.modules,
    state: ET.state,
    config: ET.config
  };

  /* ---- 8. Notificar que todo está listo ---- */
  ET.emit('easytrac:ready', { version: ET.version, results: initResults });

})();
