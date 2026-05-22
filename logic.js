// === CONFIGURACIÓN ===
const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;

async function getCallbacks(userId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    showAlert('warning', 'Sesión expirada', 'Primero debes iniciar sesión.');
    return;
  }

  showLoading('Cargando callbacks...');

  const body = {
    order: 'desc',
    orderBy: 'conversationStart',
    paging: { pageNumber: 1, pageSize: 10 },
    interval: getIntervalLast30Days(),
    segmentFilters: [
      {
        type: 'and',
        predicates: [
          { dimension: 'mediaType', value: 'callback' },
          { dimension: 'segmentType', value: 'Scheduled' },
          { dimension: 'segmentEnd', operator: 'notExists' }
        ]
      }
    ]
  };

  if (userId) {
    body.segmentFilters.push({
      type: 'or',
      predicates: [
        { dimension: 'scoredAgentId', value: userId }
      ]
    });
  }

  try {
    const res = await fetch(`https://api.${REGION}/api/v2/analytics/conversations/details/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Error HTTP: ${res.status}`);
    }

    const data = await res.json();
    await buildTable(data.conversations || []);
  } catch (error) {
    console.error('Error fetching callbacks:', error);
    showAlert('error', 'Error', 'No se pudieron cargar los callbacks.');
  } finally {
    closeLoading();
  }
}

async function buildTable(callbacks) {
  const token = localStorage.getItem('access_token');
  const output = document.getElementById('output');
  if (!callbacks.length) {
    output.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--color-text-muted);">No hay callbacks activos.</div>';
    return;
  }

  const rows = await Promise.all(callbacks.map(async cb => {
    const startDate = new Date(cb.conversationStart).toLocaleString('es-UY');
    const agents = cb.participants?.filter(p => p.purpose === "agent") || [];
    const contact = agents[agents.length - 1] || {};
    
    // Safety check for contact.sessions
    const sessions = contact.sessions || [];
    const validSessions = sessions
        .filter(s => s.callbackScheduledTime)
        .sort((a, b) => new Date(a.callbackScheduledTime) - new Date(b.callbackScheduledTime)); 

    const phones = validSessions.length > 0 && validSessions[0].callbackNumbers?.[0] 
      ? validSessions[0].callbackNumbers[0] 
      : "N/A";

    const date = validSessions.length > 0 && validSessions[0].callbackScheduledTime
      ? new Date(validSessions[0].callbackScheduledTime).toLocaleString('es-UY')
      : "N/A";

    const contactName = validSessions.length > 0 && validSessions[0].callbackUserName
      ? validSessions[0].callbackUserName 
      : "Sin nombre";

    const participantId = getAgentParticipantId(cb);
    const communicationId = getLastAgentSessionId(cb);

    let campaing = "Sin nombre";
    if (sessions.length > 0 && sessions[0].outboundCampaignId) {
      campaing = await getCampaignName(sessions[0].outboundCampaignId, token) || "Sin nombre";
    }

    let wrapups = obtenerWrapupsDeAgentes(cb.participants);
    wrapups = await resolveWrapupObjects(wrapups, token); 

    let queue = "-";
    if (sessions.length > 0 && sessions[0].segments && sessions[0].segments.length > 0 && sessions[0].segments[0].queueId) {
      queue = await getQueueName(sessions[0].segments[0].queueId, token);
    }
    
    const wrapup_code = wrapups.map(w => w.wrapUpCode ?? "-").join(", ");
    const notes = wrapups.map(w => w.wrapUpNote ?? "-").join(", ");

    return [
      contactName,
      startDate,
      phones,
      date,
      campaing,
      queue,
      wrapup_code,
      notes,
      gridjs.html(`
      <div style="position: relative;">
        <button class="btn-update"
          onclick="abrirPopup('${cb.conversationId}', event)" 
          data-participant-id="${participantId}" 
          data-communication-id="${communicationId}"
          style="padding: 6px 10px; min-width: auto;">
          ⋮
        </button>
        <span id="timer-${cb.conversationId}" style="margin-left: 10px; font-weight: bold; font-size: 0.8rem; color: var(--color-primary);"></span>
      </div>
    `)
    ];
  }));

  if (window.gridInstance) {
    window.gridInstance.destroy();
  }

  output.innerHTML = '';
  window.gridInstance = new gridjs.Grid({
    columns: ["Nombre", "Start Date", "Teléfono", "Hora de inicio", "Campaña", "Cola", "Tipificacion", "Notas", "Acción"],
    data: rows,
    search: {
      placeholder: 'Buscar callback...'
    },
    sort: true,
    resizable : true,
    fixedHeader: true,
    pagination: {
      enabled: true,
      limit: 10
    },
    language: {
      search: { placeholder: 'Buscar...' },
      pagination: { previous: 'Ant', next: 'Sig', showing: 'Mostrando', results: () => 'registros' }
    }
  }).render(output);
}

function obtenerWrapupsDeAgentes(participants) {
  const wrapups = [];
  if (!participants || !Array.isArray(participants)) return wrapups;

  participants.forEach(participant => {
    if (participant.purpose === "agent") {
      const sessions = participant.sessions || [];
      sessions.forEach(session => {
        const segments = session.segments || [];
        segments.forEach(segment => {
          if (segment.segmentType === "wrapup") {
            const code = segment.wrapUpCode || null;
            const note = segment.wrapUpNote || null;
            if (code || note) {
              wrapups.push({ wrapUpCode: code, wrapUpNote: note });
            }
          }
        });
      });
    }
  });
  return wrapups;
}

async function reprogramar(conversationId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    showAlert('warning', 'No autenticado', 'Debes iniciar sesión.');
    return;
  }

  const nuevaFecha = getNewDate(10); // Utils.js
	const popup = document.querySelector('.popup-menu');
  const button = popup?.querySelector('button:nth-child(1)'); 

  if (button) {
    button.disabled = true;
    button.textContent = "Reprogramando...";
  }

  const timerSpan = document.getElementById(`timer-${conversationId}`);

  try {
    const res = await fetch(`https://api.${REGION}/api/v2/conversations/callbacks/`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversationId: conversationId,
        callbackScheduledTime: nuevaFecha 
      })
    });

    if (res.ok) {
      showToast('success', `Reprogramado para ${new Date(nuevaFecha).toLocaleString('es-UY')}`);
      if (timerSpan && button) {
        iniciarTemporizador(timerSpan, button);
      }
    } else {
      const error = await res.json();
      console.error('Error reprogramando:', error);
      showAlert('error', 'Error', 'No se pudo reprogramar el callback.');
      if (button) {
        button.disabled = false;
        button.textContent = "Reprogramar";
      }
    }
  } catch (e) {
    console.error('Network Error:', e);
    showAlert('error', 'Error de Red', 'Fallo de conexión.');
  }
}

function iniciarTemporizador(timerElement, button) {
  let segundos = 120;
  timerElement.textContent = `⏳ 120s`;

  const intervalo = setInterval(() => {
    segundos--;
    timerElement.textContent = `⏳ ${segundos}s`;

    if (segundos <= 0) {
      clearInterval(intervalo);
      timerElement.textContent = "";
      if (button) {
        button.disabled = false;
        button.textContent = "Reprogramar";
      }
    }
  }, 1000);
}

async function resolveWrapupObjects(wrapupObjects, accessToken) {
  const cache = new Map();
  const isId = (code) => /^[a-zA-Z0-9\-]{8,}$/.test(code);

  return await Promise.all(
    wrapupObjects.map(async ({ wrapUpCode, wrapUpNote }) => {
      if (!isId(wrapUpCode)) {
        return { wrapUpCode, wrapUpNote };
      }

      if (cache.has(wrapUpCode)) {
        return { wrapUpCode: cache.get(wrapUpCode), wrapUpNote };
      }

      try {
        const response = await fetch(`https://api.${REGION}/api/v2/routing/wrapupcodes/${wrapUpCode}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const name = data.name || wrapUpCode;

        cache.set(wrapUpCode, name);
        return { wrapUpCode: name, wrapUpNote };
      } catch (error) {
        cache.set(wrapUpCode, wrapUpCode); 
        return { wrapUpCode, wrapUpNote };
      }
    })
  );
}

async function getQueueName(queueId, accessToken) {
  const url = `https://api.${REGION}/api/v2/routing/queues/${encodeURIComponent(queueId)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) return "Desconocida";
    const data = await response.json();
    return data.name;
  } catch (e) {
    return "Desconocida";
  }
}

async function getCampaignName(campaignId, accessToken) {
  const url = `https://api.${REGION}/api/v2/outbound/campaigns/divisionviews/${encodeURIComponent(campaignId)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) return "Desconocida";
    const data = await response.json();
    return data.name;
  } catch (e) {
    return "Desconocida";
  }
}

async function obtenerMiPerfil() {
  const token = localStorage.getItem('access_token');
  const response = await fetch(`https://api.${REGION}/api/v2/users/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  return data.id; 
}

function abrirPopup(conversationId, event) {
  document.querySelectorAll('.popup-menu').forEach(p => p.remove());
  const button = event.currentTarget;
  const participantId = button.getAttribute("data-participant-id");
  const communicationId = button.getAttribute("data-communication-id");

  const popup = document.createElement('div');
  popup.className = 'popup-menu';
  popup.innerHTML = `
    <button onclick="reprogramar('${conversationId}')">⏱️ Reprogramar (+10s)</button>
    <button onclick="abrirModalEdit('${conversationId}')">✏️ Editar Fecha</button>
    <div style="height: 1px; background: var(--border-color); margin: 4px 0;"></div>
    <button onclick="confirmarCancelacion('${conversationId}', '${participantId}', '${communicationId}')" style="color: var(--color-text-error);">❌ Cancelar Callback</button>
  `;

  document.body.appendChild(popup);

  const rect = event.currentTarget.getBoundingClientRect();
  const popupWidth = 180;
  const popupHeight = 140;

  let left = rect.left + window.scrollX - popupWidth + rect.width;
  let top = rect.bottom + window.scrollY + 5;

  if (left < 0) left = 10;
  if (top + popupHeight > window.scrollY + window.innerHeight) {
    top = rect.top + window.scrollY - popupHeight - 5;
  }

  popup.style.position = 'absolute';
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  requestAnimationFrame(() => popup.classList.add('show'));

  const handleClickOutside = (e) => {
    if (!popup.contains(e.target) && e.target !== event.currentTarget) {
      popup.remove();
      document.removeEventListener('click', handleClickOutside);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 0);
}

async function cancelarCallback(conversationId, participantId, communicationId) {
  const token = localStorage.getItem("access_token");
  if (!token) return;

  const url = `https://api.sae1.pure.cloud/api/v2/conversations/callbacks/${conversationId}/participants/${participantId}/communications/${communicationId}`;
  
  try {
    showLoading('Cancelando...');
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ state: "disconnected" })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    showToast('success', 'Callback cancelado correctamente.');
    
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('userId');
    if (!userId) {
      userId = await obtenerMiPerfil();
    }
    getCallbacks(userId);

  } catch (err) {
    console.error("Error cancelando callback:", err);
    showAlert('error', 'Error', 'Hubo un error al cancelar el callback.');
  } finally {
    closeLoading();
  }
}

async function confirmarCancelacion(conversationId, participantId, communicationId) {
  document.querySelectorAll('.popup-menu').forEach(p => p.remove());
  const confirmed = await showConfirm(
    '¿Cancelar Callback?', 
    'Esta acción marcará el callback como desconectado y no se podrá recuperar.',
    'Sí, cancelar',
    'Mantener'
  );

  if (confirmed) {
    cancelarCallback(conversationId, participantId, communicationId);
  }
}

function abrirModalEdit(conversationId) {
  document.querySelectorAll('.popup-menu').forEach(p => p.remove());

  Swal.fire({
    title: 'Editar Callback',
    html: `<input type="text" id="swal-calendar-${conversationId}" class="swal2-input" placeholder="Elegir nueva fecha">`,
    showCancelButton: true,
    confirmButtonText: 'Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#008EDD',
    didOpen: () => {
      flatpickr(`#swal-calendar-${conversationId}`, {
        enableTime: true,
        dateFormat: "Y-m-d\\TH:i:S\\Z",
        defaultDate: new Date(),
        time_24hr: true
      });
    },
    preConfirm: () => {
      const input = document.getElementById(`swal-calendar-${conversationId}`);
      if (!input.value) {
        Swal.showValidationMessage('Debes seleccionar una fecha');
      }
      return input.value;
    }
  }).then((result) => {
    if (result.isConfirmed) {
      reprogramarDatePicker(conversationId, result.value);
    }
  });
}

async function reprogramarDatePicker(conversationId, nuevaFecha) {
  const token = localStorage.getItem('access_token');
  if (!token) return;

  try {
    showLoading('Guardando...');
    const res = await fetch(`https://api.${REGION}/api/v2/conversations/callbacks/`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversationId: conversationId,
        callbackScheduledTime: nuevaFecha
      })
    });

    if (res.ok) {
      showToast('success', 'Callback actualizado');
      const urlParams = new URLSearchParams(window.location.search);
      let userId = urlParams.get('userId');
      if (!userId) {
        userId = await obtenerMiPerfil();
      }
      getCallbacks(userId);
    } else {
      throw new Error('Fallo la reprogramación');
    }
  } catch (err) {
    showAlert('error', 'Error', 'No se pudo guardar la nueva fecha.');
  } finally {
    closeLoading();
  }
}

function getAgentParticipantId(conv) {
  const participant = conv.participants?.find(p => p.purpose === "agent");
  return participant ? participant.participantId : null; 
}

function getLastAgentSessionId(conv) {
  const participant = conv.participants?.find(p => p.purpose === "agent");
  if (participant && Array.isArray(participant.sessions) && participant.sessions.length > 0) {
    const lastSession = participant.sessions[participant.sessions.length - 1];
    return lastSession.sessionId;
  }
  return null;
}

// === INICIALIZACIÓN ===
(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    try {
      showLoading('Iniciando sesión...');
      await exchangeCodeForToken(code, CLIENT_ID, REGION, REDIRECT_URI);
      history.replaceState(null, '', REDIRECT_URI);
      showToast('success', 'Sesión iniciada correctamente');
    } catch (err) {
      closeLoading();
      showAlert('error', 'Error en login', err.message);
      return;
    }
  }

  if (!localStorage.getItem('access_token')) {
    const loginUrl = await getLoginUrl(CLIENT_ID, REGION, REDIRECT_URI);
    window.location.href = loginUrl;
    return;
  }

  let userId = urlParams.get('userId');
  if (!userId) {
    try {
      userId = await obtenerMiPerfil();
    } catch(e) {
      console.error("No se pudo obtener el perfil", e);
    }
  }
  
  if(userId) {
    getCallbacks(userId);
  }
})();
