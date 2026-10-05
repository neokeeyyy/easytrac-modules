// ==UserScript==
// @name         EASYTRAC Main
// @namespace    easytrac.main
// @version      2.0.1
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
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.1/modules/shared.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.1/modules/module-acs.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.1/modules/module-acs-rep.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.1/modules/module-stoolkit.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.1/modules/module-sales.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v2.0.1/modules/module-acuses.js
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

  /* ---- 7. Botón flotante + panel de pestañas ---- */
  (function () {
    var btn = document.createElement('button');
    btn.id = 'et-floating-button';
    btn.type = 'button';
    btn.textContent = 'EASYTRAC';
    btn.title = 'Abrir herramientas EASYTRAC';
    btn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#1d3557;color:#fff;border:none;border-radius:999px;padding:9px 14px;font:bold 12px roboto,Arial,sans-serif;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none;letter-spacing:.4px;';

    var panel = document.createElement('div');
    panel.id = 'et-floating-panel';
    panel.style.cssText = 'position:fixed;top:60px;right:12px;z-index:2147483647;width:360px;max-height:70vh;overflow:auto;display:none;background:#fff;color:#222;border:1px solid #6f6f6f;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.35);font:12px roboto,Arial,sans-serif;resize:both;';

    var tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:1px solid #ddd;background:#f1f1f1;';
    var body = document.createElement('div');
    body.style.cssText = 'padding:10px;';

    function showTab(name) {
      var mod = ET.modules[name];
      var page = initResults[name] || {};
      var html = '<b style="font-size:13px">' + name + '</b><br>' +
        'versión: ' + (mod && mod.version ? mod.version : '—') + '<br>' +
        'estado: ' + (page.ok ? 'ok' : (page.error || 'sin iniciar')) + '<br>';
      if (mod && mod.error) html += 'error: ' + mod.error + '<br>';
      if (mod && mod.css) html += 'css: sí<br>';
      var keys = mod && mod.api ? Object.keys(mod.api) : [];
      html += 'api: ' + (keys.length ? keys.join(', ') : '—') + '<br>';
      html += '<div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;color:#555">' +
        'Este panel superpone herramientas sin cambiar el layout de SIRETRAC.</div>';
      body.innerHTML = html;
      var bbar = tabs.querySelectorAll('button');
      for (var i = 0; i < bbar.length; i++) bbar[i].style.fontWeight = (bbar[i].dataset.tab === name ? 'bold' : 'normal');
    }

    modOrder.forEach(function (name) {
      var t = document.createElement('button');
      t.type = 'button';
      t.textContent = name;
      t.dataset.tab = name;
      t.style.cssText = 'border:1px solid #bbb;background:#fff;color:#222;border-radius:4px;padding:4px 7px;cursor:pointer;font-size:11px;';
      t.addEventListener('click', function () { showTab(name); });
      tabs.appendChild(t);
    });

    panel.appendChild(tabs);
    panel.appendChild(body);
    showTab(modOrder[0]);

    btn.addEventListener('click', function () {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') panel.style.display = 'none';
    });

    document.body.appendChild(btn);
    document.body.appendChild(panel);
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
