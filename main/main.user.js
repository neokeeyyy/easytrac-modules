// ==UserScript==
// @name         EASYTRAC Main
// @namespace    easytrac.main
// @version      1.0.4
// @description  Orquestador modular EASYTRAC — automatización SIRETRAC (Gas LP)
// @author       ojuel
// @match        https://siretrac.cne.gob.mx/*
// @match        http://siretrac.cne.gob.mx/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v1.0.4/modules/shared.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v1.0.4/modules/module-acs.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v1.0.4/modules/module-acs-rep.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v1.0.4/modules/module-stoolkit.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v1.0.4/modules/module-sales.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac-modules@v1.0.4/modules/module-acuses.js
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

  /* ---- 2. jQuery ---- */
  ET.$ = window.jQuery || window.$ || null;

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
      console.warn('[ET Main] Módulo sin init():', name);
      initResults[name] = { ok: false, error: 'sin init' };
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

  /* ---- 7. UI global: botón de emergencia ---- */
  var emergencyBtn = document.createElement('button');
  emergencyBtn.id = 'et-emergency';
  emergencyBtn.textContent = 'ET';
  emergencyBtn.title = 'EASYTRAC — estado de módulos';
  emergencyBtn.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483647;' +
    'background:#1d3557;color:#fff;border:none;border-radius:50%;width:36px;height:36px;' +
    'font:bold 14px Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);';
  emergencyBtn.addEventListener('click', function () {
    var lines = [];
    modOrder.forEach(function (n) {
      var m = ET.modules[n];
      if (!m) { lines.push(n + ': NO CARGADO'); return; }
      var status = m.enabled ? (m.error ? 'ERROR: ' + m.error : 'OK') : 'DISABLED';
      lines.push(n + ' v' + m.version + ': ' + status);
    });
    alert('EASYTRAC v' + ET.version + '\n\n' + lines.join('\n'));
  });
  document.body.appendChild(emergencyBtn);

  /* ---- 8. Exportar para debug ---- */
  window.ET_DEBUG = {
    initResults: initResults,
    modules: ET.modules,
    state: ET.state,
    config: ET.config
  };

  /* ---- 9. Notificar que todo está listo ---- */
  ET.emit('easytrac:ready', { version: ET.version, results: initResults });

})();
