const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';
const REDIRECT_URI = window.location.origin + window.location.pathname;

const client = platformClient.ApiClient.instance;
client.setEnvironment(REGION);

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    try {
      showLoading('Iniciando sesión...');
      const token = await exchangeCodeForToken(code, CLIENT_ID, REGION, REDIRECT_URI);
      client.setAccessToken(token);
      history.replaceState(null, '', REDIRECT_URI);
      closeLoading();
      startApp();
    } catch (err) {
      closeLoading();
      showAlert('error', 'Error', 'Fallo al iniciar sesión: ' + err.message);
    }
  } else if (!localStorage.getItem('access_token')) {
    const loginUrl = await getLoginUrl(CLIENT_ID, REGION, REDIRECT_URI);
    window.location.href = loginUrl;
  } else {
    client.setAccessToken(localStorage.getItem('access_token'));
    startApp();
  }
}

async function startApp() {
  const usersApi = new platformClient.UsersApi();
  const routingApi = new platformClient.RoutingApi();

  try {
    const me = await usersApi.getUsersMe();
    const userId = me.id;

    document.getElementById("user-info").innerHTML = `<h2>👤 ${me.name}</h2>`;
    let opts = { 
      "pageSize": 25,
      "pageNumber": 1
    };

    const queues = await routingApi.getUserQueues(userId, opts);
    let activeQueue = queues.entities.find(q => q.joined);
    const inactiveQueues = queues.entities.filter(q => !q.joined);

    renderQueueList('active-queues', activeQueue ? [activeQueue] : [], 'Desactivar', async (queue) => {
      activateQueues(userId, queue.id, false);
      startApp();
    }, 'btn-danger');

    renderQueueList('inactive-queues', inactiveQueues, 'Activar', async (queue) => {
      const patchBody = [];
      if (activeQueue) {
        patchBody.push({ id: activeQueue.id, joined: false });
      }
      patchBody.push({ id: queue.id, joined: true });

      activateQueues(userId, queue.id, true);
      startApp();
    });
  } catch (error) {
    console.error("Error al cargar colas:", error);
    if (error.status === 401) {
      localStorage.removeItem('access_token');
      const loginUrl = await getLoginUrl(CLIENT_ID, REGION, REDIRECT_URI);
      window.location.href = loginUrl;
    } else {
      showAlert('error', 'Error', 'No se pudieron cargar las colas del usuario.');
    }
  }
}

function renderQueueList(containerId, queues, buttonText, buttonHandler, extraClass = '') {
  const ul = document.getElementById(containerId);
  ul.innerHTML = "";
  
  if (queues.length === 0) {
    ul.innerHTML = '<li style="color: var(--color-text-muted); justify-content: center;">No hay colas aquí</li>';
    return;
  }

  queues.forEach(queue => {
    const li = document.createElement('li');
    li.textContent = queue.name;
    const btn = document.createElement('button');
    btn.textContent = buttonText;
    if (extraClass) btn.classList.add(extraClass);
    
    btn.onclick = async () => {
      disableAllButtonsTemporarily(1000);
      showToast('info', 'Actualizando estado...');
      await buttonHandler(queue);
    };
    
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function disableAllButtonsTemporarily(ms) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => btn.disabled = true);
  setTimeout(() => {
    buttons.forEach(btn => btn.disabled = false);
  }, ms);
}

function activateQueues(userId, queueId, active){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_d2b5c2bb-6a23-4531-88dc-f49eb3b1b9e1"; 
  let opts = { "flatten": false };
  let body = { 
    "queuesIds": queueId,
    "userId": userId,
    "active": active
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then(() => {
      showToast('success', active ? 'Cola activada' : 'Cola desactivada');
    })
    .catch((err) => {
      console.error(err);
      showAlert('error', 'Error', 'Ocurrió un error al cambiar el estado de la cola.');
    });
}

// Iniciar aplicación
init();
