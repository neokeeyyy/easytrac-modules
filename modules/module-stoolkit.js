// ==UserScript==
// @name         EASYTRAC SToolkit
// @namespace    easytrac.module.stoolkit
// @version      1.4.0
// @description  Módulo SToolkit — forzar fecha en formularios SIRETRAC
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ---- CSS ---- */
  var css = `
    #et-stoolkit-panel {
      position:fixed;bottom:16px;right:16px;z-index:2147483647;
      background:#e6e6e6;color:#4d4d4d;padding:8px 10px;border-radius:6px;
      border:1px solid #cccccc;font:12px Arial,sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,.25);
    }
    #et-stoolkit-panel input {
      width:100px;padding:4px;border:1px solid #b0b0b0;border-radius:4px;
      color:#4d4d4d;background:#f5f5f5;outline:none;
    }
    #et-stoolkit-panel button {
      background:#cfcfcf;border:1px solid #b0b0b0;border-radius:4px;
      padding:4px 7px;cursor:pointer;color:#4d4d4d;margin-right:6px;
    }
    #et-stoolkit-panel .et-btn-forzar {
      background:#2EA836;color:#fff;border:none;border-radius:4px;
      padding:5px 10px;cursor:pointer;font-weight:bold;
    }
  `;

  /* ---- Estado ---- */
  var fechaForzada = null;
  var _validaWrapped = false;
  var _panel = null;
  var _destroyed = false;

  /* ---- Funciones del módulo ---- */
  function forzarFecha(fechaDMA) {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fechaDMA)) return false;
    fechaForzada = fechaDMA;

    var $ = ET.$;
    if (!$) return false;

    var esCompra = $('#idFechaCompra').length > 0;
    var esDisPla = $('#idtblVentasEntidad').length > 0;

    if (esCompra) {
      $('#idFechaCompra').val(fechaDMA);
      $('#hdMsgErrorFecha').val('');
      if (!_validaWrapped) {
        _validaWrapped = true;
        try {
          var metodoOrig = jQuery.validator.methods.ValidaFechaIngreso;
          if (metodoOrig) {
            jQuery.validator.methods.ValidaFechaIngreso = function (value, element) {
              if (fechaForzada && String(value).trim() === fechaForzada) {
                $('#hdMsgErrorFecha').val('');
                return true;
              }
              return metodoOrig.apply(this, arguments);
            };
          }
        } catch (e) {}
      }
      try { if ($('#idFechaCompra').rules) $('#idFechaCompra').rules('remove', 'remote'); } catch (e) {}
      return true;
    }

    var $f = $('#idFechaVenta');
    if ($f.length) {
      $f.val(fechaDMA);
      $('#HdMensajeFechaVenta').val('');
      if (esDisPla) {
        var hd = $('#HdFechasActivas');
        if (hd.length) {
          var actuales = hd.val() ? String(hd.val()) : '';
          var lista = actuales ? actuales.split(',') : [];
          if (lista.indexOf(fechaDMA) === -1) lista.push(fechaDMA);
          hd.val(lista.join(','));
        }
        try { var v = $('#frmDatosVenta').validate(); v.settings.rules.idFechaVenta = { required: true }; } catch (e) {}
      }
      return true;
    }
    return false;
  }

  function getFechaForzada() { return fechaForzada; }

  function limpiar() {
    fechaForzada = null;
    _validaWrapped = false;
    if (_panel && _panel.parentNode) _panel.parentNode.removeChild(_panel);
    _panel = null;
  }

  /* ---- UI: panel flotante ---- */
  function crearPanel() {
    if (_panel) return;
    var $ = ET.$;
    if (!$) return;

    _panel = document.createElement('div');
    _panel.id = 'et-stoolkit-panel';
    _panel.innerHTML =
      '<input id="et-stoolkit-input" placeholder="DD/MM/YYYY">' +
      '<button id="et-stoolkit-cal" type="button">&#x1F4C5;</button>' +
      '<button id="et-stoolkit-btn" class="et-btn-forzar">Forzar fecha</button>';
    document.body.appendChild(_panel);

    // Calendario (si jQuery UI disponible)
    try {
      if (typeof $.fn.datepicker !== 'undefined') {
        $('#et-stoolkit-input').datepicker({
          dateFormat: 'dd/mm/yy',
          changeMonth: true,
          changeYear: true,
          maxDate: new Date(),
          beforeShowDay: function (date) {
            var lista = $('#HdFechasActivas').length ? $('#HdFechasActivas').val() : '';
            var dias = lista ? String(lista).split(',') : [];
            var dd = (date.getDate() < 10 ? '0' : '') + date.getDate();
            var mm = (date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1);
            var f2 = dd + '/' + mm + '/' + date.getFullYear();
            return [dias.length === 0 || dias.indexOf(f2) > -1, 'stoolkit-activo'];
          }
        });
        $('#et-stoolkit-cal').on('click', function () {
          $('#et-stoolkit-input').datepicker('show');
        });
      }
    } catch (e) {}

    // Botón forzar
    document.getElementById('et-stoolkit-btn').addEventListener('click', function () {
      var fecha = document.getElementById('et-stoolkit-input').value.trim();
      if (!forzarFecha(fecha)) {
        ET.ui.toast('Fecha inválida. Usa DD/MM/YYYY', 3000);
      }
    });
  }

  /* ---- Init / Destroy ---- */
  function init(et) {
    if (_destroyed) return;
    crearPanel();
    ET.utils.verboseLog('stoolkit', { version: '1.4.0', status: 'init' });
  }

  function destroy() {
    _destroyed = true;
    limpiar();
  }

  /* ---- Registrar módulo ---- */
  ET.register({
    name: 'stoolkit',
    version: '1.4.0',
    init: init,
    destroy: destroy,
    css: css,
    api: {
      forzarFecha: forzarFecha,
      getFechaForzada: getFechaForzada,
      limpiar: limpiar
    }
  });

})(window.ET);
