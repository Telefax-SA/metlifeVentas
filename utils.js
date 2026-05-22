// === utils.js ===
// Shared utilities

// Retorna un objeto Date ajustado a UTC-3 (Montevideo/Buenos Aires) más un offset en segundos
function getNewDate(secondsToAdd = 10) {
  const ahora = new Date();
  
  // GMT-3 en milisegundos
  const offsetGMT3 = -3 * 60 * 60 * 1000;
  
  // Convertimos la hora local del navegador a UTC, luego le sumamos el offset de GMT-3
  // Y finalmente le sumamos los segundos extra solicitados
  const horaLocalMs = ahora.getTime();
  const localOffsetMs = ahora.getTimezoneOffset() * 60 * 1000; 
  
  // Hora UTC actual
  const utcMs = horaLocalMs + localOffsetMs;
  
  // Hora en GMT-3
  const gmt3Ms = utcMs + offsetGMT3;
  
  // Le sumamos los segundos
  const finalMs = gmt3Ms + (secondsToAdd * 1000);
  
  return new Date(finalMs).toISOString();
}

function getIntervalLast30Days() {
  const now = new Date();                 
  const past = new Date();                 
  past.setDate(now.getDate() - 30);        

  const nowIso = now.toISOString();
  const pastIso = past.toISOString();

  return `${pastIso}/${nowIso}`;
}

// Funciones Helper para SweetAlert2
function showToast(icon, title) {
  if (typeof Swal !== 'undefined') {
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      }
    });

    Toast.fire({
      icon: icon, // 'success', 'error', 'warning', 'info', 'question'
      title: title
    });
  } else {
    // Fallback nativo
    alert(title);
  }
}

function showAlert(icon, title, text) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: icon,
      title: title,
      text: text,
      confirmButtonColor: '#008EDD'
    });
  } else {
    // Fallback nativo
    alert(`${title}\n${text || ''}`);
  }
}

async function showConfirm(title, text, confirmText = 'Sí, continuar', cancelText = 'Cancelar') {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: title,
      text: text,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText
    });
    return result.isConfirmed;
  } else {
    // Fallback nativo
    return confirm(`${title}\n${text || ''}`);
  }
}

function showLoading(title = 'Cargando...') {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: title,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading()
      }
    });
  }
}

function closeLoading() {
  if (typeof Swal !== 'undefined') {
    Swal.close();
  }
}
