// ==UserScript==
// @name         EASYTRAC Shared
// @namespace    easytrac.shared
// @version      1.0.1
// @description  Namespace ET, config, estado, utils, event bus — base para todos los módulos
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ============ NAMESPACE ============ */
  window.ET = window.ET || {
    version: '1.0.0',
    modules: {},
    state: {
      config: {},
      ui: { panels: {}, activeTab: {} },
      session: {}
    }
  };

  var ET = window.ET;

  /* ============ EVENT BUS ============ */
  var _handlers = {};

  ET.emit = function (event, data) {
    var list = _handlers[event];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error('[ET][emit]', event, e); }
    }
  };

  ET.on = function (event, handler) {
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(handler);
  };

  ET.off = function (event, handler) {
    if (!handler) { _handlers[event] = []; return; }
    var list = _handlers[event];
    if (!list) return;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] === handler) list.splice(i, 1);
    }
  };

  /* ============ REGISTRO DE MÓDULOS ============ */
  ET.register = function (module) {
    if (!module || !module.name) {
      console.error('[ET][register] módulo inválido:', module);
      return;
    }
    ET.modules[module.name] = {
      name: module.name,
      version: module.version || '0.0.0',
      init: module.init || null,
      destroy: module.destroy || null,
      api: module.api || {},
      css: module.css || '',
      enabled: true,
      error: null
    };
  };

  ET.module = function (name) {
    return ET.modules[name] || null;
  };

  /* ============ STORAGE (GM APIs — inyectadas por el main) ============ */
  // ET.storage y ET.download se asignan desde el main.user.js
  // Si no hay GM, fallback a localStorage
  if (!ET.storage) {
    ET.storage = {
      get: function (k) {
        try { return JSON.parse(localStorage.getItem('et_' + k) || 'null'); }
        catch (e) { return null; }
      },
      set: function (k, v) {
        try { localStorage.setItem('et_' + k, JSON.stringify(v)); }
        catch (e) { /* silencio */ }
      }
    };
  }

  if (!ET.download) {
    ET.download = function () { /* no-op sin GM_download */ };
  }

  if (!ET.style) {
    ET.style = function (css) {
      var s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    };
  }

  /* ============ JQUERY ============ */
  // ET.$ se asigna desde el main.user.js tras @require de jQuery
  if (!ET.$) {
    ET.$ = (typeof window.jQuery !== 'undefined') ? window.jQuery : null;
  }

  /* ============ UTILS ============ */
  ET.utils = {
    pad2: function (n) { return String(n).padStart(2, '0'); },

    isoToDMA: function (iso) {
      var p = String(iso || '').split('-');
      if (p.length !== 3) return iso || '';
      return p[2] + '/' + p[1] + '/' + p[0];
    },

    parseDia: function (s) {
      var p = String(s || '').split('/');
      if (p.length !== 3) return new Date();
      return new Date(+p[2], +p[1] - 1, +p[0]);
    },

    parseISO: function (s) {
      var p = String(s || '').split('-');
      if (p.length !== 3) return new Date();
      return new Date(+p[0], +p[1] - 1, +p[2]);
    },

    ahoraHora: function () {
      var d = new Date();
      return ET.utils.pad2(d.getHours()) + ':' + ET.utils.pad2(d.getMinutes()) + ':' + ET.utils.pad2(d.getSeconds());
    },

    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },

    norm: function (s) {
      return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    },

    esc: function (x) {
      return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    verboseLog: function (tag, data) {
      try { console.log('[ET][' + tag + '] ' + JSON.stringify(data, null, 2)); }
      catch (e) { console.log('[ET][' + tag + ']', data); }
    },

    // Reintentos con backoff exponencial
    retry: function (fn, max, baseMs) {
      var intento = 0;
      var mx = Math.max(1, max || 3);
      var base = Math.max(1, baseMs || 100);
      function ejecutar() {
        intento++;
        return fn().then(function (res) {
          if (intento < mx && !res) {
            return ET.utils.sleep(base * Math.pow(2, intento - 1)).then(ejecutar);
          }
          return res;
        }).catch(function (e) {
          if (intento < mx) {
            return ET.utils.sleep(base * Math.pow(2, intento - 1)).then(ejecutar);
          }
          throw e;
        });
      }
      return ejecutar();
    },

    // Selector seguro
    $: function (sel) { return document.querySelector(sel); },
    $$: function (sel) { return document.querySelectorAll(sel); },

    // Crear elemento con atributos
    el: function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === 'style' && typeof attrs[k] === 'object') {
            Object.keys(attrs[k]).forEach(function (sk) { e.style[sk] = attrs[k][sk]; });
          } else if (k === 'className') {
            e.className = attrs[k];
          } else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
            e.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
          } else {
            e.setAttribute(k, attrs[k]);
          }
        });
      }
      if (children) {
        if (typeof children === 'string') e.textContent = children;
        else if (Array.isArray(children)) children.forEach(function (c) { if (c) e.appendChild(c); });
        else e.appendChild(children);
      }
      return e;
    },

    // Formatear número (compat con formatNumber de SIRETRAC)
    fmtNum: function (v) {
      var n = parseFloat(v);
      if (isNaN(n)) return String(v || '');
      return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  };

  /* ============ CONFIGURACIÓN GLOBAL ============ */
  ET.config = {
    cargar: function () {
      var raw = ET.storage.get('config');
      if (raw && typeof raw === 'object') ET.state.config = Object.assign({}, ET.state.config, raw);
      return ET.state.config;
    },
    guardar: function (key, val) {
      if (arguments.length === 1 && typeof key === 'object') {
        Object.assign(ET.state.config, key);
      } else if (arguments.length === 2) {
        ET.state.config[key] = val;
      }
      ET.storage.set('config', ET.state.config);
    },
    get: function (key, def) {
      return ET.state.config[key] !== undefined ? ET.state.config[key] : (def !== undefined ? def : null);
    },
    set: function (key, val) {
      ET.state.config[key] = val;
      ET.storage.set('config', ET.state.config);
    }
  };

  // Cargar config al inicio
  ET.config.cargar();

  /* ============ UI HELPERS ============ */
  ET.ui = {
    crearPanel: function (id, opciones) {
      var panel = document.createElement('div');
      panel.id = id;
      panel.className = 'et-panel';
      var pos = opciones.position || 'fixed';
      var bottom = opciones.bottom || '16px';
      var right = opciones.right || '16px';
      panel.style.cssText = 'position:' + pos + ';bottom:' + bottom + ';right:' + right +
        ';z-index:2147483647;background:#e6e6e6;color:#4d4d4d;' +
        'padding:8px 10px;border-radius:6px;border:1px solid #cccccc;' +
        'font:12px Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
      if (opciones.width) panel.style.width = opciones.width;
      return panel;
    },

    crearBoton: function (id, texto, onClick, estilo) {
      var btn = document.createElement('button');
      btn.id = id;
      btn.textContent = texto;
      btn.style.cssText = estilo || 'background:#2EA836;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-weight:bold';
      if (onClick) btn.addEventListener('click', onClick);
      return btn;
    },

    crearInput: function (id, placeholder, estilo) {
      var inp = document.createElement('input');
      inp.id = id;
      inp.placeholder = placeholder || '';
      inp.style.cssText = estilo || 'width:100px;padding:4px;border:1px solid #b0b0b0;border-radius:4px;color:#4d4d4d;background:#f5f5f5;outline:none';
      return inp;
    },

    toast: function (mensajes, duracion) {
      var prev = document.getElementById('et-toast');
      if (prev) prev.remove();
      var d = document.createElement('div');
      d.id = 'et-toast';
      d.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#1d3557;color:#fff;padding:12px 16px;border-radius:6px;font:13px/1.6 Arial,sans-serif;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,.4);';
      if (typeof mensajes === 'string') mensajes = [mensajes];
      for (var i = 0; i < mensajes.length; i++) {
        var p = document.createElement('div');
        p.textContent = mensajes[i];
        d.appendChild(p);
      }
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, duracion || 15000);
    },

    aviso: function (texto, tipo) {
      tipo = tipo || 'info';
      var colores = { info: '#1d3557', ok: '#2EA836', error: '#C60C0E', warn: '#ff9800' };
      var pal = colores[tipo] || colores.info;
      var viejo = document.getElementById('et-aviso');
      if (viejo) viejo.remove();
      var d = document.createElement('div');
      d.id = 'et-aviso';
      d.textContent = texto;
      d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' + pal + ';color:#fff;font:bold 13px roboto,Arial,sans-serif;padding:10px 18px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);';
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.remove(); }, 6000);
    }
  };

  /* ============ PILL (indicador flotante) ============ */
  ET.ui.crearPill = function (id, texto, onClick, bottom) {
    var pill = document.createElement('div');
    pill.id = id;
    pill.title = texto;
    pill.textContent = texto;
    pill.style.cssText = 'position:fixed;left:12px;z-index:2147483647;background:#6f6f6f;color:#fff;padding:9px 14px;border-radius:22px;font:bold 12px roboto,Arial,sans-serif;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none;letter-spacing:.4px;';
    pill.style.bottom = bottom || '12px';
    if (onClick) pill.addEventListener('click', onClick);
    return pill;
  };

  /* ============ HISTORIAL POPUP ============ */
  ET.ui.popupHistorial = function (lista, onLimpiar) {
    var grupos = [], indice = {};
    lista.forEach(function (r) {
      var f = r.f || '';
      if (!indice[f]) { indice[f] = []; grupos.push(f); }
      indice[f].push(r);
    });
    var secciones = '';
    grupos.forEach(function (f) {
      var filas = '';
      indice[f].forEach(function (r) {
        filas += '<tr><td>' + ET.utils.esc(r.n) + '</td><td style="text-align:center">' + ET.utils.esc(r.h || '') + '</td></tr>';
      });
      secciones += '<div class="et-fecha">' + ET.utils.esc(f ? ET.utils.esc(f) : 'Sin fecha') + ' · ' + indice[f].length + ' compra' + (indice[f].length > 1 ? 's' : '') + '</div>' +
        '<table><thead><tr><th>Número de registro</th><th style="width:70px">Hora</th></tr></thead><tbody>' + filas + '</tbody></table>';
    });
    if (!secciones) secciones = '<div class="et-vacio">Sin registros aún</div>';

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Historial ET</title><style>' +
      'body{font-family:roboto,Arial,sans-serif;margin:0;background:#f1f1f1;color:#000}' +
      '#head{background:#6f6f6f;color:#fff;padding:9px 14px;font-weight:bold;font-size:14px}' +
      '#zona{background:#fff;border-bottom:3px solid #2EA836;padding:16px 14px;text-align:center}' +
      '#lbl{font-size:11px;color:#555;font-weight:bold;letter-spacing:.5px}' +
      '#ult{font-size:26px;font-weight:bold;color:#1b5e20;letter-spacing:1px;margin:8px 0 12px;user-select:text}' +
      'button{border:none;border-bottom:4px solid rgba(0,0,0,.25);color:#fff;font-weight:bold;font-size:13px;padding:8px 16px;cursor:pointer;border-radius:3px;margin:0 4px}' +
      '#copiar{background:#2EA836}#limpiar{background:#C60C0E}' +
      '#lista{padding:4px 10px 12px;overflow:auto;max-height:300px}' +
      '.et-fecha{background:#555;color:#fff;font-size:11px;font-weight:bold;padding:5px 8px;margin-top:10px;text-transform:capitalize}' +
      'table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}' +
      'th{background:#6f6f6f;color:#fff;padding:5px 8px;text-align:left}' +
      'td{border:1px solid #ddd;padding:5px 8px}' +
      '.et-vacio{text-align:center;color:#888;padding:16px;font-size:13px}</style></head><body>' +
      '<div id="head">HISTORIAL DE COMPRAS REGISTRADAS</div>' +
      '<div id="zona"><div id="lbl">ÚLTIMO NÚMERO DE REGISTRO</div>' +
      '<div id="ult">' + ET.utils.esc(lista.length ? lista[0].n : '—') + '</div>' +
      '<button id="et-pop-copiar">Copiar número</button><button id="et-pop-limpiar">Limpiar historial</button></div>' +
      '<div id="lista">' + secciones + '</div></body></html>';

    return html;
  };

  /* ============ EXPORTAR ============ */
  // shared.js no tiene init/destroy propios — el main lo registra vacío
  ET.register({ name: 'shared', version: '1.0.1', init: null, destroy: null });

})();
