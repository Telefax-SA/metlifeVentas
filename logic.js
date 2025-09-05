// === CONFIGURACIÓN ===
const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;

let codeVerifier = localStorage.getItem('code_verifier');

async function login() {
	codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);

	localStorage.setItem('code_verifier', codeVerifier);

	const url = `https://login.${REGION}/oauth/authorize?` +
		`client_id=${CLIENT_ID}` +
		`&response_type=code` +
		`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
		`&code_challenge=${codeChallenge}` +
		`&code_challenge_method=S256` +
		`&state=xyz`;

	window.location.href = url;
}

async function exchangeCodeForToken(code) {
	const body = new URLSearchParams();
	body.append('grant_type', 'authorization_code');
	body.append('client_id', CLIENT_ID);
	body.append('code', code);
	body.append('redirect_uri', REDIRECT_URI);
	body.append('code_verifier', codeVerifier);

	const response = await fetch(`https://login.${REGION}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});

	const data = await response.json();
	if (data.access_token) {
		localStorage.setItem('access_token', data.access_token);
		return data.access_token;
	} else {
		throw new Error('Error al obtener access token: ' + JSON.stringify(data));
	}
}

async function getCallbacks(userId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    alert('Primero debes iniciar sesión.');
    return;
  }

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

  const res = await fetch(`https://api.${REGION}/api/v2/analytics/conversations/details/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  await buildTable(data.conversations || []);
}

async function buildTable(callbacks) {
  const token = localStorage.getItem('access_token');
  const output = document.getElementById('output');
  if (!callbacks.length) {
    output.innerHTML = 'No hay callbacks activos.';
    return;
  }

  const rows = await Promise.all(callbacks.map(async cb => {
    const startDate = cb.conversationStart;
    const agents = cb.participants?.filter(p => p.purpose === "agent") || [];
    const contact = agents[agents.length - 1] || {};
    

    const validSessions = contact.sessions
        .filter(s => s.callbackScheduledTime)  // Solo sesiones con callback programado
        .sort((a, b) => new Date(a.callbackScheduledTime) - new Date(b.callbackScheduledTime)); // De más vieja a más nueva

    const phones = validSessions.length > 0 && validSessions[0].callbackNumbers?.[0] 
      ? validSessions[0].callbackNumbers[0] 
      : "N/A";


    const date = validSessions.length > 0 && validSessions[0].callbackScheduledTime
      ? validSessions[0].callbackScheduledTime
      : "N/A";

    const contactName = validSessions.length > 0 && validSessions[0]
    ?  validSessions[0].callbackUserName 
    : "Sin nombre";

    const participantId = getAgentParticipantId(cb);
    const communicationId = getLastAgentSessionId(cb);

    const campaing = await getCampaignName(contact.sessions[0].outboundCampaignId, token) || "Sin nombre";
    let wrapups = obtenerWrapupsDeAgentes(cb.participants)
    console.log(wrapups);
    wrapups = await resolveWrapupObjects(wrapups, token); // cambia los id por los nombres
    const queue = await getQueueName(contact.sessions[0].segments[0].queueId, token);
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
        <button 
          onclick="abrirPopup('${cb.conversationId}', event)" 
          data-participant-id="${participantId}" 
          data-communication-id="${communicationId}">
          ⋮
        </button>
        <span id="timer-${cb.conversationId}" style="margin-left: 10px; font-weight: bold;"></span>
      </div>
    `)


    ];
  }));

  // Destruir tabla anterior si existe
  if (window.gridInstance) {
    window.gridInstance.destroy();
  }

  // Crear nueva tabla
  window.gridInstance = new gridjs.Grid({
    columns: ["Nombre", "Start Date","Teléfono", "Hora de inicio", "Campaña", "Cola", "Tipificacion", "Notas","Acción"],
    data: rows,
    search: true,
    sort: true,
    resizable : true,
    fixedHeader: true,
    pagination: {
      enabled: true,
      limit: 10
    },
    style: {
      td: { padding: "10px" },
      th: { padding: "10px", backgroundColor: "#f0f0f0" }
    }
  }).render(output);
}

function obtenerWrapupsDeAgentes(participants) {
  const wrapups = [];
  if (!participants || !Array.isArray(participants)) {
    return wrapups;
  }

  participants.forEach((participant, i) => {

    if (participant.purpose === "agent") {
      const sessions = participant.sessions || [];
      sessions.forEach((session, j) => {
        const segments = session.segments || [];
        segments.forEach((segment, k) => {
        if (segment.segmentType === "wrapup"){
          const code = segment.wrapUpCode || null;
          const note = segment.wrapUpNote || null;

          if (code || note) {
            wrapups.push({
              wrapUpCode: code,
              wrapUpNote: note
            });
          }
        }});
      });
    }
  });


  return wrapups;
}

async function reprogramar(conversationId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    alert('Debes iniciar sesión.');
    return;
  }

  const nuevaFecha = getNewDate();
	const popup = document.querySelector('.popup-menu');
  const button = popup?.querySelector('button:nth-child(1)'); // Primer botón: Reprogramar

  if (button) {
    button.disabled = true;
    button.textContent = "Reprogramando...";
  }

  const timerSpan = document.getElementById(`timer-${conversationId}`);

  button.disabled = true;
  button.textContent = "Reprogramando...";
  const res = await fetch(`https://api.${REGION}/api/v2/conversations/callbacks/`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
			conversationId:conversationId,
			callbackScheduledTime: nuevaFecha 
		})
  });

  if (res.ok) {
    alert(`Callback reprogramado para ${nuevaFecha}`);
		iniciarTemporizador(timerSpan, button);
  } else {
    const error = await res.json();
    console.error('Error reprogramando:', error);
    alert('Error reprogramando el callback.');
  }
}

function getNewDate() {
  const ahora = new Date();
  // Convertir a equivalente de Montevideo (GMT-3)
  const offsetUruguayEnMs = -3 * 60 * 60 * 1000;
  const horaMontevideo = new Date(ahora.getTime()+offsetUruguayEnMs);
  const nuevaHoraMontevideo = new Date(horaMontevideo.getTime() + 10 * 1000);

  return nuevaHoraMontevideo.toISOString();
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
      button.disabled = false;
      button.textContent = "Reprogramar";
    }
  }, 1000);
}

async function resolveWrapupObjects(wrapupObjects, accessToken) {
  const cache = new Map();
  const isId = (code) => /^[a-zA-Z0-9\-]{8,}$/.test(code);

  const resolved = await Promise.all(
    wrapupObjects.map(async ({ wrapUpCode, wrapUpNote }) => {
      if (!isId(wrapUpCode)) {
        console.warn("no es un ID ");
        return { wrapUpCode, wrapUpNote };
      }

      if (cache.has(wrapUpCode)) {
        console.warn("ID en cache ");
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

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const name = data.name || wrapUpCode;

        console.log("ACAA:: "+JSON.stringify({ wrapUpCode: name, wrapUpNote }))
        cache.set(wrapUpCode, name);
        return { wrapUpCode: name, wrapUpNote };
      } catch (error) {
        console.error(`Error fetching wrapUpCode "${wrapUpCode}":`, error.message);
        cache.set(wrapUpCode, wrapUpCode); 
        return { wrapUpCode, wrapUpNote };
      }
    })
  );

  return resolved;
}

async function getQueueName(queueId, accessToken) {
  const url = `https://api.${REGION}/api/v2/routing/queues/${encodeURIComponent(queueId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error al obtener la cola: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.name;
}

async function getCampaignName(campaignId, accessToken) {
  const url = `https://api.${REGION}/api/v2/outbound/campaigns/divisionviews/${encodeURIComponent(campaignId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error al obtener la campaña: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.name;
}

async function obtenerMiPerfil() {
  const token = localStorage.getItem('access_token');
  const response = await fetch(`https://api.${REGION}/api/v2/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.id; 
}


function abrirPopup(conversationId, event) {
  // Eliminar otros popups
  document.querySelectorAll('.popup-menu').forEach(p => p.remove());
  const button = event.currentTarget;
  const participantId = button.getAttribute("data-participant-id");
  const communicationId = button.getAttribute("data-communication-id");

  const popup = document.createElement('div');
  popup.className = 'popup-menu';
  popup.innerHTML = `
    <button onclick="reprogramar('${conversationId}')">Reprogramar</button>
    <div style="padding: 5px;">
      <button style="margin-top: 5px;" onclick="abrirModalEdit('${conversationId}')">Editar</button>
    </div>
    <button onclick="abrirModalCancelar('${conversationId}', '${participantId}', '${communicationId}')">Cancelar ❌</button>

  `;

  document.body.appendChild(popup);
  flatpickr(`#calendar-${conversationId}`, {
    enableTime: true,
    dateFormat: "Y-m-d\\TH:i:S\\Z", // ISO format UTC
    defaultDate: new Date(),
    time_24hr: true
  });


  const rect = event.currentTarget.getBoundingClientRect();
  const popupWidth = 220;
  const popupHeight = 160;

  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY;

  // Si se sale por la derecha
  if (left + popupWidth > window.innerWidth) {
    left = window.innerWidth - popupWidth - 10;
  }

  // Si se sale por abajo
  if (top + popupHeight > window.scrollY + window.innerHeight) {
    const spaceAbove = rect.top;
    if (spaceAbove > popupHeight) {
      top = rect.top + window.scrollY - popupHeight;
    }
  }

  popup.style.position = 'absolute';
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  // Activa animación
  requestAnimationFrame(() => popup.classList.add('show'));

  // Cerrar al hacer clic fuera
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


// function reprogramarConFlatpickr(conversationId) {
//   const input = document.getElementById(`calendar-${conversationId}`);
//   const fechaSeleccionada = input?.value;

//   if (!fechaSeleccionada) {
//     alert("Selecciona una fecha primero.");
//     return;
//   }

//   console.log(`Reprogramar ${conversationId} para ${fechaSeleccionada}`);

//   // Lógica futura: enviar PATCH
//   document.querySelectorAll('.popup-menu').forEach(p => p.remove());


// }


async function cancelarCallback(conversationId, participantId, communicationId) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    alert("Debes iniciar sesión.");
    return;
  }

  const url = `https://api.sae1.pure.cloud/api/v2/conversations/callbacks/${conversationId}/participants/${participantId}/communications/${communicationId}`;
  
  const body = { state: "disconnected" };

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    console.log("✅ Callback cancelado:", data);
    alert("Callback cancelado correctamente.");
    
    let userId = urlParams.get('userId');
    if (!userId) {
      userId = await obtenerMiPerfil();
    }
    getCallbacks(userId);

  } catch (err) {
    console.error("❌ Error cancelando el callback:", err);
    alert("Error cancelando el callback.");
  }
}



(async () => {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has('code')) {
    const code = urlParams.get('code');
    try {
      await exchangeCodeForToken(code);
      history.replaceState(null, '', REDIRECT_URI); // Limpia la URL
    } catch (err) {
      alert('Error en login: ' + err.message);
      return;
    }
  }

  // Si no hay token, inicia login automáticamente
  if (!localStorage.getItem('access_token')) {
    await login();
    return;
  }

  // Ya hay token, ahora obtenemos userId y callbacks
  let userId = urlParams.get('userId');
  if (!userId) {
    userId = await obtenerMiPerfil();
  }
  getCallbacks(userId);
})();


const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('code')) {
	const code = urlParams.get('code');
	exchangeCodeForToken(code)
		.then(() => {
			history.replaceState(null, '', REDIRECT_URI); // Limpia la URL
			alert('Login exitoso!');
		})
		.catch(err => alert('Error en login: ' + err.message));
}



function getIntervalLast30Days() {
  const now = new Date();                 // fecha actual
  const past = new Date();                 
  past.setDate(now.getDate() - 30);        // 30 días atrás

  const nowIso = now.toISOString();
  const pastIso = past.toISOString();

  return `${pastIso}/${nowIso}`;
}

function abrirModalCancelar(conversationId, participantId, communicationId) {
  // Eliminar modales previos
  document.querySelectorAll('.modal-cancelar').forEach(m => m.remove());

  const modal = document.createElement('div');
  modal.className = 'modal-cancelar';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Cancelar Callback</h3>
      <p>¿Estás seguro de que querés cancelar este callback?</p>
      <button style="background:red; color:white; margin-right:10px;"
              onclick="confirmarCancelacion('${conversationId}', '${participantId}', '${communicationId}')">
        Cancelar Callback
      </button>
      <button onclick="cerrarModal()">Cerrar</button>
    </div>
  `;

  document.body.appendChild(modal);
}

function confirmarCancelacion(conversationId, participantId, communicationId) {
  if (confirm("⚠️ ¿Seguro que querés cancelar este callback?")) {
    cancelarCallback(conversationId, participantId, communicationId);
    cerrarModal();
  }
}

function cerrarModal() {
  document.querySelectorAll('.modal-cancelar').forEach(m => m.remove());
}


async function reprogramarDatePicker(conversationId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    alert('Debes iniciar sesión.');
    return;
  }

  const nuevaFecha = document.getElementById("modal-calendar-"+conversationId);
	const popup = document.querySelector('.popup-menu');
 


  const res = await fetch(`https://api.${REGION}/api/v2/conversations/callbacks/`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
			conversationId:conversationId,
			callbackScheduledTime: nuevaFecha.value
		})
  });

  if (res.ok) {
    alert(`Callback reprogramado para ${nuevaFecha}`);

    let userId = urlParams.get('userId');
    if (!userId) {
      userId = await obtenerMiPerfil();
    }
    getCallbacks(userId);
  } else {
    const error = await res.json();
    console.error('Error reprogramando:', error);
    alert('Error reprogramando el callback.');
  }
}



function abrirModalEdit(conversationId) {
  // Eliminar modales previos
  document.querySelectorAll('.modal-cancelar').forEach(m => m.remove());

  const modal = document.createElement('div');
  modal.className = 'modal-cancelar';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Editar Callback</h3>
      <p>¿Estás seguro de que querés cancelar este callback?</p>
      <div style="margin:10px 0;">
        <input type="text" id="modal-calendar-${conversationId}" placeholder="Elegir nueva fecha">
      </div>
      <button style="background:red; color:white; margin-right:10px;"
              onclick="reprogramarDatePicker('${conversationId}')">
        EditarCallback
      </button>
      <button onclick="cerrarModal()">Cerrar</button>
    </div>
  `;

  document.body.appendChild(modal);

  // Flatpickr para calendario
  flatpickr(`#modal-calendar-${conversationId}`, {
    enableTime: true,
    dateFormat: "Y-m-d\\TH:i:S\\Z",
    defaultDate: new Date(),
    time_24hr: true
  });
}


function getAgentParticipantId(conv) {
  //if (!data || !data.conversations) return null;
  console.log(conv);
  //for (const conv of data.conversations) {
    const participant = conv[0].participants.find(p => p.purpose === "agent");
    if (participant) {
      return participant.participantId;
    }
  //}
  return null; 
}


function getLastAgentSessionId(conv) {
  //if (!data || !data.conversations) return null;

  //for (const conv of data.conversations) {
    const participant = conv[0].participants.find(p => p.purpose === "agent");
    if (participant && Array.isArray(participant.sessions) && participant.sessions.length > 0) {
      const lastSession = participant.sessions[participant.sessions.length - 1];
      return lastSession.sessionId;
    }
  //}
  return null; // si no encuentra nada
}

