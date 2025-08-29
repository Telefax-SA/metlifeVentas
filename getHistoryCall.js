const CLIENT_ID = '732d6aaf-a749-426f-8af2-7d6595c48a81';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;
// const contactId = window.location.href.split('?contactId=')[1];
// const campaignId = window.location.href.split('?campaignId=')[1];
const client = platformClient.ApiClient.instance;

let codeVerifier = localStorage.getItem('code_verifier');
client.setEnvironment(REGION);
async function login() {
  codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('code_verifier', codeVerifier);

  // Armamos el state como query string
  const contactId = urlParams.get('contactId') || '';
  const campaignId = urlParams.get('campaignId') || '';
  const participantId = urlParams.get('participantId') || '';
  const conversationId = urlParams.get('conversationId') || '';
  const scriptId = urlParams.get('scriptId') || '';
  const userId =  urlParams.get('userId') || '';
  const userName =  urlParams.get('userName') || '';
  const queueId =  urlParams.get('queueId') || '';
  const campaingName =  urlParams.get('campaingName') || '';
  const pending =  urlParams.get('pending') || '';


  const stateObj = new URLSearchParams();
  if (contactId) stateObj.append('contactId', contactId);
  if (campaignId) stateObj.append('campaignId', campaignId);
  if (participantId) stateObj.append('participantId', participantId);
  if (scriptId) stateObj.append('scriptId', scriptId);
  if (conversationId) stateObj.append('conversationId', conversationId);
  if (userId) stateObj.append('userId', userId);
  if (userName) stateObj.append('userName', userName);
  if (queueId) stateObj.append('queueId', queueId);
  if (campaingName) stateObj.append('campaingName', campaingName);
  if (pending) stateObj.append('pending', pending);
  
  
  // Podés agregar más parámetros al state así:
  // stateObj.append('userType', 'cliente');

  const state = encodeURIComponent(stateObj.toString());

  const url = `https://login.${REGION}/oauth/authorize?` +
    `client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}`;

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

async function getHistoryCalls(contactId) {
	let access_token = localStorage.getItem('access_token');
	client.setAccessToken(access_token)
  const api = new platformClient.AnalyticsApi();
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);
  const interval = `${sixMonthsAgo.toISOString()}/${now.toISOString()}`;

  const query = {
    order: "desc",
    orderBy: "conversationStart",
    paging: { pageSize: 50, pageNumber: 1 },
    interval: "2025-08-01T03:00:00.000Z/2025-08-31T03:00:00.000Z",
    segmentFilters: [
      {
        type: "or",
        predicates: [
          { dimension: "direction", value: "outbound" },
          { dimension: "direction", value: "inbound" }
        ]
      },
      {
        type: "or",
        predicates: [
          { dimension: "outboundContactId", value: contactId }
        ]
      }
    ]
  };

  try {
    const response = await api.postAnalyticsConversationsDetailsQuery(query);
		console.log(response);
    const data = await formatearDatos(response.conversations || []);
    renderTabla(data);
  } catch (err) {
    document.getElementById("tabla").innerText = "Error al buscar llamadas: " + err;
    console.error(err);
  }
}

async function formatearDatos(convs) {
  const usersApi = new platformClient.UsersApi();

  const filas = await Promise.all(convs.map(async conv => {
    const fecha = new Date(new Date(conv.conversationStart).getTime() - 3 * 3600000)
      .toISOString().replace('T', ' ').slice(0, 19);

    const tTalk = sumarTTalkComplete(conv);
    const dnis = obtenerDnis(conv);
    const agentes = await obtenerNombresAgentes(conv, usersApi);
    const wrapups = obtenerWrapups(conv);
    const accessToken = localStorage.getItem('access_token');
    console.log("Antes: "+wrapups.notes);
    const resolvedCodes = await resolveWrapupCodesArray(wrapups.codes.split(", "), accessToken);

    console.log("Despues: "+wrapups.notes);
    return [
      fecha,
      tTalk,
      dnis,
      gridjs.html(`<span title="${resolvedCodes.join(", ")}">${resolvedCodes.join(", ")}</span>`),
      agentes,
      wrapups.notes
    ];
  }));

  return filas;
}

function renderTabla(data) {
	const contenedor = document.getElementById("tabla");
  contenedor.innerHTML = ""; // ← limpia el contenido anterior
  new gridjs.Grid({
    columns: [
      'Fecha',
      'Duración',
      'Teléfono',
      'Tipificación',
      'Agentes',
      'Comentarios'
    ],
    data: data,
    search: true,
    sort: true,
    pagination: { enabled: true, limit: 10 },
    resizable: true,
    language: {
      search: {
        placeholder: 'Buscar...'
      },
      pagination: {
        previous: 'Anterior',
        next: 'Siguiente',
        showing: 'Mostrando',
        results: () => 'registros'
      },
      loading: 'Cargando...',
      noRecordsFound: 'No se encontraron registros',
      error: 'Ocurrió un error al cargar los datos'
    }
  }).render(document.getElementById("tabla"));
}

function sumarTTalkComplete(conv) {
  let total = 0;
  for (const p of conv.participants || []) {
    for (const s of p.sessions || []) {
      for (const m of s.metrics || []) {
        if (m.name === "tTalkComplete") total += m.value;
      }
    }
  }
  const totalSeconds = Math.floor(total / 1000); // redondeamos hacia abajo
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds > 0) return `${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function obtenerDnis(conv) {
  for (const p of conv.participants || []) {
    for (const s of p.sessions || []) {
      if (s.dnis) return s.dnis.replace("tel:", "").split(";")[0];
    }
  }
  return "-";
}

function obtenerWrapups(conv) {
  const codes = [];
  const notes = [];

  for (const p of conv.participants || []) {
    if (p.purpose === "agent") {
      for (const s of p.sessions || []) {
        for (const seg of s.segments || []) {
          if (seg.segmentType === "wrapup") {
            if (seg.wrapUpCode) codes.push(seg.wrapUpCode);
            if (seg.wrapUpNote) notes.push(seg.wrapUpNote);
          }
        }
      }
    }
  }

  return {
    codes: codes.join(", ") || "-",
    notes: notes.join(", ") || "-"
  };
}

async function obtenerNombresAgentes(conv, usersApi) {
  const ids = new Set();
  for (const p of conv.participants || []) {
    for (const s of p.sessions || []) {
      if (s.selectedAgentId) ids.add(s.selectedAgentId);
    }
  }

  const nombres = await Promise.all([...ids].map(async id => {
    try {
      const user = await usersApi.getUser(id);
      return user.name;
    } catch {
      return `(ID: ${id})`;
    }
  }));

  return nombres.join(", ") || "-";
}

async function resolveWrapupCodesArray(wrapUpCodes, accessToken) {
  const cache = new Map();
  const isId = (code) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);


  const uniqueCodes = [...new Set(wrapUpCodes.filter(isId))];

  const resolvedNames = await Promise.all(
    uniqueCodes.map(async (code) => {
      if (cache.has(code)) return cache.get(code);

      try {
        const response = await fetch(`https://api.${REGION}/api/v2/routing/wrapupcodes/${code}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const name = data.name || code;
        cache.set(code, name);
        return name;
      } catch (error) {
        console.error(`Error fetching wrapUpCode "${code}":`, error.message);
        cache.set(code, code); // fallback
        return code;
      }
    })
  );

  // Map de code → name
  const codeToName = Object.fromEntries(uniqueCodes.map((c, i) => [c, resolvedNames[i]]));

  // Devuelve array original con nombres reemplazados si están en cache
  return wrapUpCodes.map(code => codeToName[code] || code);
}


const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
const rawState = urlParams.get('state');

if (code && rawState) {
  const stateParams = new URLSearchParams(decodeURIComponent(rawState));
  for (const [key, value] of stateParams.entries()) {
    localStorage.setItem(key, value); // guarda contactId, campaignId, o cualquier otro
  }

  exchangeCodeForToken(code)
    .then(() => {
      history.replaceState(null, '', REDIRECT_URI); // limpia los parámetros de la URL
    })
    .catch(err => alert('Error en login: ' + err.message));
}

if (!window.__alreadyRan) {
  window.__alreadyRan = true;

  (async () => {
    if (!code) {
      await login(); 
    } else {
      const contactId = localStorage.getItem('contactId');
      const campaignId = localStorage.getItem('campaignId');
      const userId = localStorage.getItem("userId")
      const campaingName = localStorage.getItem("campaingName")
      const pending = localStorage.getItem("pending")
      suscribirseATopic(userId);
      await getHistoryCalls(contactId);
      await getContactData(contactId, campaignId);
      await getWrapUpCodes("*");
      await getUsersByDivision("Home");

      const title = document.getElementById("campanaTitle");
      const miSelect = document.getElementById('AgenteCall');
      miSelect.value = userId;

      if (pending) {
        title.innerHTML = `<span style="color:#e53935;">Pendiente de campaña ${campaingName}</span>`;
      } else {
        title.textContent = campaingName;
      }

    }
  })();
}

document.getElementById('Tipificar').onclick = (e) => {
  e.preventDefault(); 
  const conversationId = localStorage.getItem('conversationId');
  const participantId = localStorage.getItem('participantId');

  const wrapupSelect = document.getElementById('wrapup');
  const wrapupCode = wrapupSelect.value;
  const wrapupName = wrapupSelect.options[wrapupSelect.selectedIndex].text;

  const note = document.getElementById("notes");
  
  const wrapupLabel = wrapupSelect.options[wrapupSelect.selectedIndex]?.text || '';
  const callbackDatetime = document.getElementById('callback-datetime').value;
  const messageDiv = document.getElementById('tipificarMessage');
  // Lista de labels que requieren fecha de callback

  if (!wrapupCode) {
    messageDiv.textContent = "Debe seleccionar una tipificación.";
    messageDiv.style.color = "red";
    return; // detener la ejecución
  }
  const wrapupsQueRequierenFecha = [
    "Apertura de deposito",
    "Otro wrapup que requiere fecha"
  ];
  // Si el wrapup es de los que requieren fecha y no hay fecha seleccionada
  if (wrapupsQueRequierenFecha.includes(wrapupLabel) && !callbackDatetime) {
    messageDiv.textContent = "Debe seleccionar una fecha para el callback.";
    messageDiv.style.color = "red";
    return; // detener la ejecución
  }

  // Si pasa la validación, limpiar el mensaje
  messageDiv.textContent = "";
  if(globalCommunicationId === null)
    tipificar(conversationId, participantId, wrapupCode, wrapupName, note.value);
  else tipificarInCall(conversationId, participantId, globalCommunicationId, wrapupCode, wrapupName, note.value);

  // Si el wrapup requiere fecha y la fecha está seleccionada, llamar createCallbackGateway
  if (wrapupsQueRequierenFecha.includes(wrapupLabel) && callbackDatetime) {
    createCallbackGateway();
    messageDiv.textContent = "callback programado";
    messageDiv.style.color = "black";
  }
};

document.getElementById('Callback').onclick = (e) => {
  e.preventDefault(); 
  createCallbackGateway();
}
  
function createCallbackGateway(){
  let userId = localStorage.getItem('userId');
  let userName = localStorage.getItem('userName');
  const queueId = localStorage.getItem('queueId');
  const scriptId = localStorage.getItem('scriptId');
  const campaignId = localStorage.getItem('campaignId');
  const contactId = localStorage.getItem('contactId');
  const conversationId = localStorage.getItem('conversationId');
  const participantId = localStorage.getItem('participantId');
  const datePicker = document.getElementById("callback-datetime");

  const checkboxOwner = document.getElementById("checkboxOwner");

  if (checkboxOwner.checked) {
    const dropDown = document.getElementById("AgenteCall");
    userId = dropDown.value;
    userName = dropDown.options[dropDown.selectedIndex].text;
  }
  createCallback(userId, userName, queueId, datePicker.value, scriptId, PhoneNumbers, campaignId, contactId, ContactName, conversationId, participantId);
}

document.getElementById("AgenteCall").style.display = "none";
document.getElementById("checkboxOwner").onclick = () => {
  const dropDown = document.getElementById("AgenteCall");
  const checkbox = document.getElementById("checkboxOwner");

  dropDown.style.display = checkbox.checked ? "block" : "none";
};

document.getElementById("ventaButton").onclick = (e) =>{
  e.preventDefault();
  const ventaButton = e.target; // el botón que se clickeó
  ventaButton.disabled = true; // lo deshabilita
  ventaButton.style.opacity = "0.5"; // baja opacidad para feedback visual
  const conversationId = localStorage.getItem('conversationId');
  const participantId = localStorage.getItem('participantId'); //deberia ser el participantID del customer
  addInfoVenta(conversationId, participantId, getVentaData());
  addTagVenta(conversationId, "Venta");
  alert("Datos guardados")
  
}

function getVentaData(){
  const form = document.getElementById('formContainer');
  if (!form) return '';

  const orderedFields = [
    'nombres',
    'apellidos',
    'ci',
    'fechaNacimiento',
    'direccion',
    'departamento',
    'localidad',
    'codigoPostal',
    'telefono1',
    'telefono2',
    'telefono3',
    'telefono4',
    'email'
  ];

  const values = orderedFields.map(id => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  });

  return values.join(';');
}


let PhoneNumbers = "";
//custom_-_6e654f5a-43e2-4fce-b590-ce54d40d2ec1
//custom_-_f83cd046-d7d0-49e2-9159-7193ef5deaf2
777
let contactBodyData = "";
let contactListId = "";
async function getContactData(contactId, campaignId){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_f83cd046-d7d0-49e2-9159-7193ef5deaf2"; 
  let body = {"contactId":contactId,"campaignId":campaignId}; 
  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data.body, null, 2)}`);
    const editableFields = ['Direccion', 'Fecha Nacimiento', 'Telefono1', 'Telefono2', 'TelefonoObtenido', 'Auxiliar'];
    const tableData = parseMarkdownTable(data.body.markdownTable);

    PhoneNumbers = (data.body.phoneValues || [])
      .filter(p => p && p.trim() !== "")
      .join(", ");

    renderEditableTable(tableData, editableFields);
    
    autocompleteForm(data.body);
    contactBodyData = data.data;
    contactListId = data.contactListId;
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}

function parseMarkdownTable(md) {
  const lines = md.trim().split('\n').slice(2); // quitamos cabecera y separadores
  const data = lines.map(line => {
    const parts = line.split('|').map(cell => cell.trim()).filter(Boolean);
    return parts;
  });
  return data;
}

function renderEditableTable(data, editableFields) {
  const container = document.getElementById('gridjs-table');
  container.innerHTML = ''; // Limpia antes de renderizar

  new gridjs.Grid({
    columns: [
      { name: 'Campo', sort: false },
      {
        name: 'Valor', sort: false,
        formatter: (cell, row) => {
          const campo = row.cells[0].data;
          const isEditable = editableFields.includes(campo) || campo === 'TelefonoObtendio';

          if (isEditable) {
            return gridjs.html(`
              <input type="text" 
                     value="${cell}" 
                     data-campo="${campo}" 
                     style="width:90%; padding:4px; border-radius:3px; border:1px solid #A7A8AA;" />
            `);
          }

          return cell;
        }
      },
      {
        id: 'boton',
        name: '', // sin header visible
        sort: false,
        formatter: (_, row) => {
          const campo = row.cells[0].data;
          if (campo === 'TelefonoObtendio') {
            return gridjs.html(`
              <button onclick="accionTelefonoObtendio()" 
                      style=" border: none; cursor: pointer; padding: 4px;">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92V21a2 2 0 0 1-2.18 2A19.72 19.72 0 0 1 3 5.18 2 2 0 0 1 5 3h4.09a1 1 0 0 1 1 .75l1.38 5.52a1 1 0 0 1-.27.95L9.91 12.09a16 16 0 0 0 6 6l1.87-1.87a1 1 0 0 1 .95-.27l5.52 1.38a1 1 0 0 1 .75 1z"/>
                </svg>
              </button>
            `);
          }
          return ''; // celda vacía para los demás campos
        }
      }
    ],
    data: data,
    pagination: false,
    search: false,
    sort: false,
    style: {
      table: { fontSize: '0.9rem', width: '100%' },
      td: { padding: '6px 4px' },
      th: { backgroundColor: '#E6F2F9', color: '#0061A0', textAlign: 'left' }
    }
  }).render(container);
}

function accionTelefonoObtendio() {
  const input = document.querySelector('input[data-campo="TelefonoObtendio"]');
  if (input) {
    const phone = input.value;
    let apiInstance = new platformClient.ConversationsApi();

    let conversationId = localStorage.getItem("conversationId");
    let body = {
      "callNumber": phone,
      "phoneColumn": "telefono obtenido"
    };

    apiInstance.postConversationsCall(conversationId, body)
      .then((data) => {
        console.log(`postConversationsCall success! data: ${JSON.stringify(data, null, 2)}`);
      })
      .catch((err) => {
        console.log("There was a failure calling postConversationsCall");
        console.error(err);
      });
    }
}


let ContactName = "customer";

function autocompleteForm(body) {
  ContactName = (body.nombre || '') + " " + (body.apellido || '');
  console.log("el body esta vacio?:: " + JSON.stringify(body));
  const formMap = {
    nombres: body.nombre,
    apellidos: body.apellido,
    direccion: body.direccion,
    localidad: body.localidad,
    email: body.email,
    fechaNacimiento: body.fechaNacimiento,
    telefono1: body.phoneValues?.[0],
    telefono2: body.phoneValues?.[1],
    telefono3: body.phoneValues?.[2],
    telefono4: body.phoneValues?.[3],
  };

  Object.entries(formMap).forEach(([id, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName.toLowerCase() === 'select') {
          el.value = value;
        } else {
          el.value = value;
        }
      }
    }
  });
}


document.getElementById('update-table').onclick = () => {
  const contactId = localStorage.getItem('contactId');
  updateContact(contactListId, contactId, contactBodyData, getTableDataObject());
};


function getTableDataObject() {
  const table = document.querySelector('#gridjs-table table');
  const rows = table.querySelectorAll('tbody tr');
  const data = {};

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');

    const key = cells[0].textContent.trim();
    const input = cells[1].querySelector('input');
    const value = input ? input.value.trim() : cells[1].textContent.trim();

    data[key] = value;
  });

  return data;
}

//custom_-_265f8b01-f154-4f87-80da-20ece14ff306
function updateContact(contactListId, contactId, body, data){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_265f8b01-f154-4f87-80da-20ece14ff306"; 
  let body2 = {"contactListId":contactListId,
              "contactId":contactId, 
              "body":body,
              "data":data
            }; 

  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body2, opts)
  .then((data) => {
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}

//custom_-_773503e5-ab4f-4859-9b5e-46a252aea088
function tipificar(conversationId, participantId, wrapupCode, wrapupName, note) {
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_773503e5-ab4f-4859-9b5e-46a252aea088"; 
  let body = {"conversationId":conversationId,
              "participantId":participantId, 
              "wrapupCode":wrapupCode,
              "wrapupName":wrapupName,
              "note": note}; 
  let opts = { 
    "flatten": false 
  };
  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });

}

//custom_-_225629aa-543e-4455-9c30-ef150db4daee
function tipificarInCall(conversationId, participantId, communicationId, wrapupCode, wrapupName, note){
  console.warn("TIPIFICAR IN CALL!!");
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_225629aa-543e-4455-9c30-ef150db4daee"; 
  let body = {"conversationId":conversationId,
              "participantId":participantId, 
              "communicationId":communicationId,
              "wrapupCode":wrapupCode,
              "wrapupName":wrapupName,
              "note": note}; 
  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    globalCommunicationId = null;
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}


//custom_-_ffc373fa-674c-4d67-a72f-f55f9daf7ac1
async function getWrapUpCodes(divisionId) {
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_ffc373fa-674c-4d67-a72f-f55f9daf7ac1"; 
  let body = {"divisionId":divisionId}; 
  let opts = { 
    "flatten": true 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    const wrapupSelect = document.getElementById('wrapup');
    wrapupSelect.innerHTML = '<option value="" disabled selected>Seleccione un Wrap-Up</option>'; // limpiar y dejar default

    const ids = data["entities.id"];
    const names = data["entities.name"];
    // Limpiar y dejar opción por defecto
    wrapupSelect.innerHTML = '<option value="" disabled selected>Seleccione un Wrap-Up</option>';

    if (Array.isArray(ids) && Array.isArray(names) && ids.length === names.length) {
      for (let i = 0; i < ids.length; i++) {
        const option = document.createElement('option');
        option.value = ids[i];
        option.textContent = names[i];
        wrapupSelect.appendChild(option);
      }
    } else {
      console.warn("Datos inconsistentes en los wrapups.");
    }
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}

//custom_-_7fcf11b0-57b7-4187-b9b2-1b64c052fc04
async function getUsersByDivision(divisionName) {
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_7fcf11b0-57b7-4187-b9b2-1b64c052fc04"; 
  let body = {"divisionName":divisionName}; 
  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
  const agentSelect = document.getElementById('AgenteCall');
  agentSelect.innerHTML = '<option value="" disabled selected>Seleccione un Agente</option>';

  const ids = data.usersData?.ids || [];
  const usernames = data.usersData?.usernames || [];

  if (Array.isArray(ids) && Array.isArray(usernames) && ids.length === usernames.length) {
    for (let i = 0; i < ids.length; i++) {
      const option = document.createElement('option');
      option.value = ids[i];          // ID como value
      option.textContent = usernames[i]; // username visible
      agentSelect.appendChild(option);
    }
  } else {
    console.warn('Datos inválidos en usersData');
}
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}

//custom_-_eda7f4c4-6fda-4a26-ae0c-b4d80c9b8e3c
function createCallback(userId, userName, queueId, scheduleTime, scriptId, callbackNumbers, campaignId, contactId, contactName, conversationId, participantId){
  let apiIntegration = new platformClient.IntegrationsApi();

  let actionId = "custom_-_eda7f4c4-6fda-4a26-ae0c-b4d80c9b8e3c"; 
  let opts = { 
    "flatten": false 
  };
  let body = { 
    "userId": userId,
    "userName": userName,
    "queueId": queueId,
    "scheduleTime":scheduleTime,
    "scriptId": scriptId, 
    "callbackNumbers": callbackNumbers,
    "campaingId": campaignId, //ERROR ORTOGRAFICO; CAMBIAR!!!!!!!!
    "contactId": contactId,
    "contactName": contactName,
    "conversationId": conversationId,
    "participantId": participantId
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
  });
}

//custom_-_0cf03a38-50e4-41d8-be9d-29dbe0f47ecc
function addInfoVenta(conversationId, participantId, ventaData){
  let apiIntegration = new platformClient.IntegrationsApi();
   let actionId = "custom_-_0cf03a38-50e4-41d8-be9d-29dbe0f47ecc"; 
  let opts = { 
    "flatten": false 
  };
  let body = { 
    "conversationId": conversationId,
    "participantId": participantId,
    "ventaData": ventaData
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
  });
}

//custom_-_065a39a0-7bf6-49e5-b91d-1b69bfb472ab
function addTagVenta(conversationId, tagName){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_065a39a0-7bf6-49e5-b91d-1b69bfb472ab"; 
  let opts = { 
    "flatten": false 
  };
  let body = { 
    "conversationId": conversationId,
    "tagName": tagName
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
  });
}


let globalCommunicationId = null;

function habilitarBoton(estado) {
  const button = document.getElementById("Tipificar");
  if (button) {
    button.disabled = !estado;
    button.style.opacity = estado ? "1" : "0.5";  // Translucido cuando está deshabilitado
    button.style.cursor = estado ? "pointer" : "not-allowed";
  }
}

function procesarEvento(data) {
  if (!data.eventBody || !data.eventBody.participants) {
    console.warn("Mensaje sin eventBody o participants");
    //habilitarBoton(false);
    return;
  }

  const participantes = data.eventBody.participants;

  let llamadaTerminada = false;
  let communicationId = null;

  for (const participante of participantes) {
    if (participante.purpose === "agent" || participante.purpose === "customer") {
      if (participante.calls && Array.isArray(participante.calls)) {
        for (const call of participante.calls) {
          if (/*call.state === "disconnected" ||*/ call.state === "terminated") {
            llamadaTerminada = true;
            communicationId = call.id || null;
            console.warn("COMUNICATION ID:  " + communicationId);
            break; // ya encontré un callback desconectado para este participante
          }
        }
      }
    }
    if (llamadaTerminada) break; // no necesito seguir buscando si ya la encontré
  }

  if (llamadaTerminada) {
    globalCommunicationId = communicationId;
    console.log("Llamada terminada, communicationId:", globalCommunicationId);
    habilitarBoton(true);
  } else {
    globalCommunicationId = null;
    habilitarBoton(false);
    console.log("Llamada no terminada o no encontrada");
  }
}

function suscribirseATopic(userId) {
  console.log("[suscribirseATopic] Iniciando suscripción para userId:", userId);

  const notificationsApi = new platformClient.NotificationsApi();

  // El topic debe ir entre comillas invertidas para que se evalúe la variable userId
  const topic = `v2.users.${userId}.conversations`;
  console.log("[suscribirseATopic] Topic a suscribirse:", topic);

  notificationsApi.postNotificationsChannels()
    .then(channel => {
      console.log("[suscribirseATopic] Canal creado:", channel);

      const websocket = new WebSocket(channel.connectUri);
      console.log("[suscribirseATopic] Conectando WebSocket a:", channel.connectUri);

      websocket.onopen = () => {
        console.log("[WebSocket] Conexión abierta ✅");
      };

      websocket.onerror = err => {
      };

      websocket.onclose = () => {
        console.warn("[WebSocket] Conexión cerrada ⚠️");
      };

      websocket.onmessage = function(event) {
        console.log("[WebSocket] Mensaje recibido:", event.data);
        const data = JSON.parse(event.data);
        procesarEvento(data);
      };

      // Suscribirse al topic
      return notificationsApi.postNotificationsChannelSubscriptions(channel.id, [{ id: topic }])
        .then(() => {
          console.log("[suscribirseATopic] Suscripción al topic exitosa ✅");
        })
        .catch(err => {
          console.error("[suscribirseATopic] Error al suscribirse al topic ❌", err);
        });

    })
    .catch(err => {
      console.error("[suscribirseATopic] Error al crear canal ❌", err);
    });
}
