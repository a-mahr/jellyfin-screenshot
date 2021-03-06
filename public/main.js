const state = {
  loading: false,
  result: null,
  // result: {
  //     message: 'all good',
  //     success: true,
  // },
};

const renderStatus = () => {
  const statusContainer = document.querySelector('.status');
  const messageSpan = document.querySelector('.status .result');
  if (!state.result) {
    statusContainer.classList.remove(['success', 'error']);
    messageSpan.innerText = '';
    return;
  }
  statusContainer.classList.add(state.result.success ? 'success' : 'error');
  statusContainer.classList.remove(state.result.success ? 'error' : 'success');
  messageSpan.innerText = state.result.message || '';
};

const renderLoading = () => {
  const statusContainer = document.querySelector('.status');
  const messageSpan = document.querySelector('.status .result');
  if (state.loading) {
    statusContainer.classList.add('loading');
    messageSpan.innerText = '';
  } else {
    statusContainer.classList.remove('loading');
    messageSpan.innerText = 'Loading...';
    if (document.activeElement) {
      document.activeElement.blur();
    }
  }
};

const setState = (newState) => {
  Object.assign(state, newState);
  if ('loading' in newState) {
    renderLoading();
  }
  if ('result' in newState) {
    renderStatus();
  }
};

const getOptions = () => ({
  withSubtitle: document.getElementById('subs').checked,
  username: document.getElementById('username').value,
});

document.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  setState({ loading: true, result: null });
  // new Promise((resolve) => globalThis.setTimeout(() => resolve({
  //   success: true,
  //   message: 'all good',
  // }), 15000))
  fetch('/api/screenshots', {
    method: 'POST',
    body: JSON.stringify(getOptions()),
    headers: { 'Content-Type': 'application/json' },
  })
    .then((res) => res.json())
    .then((json) => {
      setState({
        loading: false,
        result: {
          success: json.success,
          message: json.message,
        },
      });
    })
    .catch((err) => {
      setState({
        loading: false,
        result: {
          success: false,
          message: err.toString(),
        },
      });
    });
});

const footer = document.querySelector('footer.status');
footer.addEventListener('click', () => {
  footer.classList.toggle('open');
});

if (window.localStorage) {
  const usernameInput = document.getElementById('username');
  const subsCheck = document.getElementById('subs');
  usernameInput.value = window.localStorage.getItem('jellyScreen_username') || '';
  subsCheck.checked = !!window.localStorage.getItem('jellyScreen_subs');
  usernameInput.addEventListener('change', (e) => {
    window.localStorage.setItem('jellyScreen_username', e.target.value);
  });
  subsCheck.addEventListener('change', (e) => {
    window.localStorage.setItem('jellyScreen_subs', e.target.checked ? 'yes!' : '');
  });
}
