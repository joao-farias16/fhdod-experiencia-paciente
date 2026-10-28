import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { INACTIVITY_GRACE_MS, INACTIVITY_WARNING_MS } from './survey-storage';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Inatividade da pesquisa pública (RF39): depois de 3 minutos sem interação, exibe o aviso
 * "Você ainda está aí?" com contagem de 60 segundos; sem resposta, chama `onExpire` para apagar
 * as respostas. Qualquer interação antes do aviso reinicia a contagem.
 */
export function useInactivity(enabled: boolean, onExpire: () => void) {
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(INACTIVITY_GRACE_MS / 1000);
  const onExpireRef = useRef(onExpire);
  useLayoutEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);
  const [cycle, setCycle] = useState(0);

  // Fase 1: aguarda 3 minutos sem atividade.
  useEffect(() => {
    if (!enabled || warning) return undefined;
    const showWarning = () => {
      setSecondsLeft(INACTIVITY_GRACE_MS / 1000);
      setWarning(true);
    };
    let timer = setTimeout(showWarning, INACTIVITY_WARNING_MS);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(showWarning, INACTIVITY_WARNING_MS);
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, restart, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, restart);
    };
  }, [enabled, warning, cycle]);

  // Fase 2: aviso com contagem regressiva de 60 segundos.
  useEffect(() => {
    if (!enabled || !warning) return undefined;
    const deadline = Date.now() + INACTIVITY_GRACE_MS;
    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    const expire = setTimeout(() => {
      setWarning(false);
      onExpireRef.current();
    }, INACTIVITY_GRACE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(expire);
    };
  }, [enabled, warning]);

  const stillHere = useCallback(() => {
    setWarning(false);
    setCycle((value) => value + 1);
  }, []);

  return { warning: enabled && warning, secondsLeft, stillHere };
}
