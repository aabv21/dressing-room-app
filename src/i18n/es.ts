import type { MessageKey } from './index';

export const es: Record<MessageKey, string> = {
  'tabs.today': 'Hoy',
  'tabs.closet': 'Clóset',
  'tabs.build': 'Armar',
  'tabs.forYou': 'Para ti',
  'tabs.profile': 'Perfil',

  'wear.never': 'sin usar',
  'wear.one': '{count} uso',
  'wear.other': '{count} usos',

  'grid.empty': 'Agrega tus {count} favoritas para empezar.',
  'grid.loadError': 'No se pudo cargar la foto',

  'closet.gallery': 'Galería',
  'closet.burstMode': 'Modo ráfaga',

  'screen.today': 'HOY',
  'screen.closet': 'TU CLÓSET',
  'screen.build': 'ARMAR OUTFIT',
  'screen.forYou': 'PARA TI',
  'screen.profile': 'PERFIL',

  comingSoon: 'Llega en la próxima etapa.',

  'perf.hud': '{frames} frames · {dropped} dropped ({ratio}%)\np95 {p95} ms · median {median} ms ≈ {hz} Hz',
  'perf.cacheCleared': 'Caché de imágenes vaciada · estadísticas reiniciadas',
  'perf.cacheClearFailed': 'No se pudo vaciar la caché de imágenes',
};
