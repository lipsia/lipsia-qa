(async function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-btn');
  let bootstrap = false;

  try {
    await Hub.api('/auth/me');
    return location.replace('/');
  } catch { /* not signed in */ }

  try {
    const { bootstrapNeeded } = await Hub.api('/auth/bootstrap-status');
    if (bootstrapNeeded) {
      bootstrap = true;
      document.getElementById('form-title').textContent = 'Create admin account';
      document.getElementById('form-subtitle').textContent = 'No account exists yet. The first account becomes the administrator.';
      document.getElementById('password').autocomplete = 'new-password';
      document.getElementById('password-hint').hidden = false;
      submitBtn.textContent = 'Create account';
    }
  } catch { /* keep sign-in mode */ }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      await Hub.api(bootstrap ? '/auth/bootstrap' : '/auth/login', {
        method: 'POST',
        body: { username: form.username.value.trim(), password: form.password.value },
      });
      location.replace('/');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      Hub.replay(errorEl, 'login-error');
      submitBtn.disabled = false;
    }
  });
})();
