const input = document.querySelector('#hfToken');
const save = document.querySelector('#saveHfToken');
const clear = document.querySelector('#clearHfToken');
const badge = document.querySelector('#hfAuthState');

function refresh(){
  const t = sessionStorage.getItem('talkercomparison.hfToken') || '';
  if(input && !input.value) input.value = t;
  if(badge) badge.textContent = t ? 'HF autenticado en esta pestaña' : 'HF anónimo · cuota mínima';
}

save?.addEventListener('click',()=>{
  const t = input?.value?.trim() || '';
  if(!t.startsWith('hf_')){
    if(badge) badge.textContent = 'Token inválido: debe empezar con hf_';
    return;
  }
  sessionStorage.setItem('talkercomparison.hfToken',t);
  if(badge) badge.textContent = 'Token guardado sólo en esta pestaña';
});

clear?.addEventListener('click',()=>{
  sessionStorage.removeItem('talkercomparison.hfToken');
  if(input) input.value='';
  refresh();
});

refresh();
