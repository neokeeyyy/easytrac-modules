// ==UserScript==
// @name         SToolkit
// @namespace    siretrac.stoolkit
// @version      1.4.0
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaDisPla
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaES
// @match        https://siretrac.cne.gob.mx/GasLP/Compras/NuevoRegistro_IngresaDatos
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (typeof jQuery === 'undefined' || typeof $ === 'undefined') return;
  if (!$('#idFechaVenta').length && !$('#idFechaCompra').length) return;

  var esDisPla = $('#idtblVentasEntidad').length > 0;
  var esCompra = $('#idFechaCompra').length > 0;
  var esES = !esDisPla && !esCompra && $('#idVolumenVehiculo').length > 0;

  var fechaForzada = null;
  var _validaWrapped = false;

  var panel = document.createElement('div');
  panel.id = 'stoolkit-fecha-panel';
  panel.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#e6e6e6;color:#4d4d4d;' +
    'padding:8px 10px;border-radius:6px;border:1px solid #cccccc;font:12px Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  panel.innerHTML =
    '<input id="stoolkit-fecha-input" placeholder="DD/MM/YYYY" style="width:100px;padding:4px;border:1px solid #b0b0b0;border-radius:4px;margin-right:4px;color:#4d4d4d;background:#f5f5f5;outline:none">' +
    '<button id="stoolkit-fecha-cal" type="button" style="background:#cfcfcf;border:1px solid #b0b0b0;border-radius:4px;padding:4px 7px;cursor:pointer;color:#4d4d4d;margin-right:6px"><span class="glyphicon glyphicon-calendar"></span></button>' +
    '<button id="stoolkit-fecha-btn" style="background:#2EA836;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-weight:bold">Forzar fecha</button>';
  document.body.appendChild(panel);

  (function inicializaCalendario() {
    if (typeof $.fn.datepicker === 'undefined') return;
    $('#stoolkit-fecha-input').datepicker({
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
    $('#stoolkit-fecha-cal').on('click', function () {
      $('#stoolkit-fecha-input').datepicker('show');
    });
  })();

  document.getElementById('stoolkit-fecha-btn').addEventListener('click', function () {
    var fecha = document.getElementById('stoolkit-fecha-input').value.trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) return;

    if (esCompra) {
      $('#idFechaCompra').val(fecha);
      $('#hdMsgErrorFecha').val('');
      fechaForzada = fecha;
      if (!_validaWrapped) {
        _validaWrapped = true;
        var metodoOrig = null;
        try { metodoOrig = jQuery.validator.methods.ValidaFechaIngreso; } catch (e) {}
        if (metodoOrig) {
          jQuery.validator.methods.ValidaFechaIngreso = function (value, element) {
            if (fechaForzada && String(value).trim() === fechaForzada) {
              $('#hdMsgErrorFecha').val('');
              return true;
            }
            return metodoOrig.apply(this, arguments);
          };
        }
      }
      try { if ($('#idFechaCompra').rules) $('#idFechaCompra').rules('remove', 'remote'); } catch (e) {}
      return;
    }

    var $f = $('#idFechaVenta');
    $f.val(fecha);
    $('#HdMensajeFechaVenta').val('');
    if (esDisPla) {
      var hd = $('#HdFechasActivas');
      var actuales = hd.val() ? String(hd.val()) : '';
      var lista = actuales ? actuales.split(',') : [];
      if (lista.indexOf(fecha) === -1) lista.push(fecha);
      hd.val(lista.join(','));
      try {
        var v = $('#frmDatosVenta').validate();
        v.settings.rules.idFechaVenta = { required: true };
      } catch (e) {}
    }
  });
})();