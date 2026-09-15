import { Client as RealClient, handle_file } from '@gradio/client-real';

function token(){
  const t = sessionStorage.getItem('talkercomparison.hfToken')?.trim();
  return t && t.startsWith('hf_') ? t : null;
}

export const Client = {
  connect(source, options = {}) {
    const t = token();
    return RealClient.connect(source, t ? {...options, token:t} : options);
  },
  duplicate(source, options = {}) {
    const t = token();
    return RealClient.duplicate(source, t ? {...options, token:t} : options);
  }
};

export { handle_file };
