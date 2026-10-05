// ==UserScript==
// @name         EASYTRAC Sales
// @namespace    easytrac.module.sales
// @version      1.5.0
// @description  Módulo SIRETRAC Auto-fill Registro de Venta — pega bloque Excel para auto-llenar
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ---- CSS ---- */
  var css = `
    #et-sales-toast {
      position:fixed;top:10px;right:10px;z-index:999999;
      background:#1d3557;color:#ffffff;padding:12px 16px;border-radius:6px;
      font:13px/1.6 Arial,sans-serif;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,.4);
    }
    #et-sales-toast p { margin:0 0 4px; }
    #et-sales-toast p:last-child { margin-bottom:0; }
  `;

  /* ---- Constantes ---- */
  var RE_FECHA = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),\s*(\d{1,2})\s+de\s+([a-záéíóúñü]+)\s+de\s+(\d{4})$/i;
  var MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  var SECTORES = { comercial: 'Comercial y Servicio', 'comercial y servicio': 'Comercial y Servicio', residencial: 'Residencial' };
  var ESTADOS = ['guanajuato', 'zacatecas', 'san luis potosi', 'jalisco', 'aguascalientes', 'nuevo leon', 'coahuila', 'tamaulipas', 'veracruz', 'michoacan', 'queretaro', 'hidalgo', 'mexico', 'ciudad de mexico', 'durango', 'chihuahua', 'sonora', 'sinaloa', 'nayarit', 'colima'];
  var ORDEN_FIJO = [
    ['Guanajuato', 'San Felipe', 'Comercial'],
    ['Guanajuato', 'San Felipe', 'Residencial'],
    ['Zacatecas', 'Pinos', 'Comercial'],
    ['Zacatecas', 'Pinos', 'Residencial'],
    ['San Luis Potosí', 'Villa de Arriaga', 'Comercial'],
    ['San Luis Potosí', 'Villa de Arriaga', 'Residencial'],
    ['Jalisco', 'Ojuelos de Jalisco', 'Comercial'],
    ['Jalisco', 'Ojuelos de Jalisco', 'Residencial']
  ];

  var _destroyed = false;

  /* ---- Helpers ---- */
  function norm(s) { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

  function cells(linea) { return linea.split('\t').map(function (c) { return c.trim(); }); }

  function esNumero(c) {
    if (!c) return false;
    return /^-?\d+(\.\d+)?$/.test(c.replace(/[$,\s]/g, ''));
  }

  function aNumero(c) {
    var v = parseFloat(c.replace(/[$,\s]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function fechaDe(texto) {
    var m = RE_FECHA.exec(texto || '');
    if (!m) return null;
    var mes = MESES[(m[3] || '').toLowerCase()];
    if (!mes) return null;
    return ('0' + m[2]).slice(-2) + '/' + ('0' + mes).slice(-2) + '/' + m[4];
  }

  function sectorDesdeCelda(celdas) {
    for (var i = 0; i < celdas.length; i++) {
      var s = SECTORES[norm(celdas[i])];
      if (s) return s;
    }
    return null;
  }

  function esDash(c) { return c.replace(/[$\s]/g, '') === '-'; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function confirmarSinVenta(mensaje) {
    return window.confirm(mensaje);
  }

  /* ---- Parser: DisPla ---- */
  function parsear(texto) {
    var lineas = texto.split(/\r?\n/);
    var res = { fechas: [], totalLitros: null, autoconsumo: null, bloques: [], filaTotal: null, recipientes: { lineas: [] } };
    var fase = 'totales';
    var seccion = null;
    var nBloques = 0;
    for (var i = 0; i < lineas.length; i++) {
      var c = cells(lineas[i]);
      var noVacias = c.filter(function (x) { return x !== ''; });
      for (var k = 0; k < c.length; k++) {
        var f = fechaDe(c[k]);
        if (f) res.fechas.push(f);
      }
      var esCab = c.some(function (x) { return norm(x) === 'volumen'; });
      var nums = c.filter(esNumero);
      var hayDash = c.some(esDash);
      if (fase === 'totales') {
        if (!noVacias.length) continue;
        if (esCab) { fase = 'bloques'; seccion = { nombre: null, municipio: null, lineas: [] }; res.bloques.push(seccion); nBloques = 1; continue; }
        if (nums.length && res.totalLitros === null) res.totalLitros = nums.map(aNumero);
        else if (nums.length && res.autoconsumo === null) res.autoconsumo = nums.map(aNumero);
        continue;
      }
      if (fase === 'bloques') {
        if (!noVacias.length) continue;
        if (esCab && nBloques < 4) { seccion = { nombre: null, municipio: null, lineas: [] }; res.bloques.push(seccion); nBloques++; continue; }
        if (esCab) { fase = 'recipientes'; continue; }
        if (nums.length === 2 && nBloques >= 4) { res.filaTotal = nums.map(aNumero); fase = 'recipientes'; continue; }
        if (nums.length === 3 || nums.length === 6) {
          if (ESTADOS.indexOf(norm(c[0])) >= 0 && c[0] !== '') { seccion.nombre = c[0]; seccion.municipio = c[1] || ''; }
          seccion.lineas.push({ celdas: c, nums: nums.map(aNumero) });
          continue;
        }
        if (hayDash) { seccion.lineas.push({ celdas: c, nums: [0, 0, 0], cero: true }); continue; }
        continue;
      }
      if (!noVacias.length || esCab) continue;
      if (nums.length === 3 || nums.length === 6) { res.recipientes.lineas.push({ celdas: c, nums: nums.map(aNumero) }); }
      else if (hayDash) { res.recipientes.lineas.push({ sinVenta: true }); }
    }
    return res;
  }

  /* ---- Parser: ES ---- */
  function parsearES(texto) {
    var lineas = texto.split(/\r?\n/);
    var res = { fechas: [], ventas: [] };
    for (var i = 0; i < lineas.length; i++) {
      var c = cells(lineas[i]);
      var noVacias = c.filter(function (x) { return x !== ''; });
      for (var k = 0; k < c.length; k++) {
        var f = fechaDe(c[k]);
        if (f) res.fechas.push(f);
      }
      if (!noVacias.length) continue;
      var primer = noVacias[0].toUpperCase();
      if (primer.indexOf('VENTA LITROS') === 0) {
        var seq = c.filter(celdaValorES);
        var cols = [];
        for (var j = 0; j + 2 < seq.length; j += 3) { cols.push({ vol: seq[j], precio: seq[j + 1], imp: seq[j + 2] }); }
        res.ventas = cols;
      }
    }
    return res;
  }

  function celdaValorES(c) {
    if (!c) return false;
    return esNumero(c) || esDash(c);
  }

  /* ---- UI helpers ---- */
  function toast(mensajes) {
    var prev = document.getElementById('et-sales-toast');
    if (prev) prev.remove();
    var d = document.createElement('div');
    d.id = 'et-sales-toast';
    d.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#1d3557;color:#ffffff;padding:12px 16px;border-radius:6px;font:13px/1.6 Arial,sans-serif;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,.4);';
    if (typeof mensajes === 'string') mensajes = [mensajes];
    for (var i = 0; i < mensajes.length; i++) {
      var p = document.createElement('div');
      p.textContent = mensajes[i];
      d.appendChild(p);
    }
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 15000);
  }

  function pintarInput(id, valor) {
    var el = document.getElementById(id);
    if (!el) return false;
    var texto;
    try { texto = formatNumber.new(valor, ''); } catch (err) { texto = String(valor); }
    el.value = texto;
    return true;
  }

  function tieneCheck($i) {
    if (!$i || !$i.length) return false;
    if ($i.closest('.col-sm-12.has-success').length) return true;
    if ($i.closest('.input-group').find('span.glyphicon-ok').length) return true;
    if ($i.attr('aria-invalid') === 'false' && $i.attr('aria-describedby')) return true;
    return false;
  }

  function forzarCheck($i) {
    if (!$i || !$i.length) return;
    try {
      $i.trigger('change');
      var form = $i.closest('form');
      if (form.length && form.validate) { form.validate().element($i); }
    } catch (err) {}
    if (tieneCheck($i)) return;
    var id = $i.attr('id') || '';
    var $grupo = $i.closest('.input-group').length ? $i.closest('.input-group') : $i.parent();
    var $wrap = $i.closest('.col-sm-12.has-feedback').length ? $i.closest('.col-sm-12.has-feedback') : $i.closest('.col-sm-12');
    if ($wrap.length) $wrap.addClass('has-feedback has-success');
    if (!$grupo.find('span.form-control-feedback.glyphicon-ok').length) {
      $grupo.append('<span class="glyphicon form-control-feedback glyphicon-ok" style="right: 0; left:0; z-index:3;"></span>');
    }
    $i.attr('aria-describedby', id + '-error').attr('aria-invalid', 'false');
    var $msgC = $i.closest('div').find('.messageContainer');
    if ($msgC.length && !$msgC.find('em').length) {
      $msgC.append('<em id="' + id + '-error" class="error help-block" style="display: inline;"></em>');
    }
  }

  async function escribirYVerificarFila(fila, idVol, idVal, campoVol, campoVal, esperadoVol, esperadoVal, msgs, warns, label) {
    var $ = ET.$;
    if (!$('#' + idVol).length || !$('#' + idVal).length) {
      fila[campoVol] = esperadoVol; fila[campoVal] = esperadoVal;
      try { ActualizaDatosVentaPrecargaDDAC(fila); } catch (err) {}
      warns.push(label + ': fila fuera de página; dato guardado pero no verificable.');
      return false;
    }
    var ok = false;
    for (var intento = 0; intento < 3 && !ok; intento++) {
      fila[campoVol] = esperadoVol; fila[campoVal] = esperadoVal;
      pintarInput(idVol, esperadoVol); pintarInput(idVal, esperadoVal);
      try { ActualizaDatosVentaPrecargaDDAC(fila); } catch (err) {}
      await sleep(350);
      var $v = $('#' + idVol); var $imp = $('#' + idVal);
      forzarCheck($v); forzarCheck($imp);
      var volOk = tieneCheck($v) && (esperadoVol === 0 || aNumero($v.val()) !== 0);
      var impOk = tieneCheck($imp) && (esperadoVal === 0 || aNumero($imp.val()) !== 0);
      ok = volOk && impOk;
    }
    if (ok) { msgs.push(label + ' ✔'); return true; }
    var causas = [];
    if (!tieneCheck($('#' + idVol)) || !tieneCheck($('#' + idVal))) causas.push('sin check');
    if (aNumero($('#' + idVol).val()) === 0 || aNumero($('#' + idVal).val()) === 0) causas.push('valor en 0');
    warns.push(label + ' NO quedó confirmado tras 3 intentos (' + (causas.join(', ') || 'desconocido') + '). Revisa antes de guardar.');
    return false;
  }

  function buscarFilaAT(estado, municipio, sector) {
    var $ = ET.$;
    var table = $('#idtblVentasEntidad').DataTable();
    if (!table) return null;
    var sMap = SECTORES[norm(sector)];
    var targetSector = sMap || sector;
    var encontrada = null;
    table.rows().every(function () {
      var d = this.data();
      if (encontrada) return;
      if (norm(d.entidadFederativa) === norm(estado) && norm(d.municipio) === norm(municipio) && norm(d.sector) === norm(targetSector)) {
        encontrada = d;
      }
    });
    return encontrada;
  }

  function elegirColumna(fechas, fechaActual) {
    if (!fechas.length) return 0;
    if (fechas.length === 1) return 0;
    if (fechaActual) {
      for (var i = 0; i < fechas.length; i++) { if (norm(fechas[i]) === norm(fechaActual)) return i; }
    }
    return fechas.length - 1;
  }

  function valoresDeLinea(nums, col) {
    if (nums.length === 3) return { vol: nums[0], imp: nums[2] };
    if (nums.length === 6) return { vol: nums[col * 3], imp: nums[col * 3 + 2] };
    return null;
  }

  /* ---- Llenar DisPla ---- */
  async function llenar(texto, p) {
    var $ = ET.$;
    if (!$('#ShowbtonsGuardar').is(':visible')) {
      /* no-op: la pantalla de confirmación no debe llenarse */
    }
    var tableAT;
    try { tableAT = $('#idtblVentasEntidad').DataTable(); } catch (err) { tableAT = null; }
    if (!tableAT || tableAT.rows().count() === 0) {
      toast(['La tabla de ventas no está lista. Recarga la página.']);
      return;
    }

    var msgs = [];
    var warns = [];
    var fechaActual = $('#idFechaVenta').val().trim();
    var col = elegirColumna(p.fechas, fechaActual);
    var fecha = p.fechas[col] || null;

    if (fecha) {
      if (fechaActual === '') {
        $('#idFechaVenta').val(fecha).trigger('change');
        msgs.push('Fecha de venta: ' + fecha);
      } else if (norm(fechaActual) !== norm(fecha)) {
        warns.push('Fecha página (' + fechaActual + ') ≠ bloque (' + fecha + ').');
      } else {
        msgs.push('Fecha de venta: ' + fecha);
      }
    } else {
      warns.push('Sin fecha detectada en el bloque.');
    }

    if (p.autoconsumo && p.autoconsumo.length) {
      var ac = p.autoconsumo.length > col ? p.autoconsumo[col] : p.autoconsumo[0];
      $('#idAutoConsumo').val(String(ac));
      msgs.push('Autoconsumo: ' + ac + ' kg');
    }

    var diaSinVenta = false;
    if (p.totalLitros && p.totalLitros.length && p.totalLitros.every(function (x) { return x === 0; })) {
      diaSinVenta = true;
      for (var bi = 0; bi < p.bloques.length && bi < 4; bi++) {
        var secb = p.bloques[bi];
        for (var li = 0; li < secb.lineas.length; li++) {
          var lnv = valoresDeLinea(secb.lineas[li].nums, col);
          if (lnv && lnv.vol !== 0) { diaSinVenta = false; break; }
        }
        if (!diaSinVenta) break;
      }
    }

    if (diaSinVenta) {
      var fechaConfirmarDia = fecha || fechaActual || '(fecha no detectada)';
      var confirmadoDia = confirmarSinVenta(
        'El día ' + fechaConfirmarDia + ' no tuvo NINGUNA venta.\n\n¿Confirmas que no hubo venta?\nAceptar = marcar "Sin venta". Cancelar = no hacer cambios.'
      );
      if (confirmadoDia) {
        if (!$('#sinventaautotanquechk').is(':checked')) $('#sinventaautotanquechk').prop('checked', true).trigger('change');
        if (!$('#sinventarecipientechk').is(':checked')) $('#sinventarecipientechk').prop('checked', true).trigger('change');
        msgs.push('Día sin ventas: marcado "Sin venta".');
      } else {
        msgs.push('Día sin ventas NO confirmado.');
      }
      toast(msgs.concat(warns.map(function (w) { return 'Advertencia: ' + w; })));
      return;
    }

    var filasLlenadas = 0;
    var sumVol = 0;
    var sumImp = 0;
    var globalIdx = 0;
    for (var b = 0; b < p.bloques.length && b < 4; b++) {
      var sec = p.bloques[b];
      for (var l = 0; l < sec.lineas.length && globalIdx < ORDEN_FIJO.length; l++) {
        var linea = sec.lineas[l];
        var vals = valoresDeLinea(linea.nums, col);
        if (!vals) continue;
        var estado = sec.nombre || ORDEN_FIJO[globalIdx][0];
        var municipio = sec.municipio || ORDEN_FIJO[globalIdx][1];
        var sector = sectorDesdeCelda(linea.celdas) || ORDEN_FIJO[globalIdx][2];
        var fila = buscarFilaAT(estado, municipio, sector);
        if (!fila) { warns.push('Sin fila: ' + estado + ' / ' + municipio + ' / ' + sector); globalIdx++; continue; }
        var labelAT = estado + ' / ' + municipio + ' / ' + sector;
        var ok = await escribirYVerificarFila(fila, 'Volumen-' + fila.idVenta, 'ValorVenta-' + fila.idVenta, 'volumen', 'valorVenta', vals.vol, vals.imp, msgs, warns, labelAT);
        if (ok) { sumVol += vals.vol; sumImp += vals.imp; filasLlenadas++; }
        globalIdx++;
      }
    }

    if (filasLlenadas) {
      try { ObtieneTotalesRegistroVentaDDAC(); } catch (err) {}
      msgs.push('Auto-tanque: ' + filasLlenadas + ' filas llenadas');
    }
    if (p.totalLitros && p.totalLitros.length) {
      var tl = p.totalLitros.length > col ? p.totalLitros[col] : p.totalLitros[0];
      if (Math.abs(tl - sumVol) > 2) warns.push('Suma volúmenes (' + sumVol + ') ≠ total (' + tl + ').');
    }
    if (p.filaTotal && p.filaTotal.length === 2) {
      if (Math.abs(p.filaTotal[1] - sumImp) > 0.01) warns.push('Suma importes ≠ total.');
    }
    toast(msgs.concat(warns.map(function (w) { return 'Advertencia: ' + w; })));
  }

  /* ---- Llenar ES ---- */
  function pintarEstadoDia(fecha, colVenta) {
    $('#idFechaVenta').val(fecha);
    var esSinVenta = esDash(colVenta.vol) || aNumero(colVenta.vol) === 0;
    if (esSinVenta) {
      if (!$('#sinventachk').is(':checked')) $('#sinventachk').prop('checked', true).trigger('change');
      $('#idVolumenVehiculo').val('');
      $('#idVentasVehiculo').val('');
    } else {
      if ($('#sinventachk').is(':checked')) $('#sinventachk').prop('checked', false).trigger('change');
      pintarInput('idVolumenVehiculo', aNumero(colVenta.vol));
      pintarInput('idVentasVehiculo', aNumero(colVenta.imp));
    }
    if ($('#idAutoConsumo').val() !== '0') $('#idAutoConsumo').val('0');
  }

  function fechaYaRegistrada(fecha) {
    return new Promise(function (resolve) {
      $.ajax({
        url: '/GasLP/Ventas/GetValidaFechaVenta',
        type: 'POST',
        dataType: 'json',
        data: { strFechaVenta: fecha },
        success: function (d) { resolve(!(d.result === true && d.mensaje === '0')); },
        error: function () { resolve(false); }
      });
    });
  }

  function registrarDiaES(fecha, colVenta) {
    return new Promise(function (resolve) {
      var esSinVenta = esDash(colVenta.vol) || aNumero(colVenta.vol) === 0;
      var fechaRegCompra = moment(fecha, 'DD/MM/YYYY').format('YYYY-MM-DD');
      if (esSinVenta) {
        var cadenaCero = '|Fecha de Registro=' + $('#idFechaRegistro').val() + '|Fecha de Venta=' + fecha + '|Sin venta';
        $.ajax({
          url: '/GasLP/Ventas/GuardaCeroVentas',
          type: 'POST',
          dataType: 'json',
          data: { fechaRegCompra: fechaRegCompra, TipoVenta: 0, cadenaAcuse: cadenaCero },
          success: function (d) { resolve(d.result === true ? 'sin venta registrado' : 'ERROR: ' + (d.mensaje || 'respuesta inválida')); },
          error: function (xhr) { resolve(xhr.status === 401 ? 'ERROR: sesión expirada' : 'ERROR: fallo de red'); }
        });
        return;
      }
      var vol = aNumero(colVenta.vol);
      var imp = aNumero(colVenta.imp);
      var volTxt = formatNumber.new(vol, '');
      var impTxt = formatNumber.new(imp, '');
      var cadenaVenta = '|Fecha de Registro=' + $('#idFechaRegistro').val() + '|Fecha de Venta=' + fecha + '|Gas LP utilizado para consumos propios=0|Volumen Vendido a Vehiculo=' + volTxt + '|Valor de las Ventas a Vehiculos=' + impTxt;
      $.ajax({
        url: '/GasLP/Ventas/GuardaVentaEstacionServicio',
        type: 'POST',
        dataType: 'json',
        data: {
          fechaVenta: SetFormatFechaHora(fecha),
          fechaRegistro: GetFechaHoraBrowser(1),
          volumenV: volTxt, valorVentaV: impTxt,
          volumenR: '', valorVentaR: '', cantidadAutoConsumo: 0,
          cadenaAcuse: cadenaVenta
        },
        success: function (d) { resolve(d.success === true ? volTxt + ' l / $' + impTxt + ' registrado' : 'ERROR: ' + (d.mensaje || 'respuesta inválida')); },
        error: function (xhr) { resolve(xhr.status === 401 ? 'ERROR: sesión expirada' : 'ERROR: fallo de red'); }
      });
    });
  }

  async function fillES(texto, p) {
    var $ = ET.$;
    if ($('#ShowbtonsGuardar').is(':visible')) {
      toast(['Estás en confirmación. Pulsa "Regresar" y vuelve a pegar.']);
      return;
    }
    var total = Math.min(p.fechas.length, p.ventas.length);
    if (total === 0) { toast(['No se encontraron días en el bloque.']); return; }
    var resultados = [];
    for (var i = 0; i < total; i++) {
      var fecha = p.fechas[i];
      var colVenta = p.ventas[i];
      var yaRegistrada = await fechaYaRegistrada(fecha);
      if (yaRegistrada) { resultados.push(fecha + ': ya registrada, se omite'); continue; }
      if (esSinVentaColES(colVenta)) {
        var confirmado = confirmarSinVenta('El día ' + fecha + ' aparece SIN VENTA.\n¿Confirmas que no hubo venta?\nAceptar = registrar "Sin venta". Cancelar = omitir.');
        if (!confirmado) { resultados.push(fecha + ': omitido'); continue; }
      }
      toast(['Registrando día ' + (i + 1) + ' de ' + total + ': ' + fecha + '...']);
      pintarEstadoDia(fecha, colVenta);
      var resultado = await registrarDiaES(fecha, colVenta);
      resultados.push(fecha + ': ' + resultado);
      await sleep(800);
    }
    toast(['Registro completado.']);
    alert('Resumen (Estación de Servicio):\n\n' + resultados.join('\n') + '\n\nLa página se recargará.');
    location.reload();
  }

  function esSinVentaColES(colVenta) {
    return esDash(colVenta.vol) || aNumero(colVenta.vol) === 0;
  }

  /* ---- Paste handler ---- */
  function onPaste(e) {
    var cd = e.clipboardData || window.clipboardData;
    var texto = cd ? cd.getData('text/plain') : '';
    if (!texto || texto.indexOf('\t') < 0) return;
    var esDisPla = $('#idtblVentasEntidad').length > 0;
    var esES = !esDisPla && $('#idVolumenVehiculo').length > 0;
    if (esDisPla) {
      var p = parsear(texto);
      var lineasVenta = 0;
      p.bloques.forEach(function (b) { lineasVenta += b.lineas.length; });
      if (!p.fechas.length || lineasVenta < 4) return;
      e.preventDefault(); e.stopPropagation();
      llenar(texto, p);
      return;
    }
    if (esES) {
      var pe = parsearES(texto);
      if (pe.fechas.length < 5 || pe.ventas.length < 7) return;
      e.preventDefault(); e.stopPropagation();
      fillES(texto, pe);
    }
  }

  /* ---- Init / Destroy ---- */
  function init(et) {
    if (_destroyed) return;
    document.addEventListener('paste', onPaste, true);
    ET.utils.verboseLog('sales', { version: '1.5.0', status: 'init' });
  }

  function destroy() {
    _destroyed = true;
    document.removeEventListener('paste', onPaste, true);
  }

  /* ---- Registrar ---- */
  ET.register({
    name: 'sales',
    version: '1.5.0',
    init: init,
    destroy: destroy,
    css: css,
    api: {
      llenar: llenar,
      fillES: fillES,
      parsear: parsear,
      parsearES: parsearES
    }
  });

})(window.ET);
