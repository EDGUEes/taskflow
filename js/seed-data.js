/* ============================================================
   TASKFLOW — DATOS DE EJEMPLO (demo)
   Procesos ficticios y genéricos de una empresa de ejemplo: "Acme Servicios S.A."
   Todos los nombres, montos, proveedores y datos son inventados.
   Los procesos son típicos de cualquier oficina administrativa y no
   reflejan los de ninguna organización real.
   ============================================================ */

/* ===== MINI-MANUALES (Guías consultables) =====
   Procesos largos que se consultan cuando hacen falta.
   Pasos reordenables, con notas y casos especiales. */
const GUIDES_SEED = [
  {
    id: 'guide-factura',
    emoji: '🧾',
    name: 'Procesar una factura de proveedor',
    category: 'Compras',
    color: 'violet',
    steps: [
      { text: 'Verificar que la factura esté completa y legible', note: '' },
      { text: 'Crear la solicitud de pago en el sistema', note: '' },
      { text: 'Copiar una solicitud parecida del historial', note: 'Ahorra tiempo' },
      { text: 'Revisar y borrar los datos heredados que no apliquen', note: '⚠️ Revisar siempre al copiar' },
      { text: 'Completar los datos de la factura', note: '' },
      { text: 'Imprimir la solicitud y el comprobante de recepción', note: '' },
      { text: 'Firmar y sellar los documentos', note: '' },
      { text: 'Anotar la clasificación del gasto', note: 'Se consulta en la tabla de clasificaciones' },
      { text: 'Pasar al responsable para su revisión y firma', note: '' },
      { text: 'Obtener el visto bueno final', note: '' },
      { text: 'Registrar el pago y archivar', note: '' },
      { text: 'Entregar el comprobante a quien corresponda', note: '' },
    ],
    cases: [
      { title: 'Pago por transferencia', body: 'Adjuntar el comprobante de la transferencia a la solicitud.' },
      { title: 'Pago en efectivo', body: 'Pedir el recibo firmado por el proveedor y guardarlo junto con la factura.' },
      { title: 'Servicios recurrentes', body: 'Los servicios fijos (internet, telefonía, alquiler de equipo) pueden usar una misma aprobación vigente.' },
      { title: 'Si es alimentación', body: 'Adjuntar el listado de asistentes.' },
      { title: 'Si son servicios', body: 'Adjuntar un informe de lo realizado.' },
      { title: 'Si son bienes', body: 'Adjuntar el listado de entrega y la constancia de recepción.' },
      { title: 'Datos de la empresa (ejemplo)', body: 'Acme Servicios S.A. · Calle Ficticia 123, Ciudad Ejemplo' },
    ],
  },
  {
    id: 'guide-activo',
    emoji: '📦',
    name: 'Registrar un activo fijo',
    category: 'Inventario',
    color: 'blue',
    steps: [
      { text: 'Reunir la factura de compra del bien', note: '' },
      { text: 'Registrar el bien en el módulo de inventario', note: 'Descripción completa y detallada' },
      { text: 'Revisar dos veces antes de guardar', note: '⚠️ Corregir después es más complicado' },
      { text: 'Obtener la aprobación del responsable', note: '📝 Anotar el código generado' },
      { text: 'Generar el comprobante de ingreso', note: '' },
      { text: 'Asignar el bien a quien lo usará', note: '' },
      { text: 'Imprimir la etiqueta con el código y pegarla al bien', note: '' },
      { text: 'Tomar fotos y adjuntarlas al expediente', note: '' },
      { text: 'Actualizar la hoja de inventario', note: 'Código completo y descripción' },
      { text: 'Imprimir la hoja de asignación y recoger la firma', note: '' },
    ],
    cases: [
      { title: '¿Qué cuenta como activo fijo?', body: 'Equipo de cómputo, mobiliario y herramientas con vida útil mayor a un año.' },
    ],
  },
  {
    id: 'guide-ordenes',
    emoji: '📋',
    name: 'Cierre semanal de órdenes de compra',
    category: 'Compras',
    color: 'green',
    steps: [
      { text: 'Preguntar al equipo si ya entregó todas sus facturas', note: '' },
      { text: 'Generar las órdenes y actualizar los libros de registro', note: 'Cada uno con su correlativo' },
      { text: 'Pasar al responsable para su revisión', note: '' },
      { text: 'Con el visto bueno, imprimir', note: '' },
      { text: 'Recoger las firmas', note: '' },
      { text: 'Obtener la aprobación final', note: '' },
      { text: 'Archivar y adjuntar la copia al expediente', note: '' },
    ],
    cases: [
      { title: 'Ciclo semanal', body: 'Un recordatorio al inicio de la semana, recolección de facturas a mitad de semana, generación de órdenes al final y archivo al comenzar la siguiente.' },
      { title: 'Libro de registro', body: 'Se imprime una vez por semana con el número correlativo de cada orden.' },
    ],
  },
  {
    id: 'guide-deposito',
    emoji: '🏦',
    name: 'Preparar depósitos',
    category: 'Tesorería',
    color: 'amber',
    steps: [
      { text: 'Identificar el tipo de depósito', note: '' },
      { text: 'Reunir la documentación que corresponda', note: 'Varía según el caso, ver los casos especiales' },
      { text: 'Endosar solo cuando aplique', note: '' },
      { text: 'Separar los cheques por banco', note: '' },
      { text: 'Enviar a depositar y esperar las boletas', note: '' },
      { text: 'Anotar el número de boleta y la fecha en el control', note: '' },
    ],
    cases: [
      { title: 'Cliente A', body: 'Se envía con las facturas originales. No se endosa.' },
      { title: 'Cliente B', body: 'Se adjunta la constancia correspondiente.' },
      { title: 'Cliente C', body: 'Se prepara un resumen que acompaña la documentación.' },
    ],
  },
  {
    id: 'guide-conciliacion',
    emoji: '🔄',
    name: 'Conciliación bancaria mensual',
    category: 'Tesorería',
    color: 'blue',
    steps: [
      { text: 'Descargar el estado de cuenta del mes', note: '' },
      { text: 'Cruzar los movimientos contra el libro de bancos', note: '' },
      { text: 'Marcar las partidas conciliadas', note: '' },
      { text: 'Listar las partidas en tránsito', note: 'Cheques no cobrados, depósitos no acreditados' },
      { text: 'Investigar las diferencias', note: '' },
      { text: 'Elaborar el reporte de conciliación', note: '' },
      { text: 'Pasar al responsable para su revisión y firma', note: '' },
      { text: 'Archivar con el estado de cuenta adjunto', note: '' },
    ],
    cases: [
      { title: 'Si no cuadra', body: 'Revisar primero las partidas del último día del mes y las comisiones bancarias no registradas.' },
    ],
  },
  {
    id: 'guide-caja',
    emoji: '💵',
    name: 'Manejo de caja chica',
    category: 'Tesorería',
    color: 'green',
    steps: [
      { text: 'Recibir el efectivo con su recibo provisional', note: '' },
      { text: 'Registrar el ingreso en la hoja de control', note: 'Quién pagó, documento y número' },
      { text: 'Enviar a depositar', note: '' },
      { text: 'Esperar que se acredite en el banco', note: '' },
      { text: 'Emitir el recibo definitivo', note: '' },
      { text: 'Entregar el original a quien pagó', note: '' },
    ],
    cases: [
      { title: 'Control de duplicados', body: 'Antes de emitir, verificar en la hoja de control que esa persona no haya pagado antes en el mismo período.' },
    ],
  },
  {
    id: 'guide-reportes',
    emoji: '📊',
    name: 'Reportes de cierre de mes',
    category: 'Administración',
    color: 'violet',
    steps: [
      { text: 'Generar el libro de registro del mes', note: '' },
      { text: 'Exportar el detalle de consumibles', note: '' },
      { text: 'Exportar el detalle de activos', note: '' },
      { text: 'Enviar los archivos al responsable', note: '' },
      { text: 'Enviar el reporte de documentos emitidos y anulados', note: 'Recibos y órdenes de compra' },
    ],
    cases: [
      { title: 'Cuándo se envía', body: 'Un avance a mitad de mes y el consolidado al cierre.' },
    ],
  },
];

/* ===== TAREAS DE EJEMPLO ===== */
function buildSeedTasks(uid, today) {
  return [
    /* ---------- DIARIA ---------- */
    {
      name: 'Revisar correo y pendientes del día',
      templateKey: 'revision', recurrence: 'daily', priority: 'high', notifTime: '08:00',
      guided: { what: 'Correo, notificaciones y documentos por procesar' },
      guideRef: 'guide-caja',
      checklist: [
        'Revisar el correo',
        'Ver si hay notificaciones de pago',
        'Si hay pagos nuevos, guardar el comprobante',
        'Registrar en el sistema',
        'Actualizar la hoja de control',
      ],
    },

    /* ---------- SEMANALES (cadena conectada) ---------- */
    {
      name: 'Recordar al equipo que envíe sus facturas',
      templateKey: 'aviso', recurrence: 'weekly', weekDays: [2], priority: 'medium', notifTime: '09:00',
      guided: { who: 'Grupo de coordinación interna', what: 'Recordar que pronto se recolectan las facturas' },
      connectNote: '➡️ Prepara la recolección',
      checklist: ['Enviar el recordatorio al grupo', 'Confirmar quién tiene pendientes'],
    },
    {
      name: 'Recolectar las facturas del equipo',
      templateKey: 'blank', recurrence: 'weekly', weekDays: [3], priority: 'high', notifTime: '09:00',
      guided: { what: 'Reunir las facturas de la semana' },
      connectNote: '⬅️ Viene del recordatorio · ➡️ Alimenta las órdenes de compra',
      checklist: ['Recolectar las facturas', 'Revisar que estén completas', 'Las que lleguen tarde pasan a la semana siguiente'],
    },
    {
      name: 'Generar las órdenes de compra de la semana',
      templateKey: 'ordenes', recurrence: 'weekly', weekDays: [4], priority: 'high', notifTime: '08:30',
      guideRef: 'guide-ordenes',
      guided: { what: 'Órdenes y actualización de libros de registro' },
      connectNote: '⬅️ Usa las facturas recolectadas · ➡️ Se imprimen y se firman después',
      checklist: ['Generar las órdenes en el sistema', 'Actualizar los libros de registro', 'Enviar al responsable para revisión'],
    },
    {
      name: 'Imprimir las órdenes y recoger firmas',
      templateKey: 'blank', recurrence: 'weekly', weekDays: [5], priority: 'high', notifTime: '08:30',
      guideRef: 'guide-ordenes',
      connectNote: '⬅️ Continúa el cierre de las órdenes',
      checklist: ['Imprimir las órdenes aprobadas', 'Recoger las firmas', 'Obtener la aprobación final', 'Archivar'],
    },
    {
      name: 'Preparar los depósitos',
      templateKey: 'blank', recurrence: 'weekly', weekDays: [1], priority: 'high', notifTime: '10:00',
      guideRef: 'guide-deposito',
      checklist: ['Avisar a los clientes que pueden recoger sus documentos', 'Preparar los depósitos', 'Endosar lo que aplique', 'Separar por banco', 'Resguardar'],
    },

    /* ---------- QUINCENAL ---------- */
    {
      name: 'Revisar servicios y suscripciones recurrentes',
      templateKey: 'blank', recurrence: 'biweekly', biweeklyMode: '15-fin', priority: 'medium', notifTime: '09:00',
      guided: { what: 'Proveedores de servicios recurrentes' },
      checklist: ['Solicitar la factura', 'Revisar que corresponda al período', 'Pasar a proceso de pago'],
    },

    /* ---------- MENSUALES ---------- */
    {
      name: 'Enviar reportes de cierre de mes',
      templateKey: 'blank', recurrence: 'monthly', monthDay: 26, priority: 'high', notifTime: '09:00',
      guideRef: 'guide-reportes',
      checklist: ['Libro de registro', 'Detalle de consumibles', 'Detalle de activos', 'Documentos emitidos y anulados', 'Enviar al responsable'],
    },
    {
      name: 'Conciliación bancaria del mes',
      templateKey: 'blank', recurrence: 'monthly', monthDay: 4, priority: 'high', notifTime: '09:00',
      guideRef: 'guide-conciliacion',
      checklist: ['Descargar el estado de cuenta', 'Cruzar contra el libro de bancos', 'Listar las partidas en tránsito', 'Elaborar el reporte', 'Pasar a revisión'],
    },
    {
      name: 'Registrar los ingresos del mes',
      templateKey: 'blank', recurrence: 'monthly', monthDay: 2, priority: 'medium', notifTime: '09:00',
      checklist: ['Elaborar el recibo en el sistema', 'Enviar a firmar', 'Registrar el ingreso'],
    },

    /* ---------- CADA CUATRO MESES ---------- */
    {
      name: 'Revisar contratos de servicios con proveedores',
      templateKey: 'blank', recurrence: 'fourmonths', priority: 'low', notifTime: '10:00',
      guided: { notes: 'Contratos de internet, telefonía y mantenimiento' },
      checklist: ['Listar los contratos vigentes', 'Comparar precios', 'Decidir si se renueva o se cambia'],
    },

    /* ---------- SEGUIMIENTO ---------- */
    {
      name: 'Seguimiento de inventario físico',
      templateKey: 'blank', recurrence: 'daily', priority: 'medium', notifTime: '08:00',
      guideRef: 'guide-activo',
      checklist: ['Verificar los bienes asignados', 'Anotar diferencias'],
    },
    {
      name: 'Completar las firmas pendientes',
      templateKey: 'blank', recurrence: 'custom', priority: 'high', notifTime: '08:00',
      checklist: ['Reunir los documentos', 'Conseguir las firmas faltantes'],
    },
  ];
}
